import { FModule, Module, Inject, Init } from "@/core";
import { ConfigComponent } from "@/shard/components/config";

/**
 * The IPC module: external↔kernel boundary via Unix socket / Windows named pipe.
 * Listens on `config.socketEndpoint`, speaks JSONL `CapillaryPacket` frames.
 * Early-dev: socket opens and echoes frames for connectivity test.
 */
@Module()
export class IPCModule extends FModule {
    @Inject() private readonly config!: ConfigComponent;

    private server?: any;

    @Init()
    public async init(): Promise<void> {
        const endpoint = this.config.socketEndpoint;
        const isWindows = process.platform === "win32";

        const handler = {
            open: (socket: any) => console.log(`[IPC] Client connected`),
            data: (socket: any, data: any) => {
                const frame = Buffer.from(data).toString("utf8").trim();
                console.log(`[IPC] RX: ${frame}`);
                socket.write(JSON.stringify({ kind: "notice", topic: "ipc.echo", payload: { frame } }) + "\n");
            },
            close: () => console.log(`[IPC] Client disconnected`),
            error: (_s: any, e: any) => console.error(`[IPC] Error:`, e),
        };

        if (isWindows) {
            this.server = Bun.listen({ hostname: "127.0.0.1", port: 17878, socket: handler });
        } else {
            this.server = Bun.listen({ unix: endpoint, socket: handler });
        }

        console.log(`[IPC] Listening at ${endpoint}`);
    }

    public get endpoint(): string {
        return this.config.socketEndpoint;
    }
}
