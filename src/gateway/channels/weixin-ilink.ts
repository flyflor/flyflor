import type { GatewayMessage, GatewayReply } from "../../shared/core/types.ts";
import type { ChannelAdapter, MessageDispatcher } from "./types.ts";

interface IlinkConfig {
    apiBaseUrl: string;
    baseInfo: string;
    pollIntervalMs: number;
}

interface IlinkUpdate {
    content?: string;
    context_token?: string;
    from_user_name?: string;
    id?: string | number;
    msg_id?: string | number;
    nick_name?: string;
    text?: string;
}

export class WeixinIlinkAdapter implements ChannelAdapter {
    readonly name = "weixin-ilink";
    private readonly seen = new Set<string>();
    private running = false;

    constructor(private readonly config: IlinkConfig) {}

    async handle(): Promise<Response> {
        return new Response(
            JSON.stringify({
                ok: true,
                channel: this.name,
                mode: "polling",
            }),
            { headers: { "content-type": "application/json; charset=utf-8" } },
        );
    }

    start(dispatch: MessageDispatcher): void {
        if (this.running) {
            return;
        }
        this.running = true;
        void this.poll(dispatch);
    }

    private async poll(dispatch: MessageDispatcher): Promise<void> {
        while (this.running) {
            try {
                const updates = await this.fetchUpdates();
                for (const update of updates) {
                    const key = String(update.id ?? update.msg_id ?? update.context_token ?? crypto.randomUUID());
                    if (this.seen.has(key)) {
                        continue;
                    }
                    this.remember(key);

                    const message = this.normalize(update);
                    if (!message.text) {
                        continue;
                    }
                    const reply = await dispatch(message);
                    await this.sendReply(update, reply);
                }
            } catch (error) {
                console.error(JSON.stringify({ type: "weixin_ilink.poll.error", error: String(error) }));
            }
            await Bun.sleep(this.config.pollIntervalMs);
        }
    }

    private async fetchUpdates(): Promise<IlinkUpdate[]> {
        const response = await fetch(new URL("/getupdates", this.config.apiBaseUrl), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                base_info: this.config.baseInfo,
            }),
        });

        if (!response.ok) {
            throw new Error(`iLink getupdates failed: ${response.status}`);
        }

        return normalizeUpdates(await response.json());
    }

    private normalize(update: IlinkUpdate): GatewayMessage {
        const userId = update.from_user_name ?? "unknown";
        return {
            id: String(update.id ?? update.msg_id ?? crypto.randomUUID()),
            route: {
                channel: "weixin-ilink",
                chatId: userId,
                chatType: "direct",
            },
            user: {
                id: userId,
                displayName: update.nick_name,
            },
            text: update.text ?? update.content ?? "",
            raw: update,
            receivedAt: new Date().toISOString(),
        };
    }

    private async sendReply(update: IlinkUpdate, reply: GatewayReply): Promise<void> {
        if (!update.context_token) {
            throw new Error("iLink update missing context_token");
        }

        const response = await fetch(new URL("/sendmessage", this.config.apiBaseUrl), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                base_info: this.config.baseInfo,
                context_token: update.context_token,
                content: reply.text,
            }),
        });

        if (!response.ok) {
            throw new Error(`iLink sendmessage failed: ${response.status}`);
        }
    }

    private remember(key: string): void {
        this.seen.add(key);
        if (this.seen.size > 10_000) {
            const first = this.seen.values().next().value as string | undefined;
            if (first) {
                this.seen.delete(first);
            }
        }
    }
}

function normalizeUpdates(payload: unknown): IlinkUpdate[] {
    if (Array.isArray(payload)) {
        return payload as IlinkUpdate[];
    }
    if (isRecord(payload)) {
        const updates = payload.updates ?? payload.data ?? payload.messages;
        if (Array.isArray(updates)) {
            return updates as IlinkUpdate[];
        }
        if (isRecord(updates) && Array.isArray(updates.items)) {
            return updates.items as IlinkUpdate[];
        }
    }
    return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
