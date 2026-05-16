import type { GatewayMessage } from "../../../protocol/contracts/index.ts";
import { ChannelTransport } from "../../../protocol/contracts/index.ts";
import type { ChannelAdapter } from "./types.ts";

export class StdioAdapter implements ChannelAdapter {
    public readonly name = "stdio";
    public readonly transport = ChannelTransport.Stdio;

    public async handle(): Promise<Response> {
        return new Response("stdio is not an HTTP channel", { status: 405 });
    }

    public normalize(input: unknown): GatewayMessage {
        const text = typeof input === "string" ? input : "";
        return {
            id: crypto.randomUUID(),
            route: {
                channel: "stdio",
                chatId: "local",
                chatType: "direct",
            },
            user: {
                id: "local",
            },
            text,
            raw: input,
            receivedAt: new Date().toISOString(),
        };
    }
}
