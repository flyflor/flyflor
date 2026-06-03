import { FModule, Module, Inject, Init } from '@/core';
import { unlink } from 'fs/promises';
import { ConfigComponent } from '@/shard/components/config';
import { IPCService, type IPCMessage } from './service';
import type { UnixSocketListener } from 'bun';
import { join } from 'path';
import { ROOT_PATH } from '@/constants';

/** Windows named-pipe prefix used internally while the public endpoint remains `./flyflor.sock`. */
const WINDOWS_NAMED_PIPE_PREFIX = '\\\\.\\pipe\\';

/** Relative prefix used by the public socket endpoint. */
const RELATIVE_PATH_PREFIX = './';

/** Ready message sent once a client connects to any IPC transport. */
const READY_MESSAGE = 'Flyflor ready.';

/**
 * The IPC module: external↔kernel boundary.
 *
 * Exposes one socket transport over the shared `IPCService` brain. The public endpoint is always
 * `./flyflor.sock`; platform-specific listen details stay encapsulated inside this module.
 */
@Module({
    imports: [IPCService],
})
export class IPCModule extends FModule {
    @Inject()
    public readonly config!: ConfigComponent;

    @Inject()
    public readonly service!: IPCService;

    public socketServer?: UnixSocketListener<IPCMessage>;
    /**
     * Opens the socket transport after config has loaded.
     */
    @Init()
    public async init(): Promise<void> {
        await this.startSocket();
    }

    /**
     * Socket transport for CLI / Rust TUI clients. Consumers always use `./flyflor.sock`.
     */
    private async startSocket() {
        const endpoint = join(ROOT_PATH, this.config.socket);
        const handler = {
            open: (socket: { write: (s: string) => void }) => {
                this.writeSocket(socket, { kind: 'agent', content: READY_MESSAGE });
            },
            data: async (socket: { write: (s: string) => void }, data: Uint8Array) => {
                const reply = await this.process(Buffer.from(data).toString('utf8').trim());
                this.writeSocket(socket, reply);
            },
            close: () => { },
            error: (_s: unknown, e: unknown) => console.error(`[IPC/socket] error:`, e),
        };

        await unlink(this.toListenEndpoint(endpoint));
        this.socketServer = Bun.listen({ unix: this.toListenEndpoint(endpoint), socket: handler as never });
        console.log(`[IPC] Socket listening at ${endpoint}`);
    }

    /**
     * Converts the public socket endpoint into the platform listen address without changing what clients see.
     * @param endpoint - the public `./flyflor.sock` endpoint.
     * @returns the endpoint passed to Bun's socket listener.
     */
    private toListenEndpoint(endpoint: string): string {
        if (process.platform !== 'win32') {
            return endpoint;
        }
        return WINDOWS_NAMED_PIPE_PREFIX + endpoint.replace(RELATIVE_PATH_PREFIX, '');
    }

    /**
     * Parses an inbound frame and routes a `user` message through the conversation service.
     * @param frame - the raw inbound JSON line.
     * @returns the reply message to send back.
     */
    private async process(frame: string): Promise<IPCMessage> {
        try {
            const msg = JSON.parse(frame) as IPCMessage;
            if (msg.kind === 'user' && msg.content) {
                const reply = await this.service.handleUserMessage(msg.content);
                return { kind: 'agent', content: reply };
            }
            return { kind: 'error', content: 'Expected {"kind":"user","content":"..."}' };
        } catch (err) {
            const message = this.errorMessage(err);
            return { kind: 'error', content: message };
        }
    }

    private writeSocket(socket: { write: (s: string) => void }, msg: IPCMessage): void {
        socket.write(JSON.stringify(msg) + '\n');
    }

    /**
     * Formats thrown errors for IPC clients without changing the JSONL envelope.
     * @param err - Unknown value thrown by runtime or transport handling.
     * @returns A compact error string including structured detail when available.
     */
    private errorMessage(err: unknown): string {
        if (!(err instanceof Error)) {
            return String(err);
        }
        const detail = (err as Error & { detail?: unknown }).detail;
        if (detail === undefined) {
            return err.message;
        }
        return `${err.message}: ${JSON.stringify(detail)}`;
    }

    /** The resolved IPC endpoint address (for AppModule to expose as `endpoint`). */
    public get endpoint(): string {
        return this.config.socketEndpoint;
    }
}
