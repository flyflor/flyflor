import { FModule, Module, Inject, Init } from "@/core";
import { ConfigComponent } from "@/shard/components/config";
import { IPCService, type IPCMessage } from "./service.ts";

/** Port the browser-facing WebSocket server listens on (the unix socket serves CLI / Rust TUI). */
const WEB_PORT = 17878;

/**
 * The IPC module: external↔kernel boundary.
 *
 * Exposes two transports over one shared `IPCService` brain:
 * - a Unix domain socket (`./flyflor.sock`) for CLI clients and the future Rust TUI;
 * - a WebSocket server (`ws://127.0.0.1:17878`) for the browser test client.
 * Both speak the same line-delimited JSON `IPCMessage` protocol.
 */
@Module()
export class IPCModule extends FModule {
    @Inject() private readonly config!: ConfigComponent;
    @Inject() private readonly service!: IPCService;

    private socketServer?: unknown;
    private webServer?: unknown;

    /**
     * Opens both transports after config has loaded.
     */
    @Init()
    public async init(): Promise<void> {
        this.startUnixSocket();
        this.startWebSocket();
    }

    /**
     * Unix-domain socket transport for CLI / Rust TUI clients (POSIX) — falls back to TCP on Windows.
     */
    private startUnixSocket(): void {
        const endpoint = this.config.socketEndpoint;
        const handler = {
            open: (socket: { write: (s: string) => void }) => {
                this.writeSocket(socket, { kind: "agent", content: "Flyflor ready (DeepSeek V4 Flash)." });
            },
            data: async (socket: { write: (s: string) => void }, data: Uint8Array) => {
                const reply = await this.process(Buffer.from(data).toString("utf8").trim());
                this.writeSocket(socket, reply);
            },
            close: () => {},
            error: (_s: unknown, e: unknown) => console.error(`[IPC/socket] error:`, e),
        };

        if (process.platform === "win32") {
            this.socketServer = Bun.listen({ hostname: "127.0.0.1", port: WEB_PORT + 1, socket: handler as never });
        } else {
            this.socketServer = Bun.listen({ unix: endpoint, socket: handler as never });
        }
        console.log(`[IPC] Unix socket listening at ${endpoint}`);
    }

    /**
     * WebSocket transport for the browser test client.
     */
    private startWebSocket(): void {
        const self = this;
        this.webServer = Bun.serve({
            port: WEB_PORT,
            fetch(req, server) {
                if (server.upgrade(req)) {
                    return undefined;
                }
                return new Response("Flyflor IPC WebSocket. Connect via ws://", { status: 426 });
            },
            websocket: {
                open(ws) {
                    ws.send(JSON.stringify({ kind: "agent", content: "Flyflor ready (DeepSeek V4 Flash)." }));
                },
                async message(ws, raw) {
                    const reply = await self.process(String(raw).trim());
                    ws.send(JSON.stringify(reply));
                },
            },
        });
        console.log(`[IPC] WebSocket listening at ws://127.0.0.1:${WEB_PORT}`);
    }

    /**
     * Parses an inbound frame and routes a `user` message through the conversation service.
     * @param frame - the raw inbound JSON line.
     * @returns the reply message to send back.
     */
    private async process(frame: string): Promise<IPCMessage> {
        try {
            const msg = JSON.parse(frame) as IPCMessage;
            if (msg.kind === "user" && msg.content) {
                const reply = await this.service.handleUserMessage(msg.content);
                return { kind: "agent", content: reply };
            }
            return { kind: "error", content: 'Expected {"kind":"user","content":"..."}' };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { kind: "error", content: `Parse error: ${message}` };
        }
    }

    private writeSocket(socket: { write: (s: string) => void }, msg: IPCMessage): void {
        socket.write(JSON.stringify(msg) + "\n");
    }

    /** The resolved IPC endpoint address (for AppModule to expose as `endpoint`). */
    public get endpoint(): string {
        return this.config.socketEndpoint;
    }
}
