import { Config, Init, Inject, Singleton } from '@/core/decorator';
import { FService } from '@/core/ioc';
import { rm } from 'fs/promises';
import type { Socket, UnixSocketListener } from 'bun';
import { IPCPacket, type SocketPacket } from './packet';
import { Controller } from './controller';

export enum SocketEvent {
    Constructor = 'constructor',
    Close = 'close',
    Error = 'error',
    Open = 'open',
    User = 'user',
    Answer = 'answer',
    Agent = 'agent',
    Data = 'data',
    StreamEnd = 'streamEnd',
    Drain = 'drain',
    Handshake = 'handshake',
    End = 'end',
    ConnectError = 'connectError',
    Timeout = 'timeout',
}

/**
 * EN: SocketConnectionData interface declaration.
 * ZH: SocketConnectionData interface 声明。
 */
export interface SocketConnectionData {}

export interface SocketCallbacks {
    input(text: string): void | Promise<void>;
    answer(turnId: string, id: string, response: unknown): void;
}

/**
 * Bun socket handler used by the runtime IPC listener.
 *
 * The class owns socket lifecycle callbacks only: connection open/close, inbound data, and transport
 * errors. Callback methods are bound in the constructor so `this` is the FSocket instance however
 * Bun invokes them; the instance is passed straight to `Bun.listen({ socket })`.
 */
@Singleton()
/**
 * EN: FSocket class declaration.
 * ZH: FSocket class 声明。
 */
export class FSocket extends FService {
    @Config('socket')
    public path!: string;

    @Inject()
    public packet!: IPCPacket;

    @Inject()
    public controller!: Controller;

    public service?: UnixSocketListener<object>;

    public connection?: Socket<SocketConnectionData>;

    private pending: Buffer[];
    private callbacks?: SocketCallbacks;

    constructor() {
        super();
        this.pending = [];
    }

    @Init()
    public async init() {
        await rm(this.path, { force: true });
        // this.service = Bun.listen({ unix: this.path, socket: this });
        this.service = Bun.listen({
            unix: this.path,
            socket: {
                open: this.open.bind(this),
                close: this.close.bind(this),
                error: this.error.bind(this),
                drain: this.drain.bind(this),
                data: this.data.bind(this),
            },
        });
        console.log(`[IPC] Socket listening at ${this.path}`);
    }

    public async open(socket: Socket<SocketConnectionData>) {
        this.pending = [];
        this.packet.reset();
        this.connection = socket;
        this.log.info(SocketEvent.Open);
        this.write({ action: SocketEvent.Open, data: true });
    }

    public async close(socket: Socket<SocketConnectionData>, error?: Error) {
        this.log.info(SocketEvent.Close, { error });
        if (this.connection === socket) {
            this.connection = undefined;
            this.pending = [];
            this.packet.reset();
        }
    }

    public async error(socket: Socket<SocketConnectionData>, error: Error) {
        this.log.error(SocketEvent.Error, error);
        this.write({ action: SocketEvent.Error, data: error.message });
    }

    public async drain() {
        this.flush();
    }

    public bind(callbacks: SocketCallbacks): void {
        this.callbacks = callbacks;
    }

    public async data(socket: Socket<SocketConnectionData>, data: Uint8Array) {
        if (socket !== this.connection) return;
        // this.log.info('data', data);
        for (const buffer of this.packet.read(data)) {
            const packet = this.packet.decode<SocketPacket>(buffer);
            if (packet.action === SocketEvent.User) {
                if (!this.callbacks) throw Error('Socket input callback is missing');
                await this.callbacks.input(this.readUserText(packet.data));
                continue;
            }
            if (packet.action === SocketEvent.Answer) {
                const answer = packet.data as { turnId?: unknown; id?: unknown; response?: unknown };
                if (typeof answer?.turnId !== 'string' || typeof answer.id !== 'string') throw Error('Invalid interaction IPC packet');
                if (!this.callbacks) throw Error('Socket answer callback is missing');
                this.callbacks.answer(answer.turnId, answer.id, answer.response);
                continue;
            }
            this.controller.dispatch(packet);
        }
    }

    public write(packet: SocketPacket): void {
        if (!this.connection) {
            this.log.warn('socket.write.no_connection', packet);
            return;
        }
        this.pending.push(this.packet.encode(packet));
        this.flush();
    }

    private flush(): void {
        while (this.connection && this.pending.length > 0) {
            const current = this.pending[0]!;
            const written = this.connection.write(current);
            if (written < 0) break;
            if (written === current.byteLength) {
                this.pending.shift();
                continue;
            }
            if (written > 0) this.pending[0] = current.subarray(written);
            break;
        }
    }

    private readUserText(data: unknown): string {
        if (typeof data !== 'object' || data === null || !('text' in data)) throw Error('Invalid user IPC packet');
        return String((data as { text: unknown }).text);
    }
}
