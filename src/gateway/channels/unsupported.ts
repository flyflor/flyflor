import type { ChannelName } from "../../shared/core/types.ts";
import type { ChannelAdapter } from "./types.ts";

export class UnsupportedChannelAdapter implements ChannelAdapter {
    constructor(
        readonly name: ChannelName,
        private readonly reason: string,
    ) {}

    async handle(): Promise<Response> {
        return new Response(
            JSON.stringify({
                error: "channel_not_ready",
                channel: this.name,
                reason: this.reason,
            }),
            {
                status: 501,
                headers: { "content-type": "application/json; charset=utf-8" },
            },
        );
    }
}
