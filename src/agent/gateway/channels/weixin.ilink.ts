import type { GatewayDeliveryMetadata, GatewayMessage, GatewayReply } from "../../../protocol/contracts/index.ts";
import { ChannelLinkState, ChannelTransport, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery, isRecord } from "./helpers.ts";
import { buildDeliveryMetadata } from "./delivery.protocol.ts";
import type { ChannelAdapter, ChannelAdapterSnapshot, StreamingMessageDispatcher } from "./types.ts";

interface IlinkConfig {
    accountId?: string;
    apiBaseUrl: string;
    baseInfo: Record<string, unknown> | string;
    pollIntervalMs: number;
    syncBuf?: string;
    token?: string;
    userId?: string;
}

interface IlinkUpdate {
    chat_room_id?: string;
    content?: string;
    context_token?: string;
    from_user_id?: string;
    from_user_name?: string;
    id?: string | number;
    item_list?: IlinkItem[];
    message_id?: string | number;
    msg_type?: number;
    msg_id?: string | number;
    nick_name?: string;
    room_id?: string;
    text?: string;
    to_user_id?: string;
}

interface IlinkItem {
    ref_msg?: {
        message_item?: IlinkItem;
        title?: string;
    };
    text_item?: { text?: string };
    type?: number;
    voice_item?: { text?: string };
}

export class WeixinIlinkAdapter implements ChannelAdapter {
    readonly name: "wechat" | "weixin-ilink";
    readonly transport = ChannelTransport.Polling;
    private readonly seen = new Set<string>();
    private running = false;
    private lastError?: string;
    private lastErrorAt?: string;
    private lastInboundAt?: string;
    private lastOutboundAt?: string;
    private lastPollAt?: string;

    constructor(
        private readonly config: IlinkConfig,
        name: "wechat" | "weixin-ilink" = "weixin-ilink",
    ) {
        this.name = name;
    }

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

    start(dispatch: StreamingMessageDispatcher): void {
        if (this.running) {
            return;
        }
        this.running = true;
        void this.poll(dispatch);
    }

    snapshot(): ChannelAdapterSnapshot {
        return {
            connected: this.running,
            detail: this.running
                ? `iLink polling${this.lastPollAt ? `; last poll ${this.lastPollAt}` : ""}`
                : "iLink ready, waiting for polling",
            lastError: this.lastError,
            lastErrorAt: this.lastErrorAt,
            lastInboundAt: this.lastInboundAt,
            lastOutboundAt: this.lastOutboundAt,
            state: this.running ? ChannelLinkState.Polling : ChannelLinkState.Waiting,
            streaming: false,
        };
    }

    private async poll(dispatch: StreamingMessageDispatcher): Promise<void> {
        while (this.running) {
            try {
                this.lastPollAt = new Date().toISOString();
                const updates = await this.fetchUpdates();
                this.lastError = undefined;
                this.lastErrorAt = undefined;
                for (const update of updates) {
                    if (this.config.accountId && update.from_user_id === this.config.accountId) {
                        continue;
                    }
                    const key = String(update.id ?? update.msg_id ?? update.context_token ?? crypto.randomUUID());
                    if (this.seen.has(key)) {
                        continue;
                    }
                    this.remember(key);

                    const message = this.normalize(update);
                    if (!message.text) {
                        continue;
                    }
                    this.lastInboundAt = message.receivedAt;
                    await dispatchWithDelivery({
                        dispatch,
                        message,
                        deliver: async (text) => {
                            await this.sendReply(update, {
                                messageId: crypto.randomUUID(),
                                route: message.route,
                                text,
                            });
                            this.lastOutboundAt = new Date().toISOString();
                        },
                        typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
                    });
                }
            } catch (error) {
                this.lastError = String(error);
                this.lastErrorAt = new Date().toISOString();
                console.error(JSON.stringify({ type: "weixin_ilink.poll.error", error: String(error) }));
            }
            await Bun.sleep(this.config.pollIntervalMs);
        }
    }

    private async fetchUpdates(): Promise<IlinkUpdate[]> {
        const body = JSON.stringify({
            base_info: normalizeBaseInfo(this.config.baseInfo),
            get_updates_buf: this.config.syncBuf ?? "",
        });
        const response = await fetch(new URL("/ilink/bot/getupdates", this.config.apiBaseUrl), {
            method: "POST",
            headers: this.headers(body),
            body,
        });

        if (!response.ok) {
            throw new Error(`iLink getupdates failed: ${response.status}`);
        }

        const payload = await response.json();
        assertIlinkOk(payload, "iLink getupdates");
        if (isRecord(payload) && typeof payload.get_updates_buf === "string") {
            this.config.syncBuf = payload.get_updates_buf;
        }
        return normalizeUpdates(payload);
    }

    normalize(update: IlinkUpdate): GatewayMessage {
        const userId = update.from_user_id ?? update.from_user_name ?? "unknown";
        const { chatId, chatType } = normalizeChat(update, userId, this.config.accountId);
        return {
            id: String(update.id ?? update.message_id ?? update.msg_id ?? crypto.randomUUID()),
            route: {
                channel: this.name,
                chatId,
                chatType,
            },
            user: {
                id: userId,
                displayName: update.nick_name,
            },
            messageKind: inferIlinkMessageKind(update),
            text: update.text ?? update.content ?? extractIlinkText(update.item_list),
            source: {
                chatName: update.room_id,
                messageId: String(update.id ?? update.message_id ?? update.msg_id ?? ""),
            },
            replyTo: update.context_token ? { messageId: update.context_token } : undefined,
            raw: update,
            receivedAt: new Date().toISOString(),
        };
    }

    private async sendReply(update: IlinkUpdate, reply: GatewayReply): Promise<void> {
        try {
            await this.sendReplyOnce(update, reply, update.context_token);
        } catch (error) {
            if (!isSessionExpiredError(error) || !update.context_token) {
                throw error;
            }
            await this.sendReplyOnce(update, reply, undefined);
        }
    }

    private async sendReplyOnce(
        update: IlinkUpdate,
        reply: GatewayReply,
        contextToken: string | undefined,
    ): Promise<void> {
        const body = JSON.stringify({
            base_info: normalizeBaseInfo(this.config.baseInfo),
            msg: {
                from_user_id: "",
                to_user_id: reply.route.chatId,
                client_id: crypto.randomUUID(),
                message_type: 2,
                message_state: 2,
                ...(contextToken ? { context_token: contextToken } : {}),
                item_list: [{ type: 1, text_item: { text: reply.text } }],
            },
        });
        const response = await fetch(new URL("/ilink/bot/sendmessage", this.config.apiBaseUrl), {
            method: "POST",
            headers: this.headers(body),
            body,
        });
        await assertPlatformResponse(response, "iLink sendmessage");
    }

    async sendTyping(_route: import("../../../protocol/contracts/index.ts").GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // The iLink bot API surface does not expose typing lifecycle calls.
    }

    private headers(body: string): Record<string, string> {
        return {
            "Content-Length": String(new TextEncoder().encode(body).byteLength),
            "Content-Type": "application/json",
            AuthorizationType: "ilink_bot_token",
            "X-WECHAT-UIN": randomWechatUin(),
            "iLink-App-Id": "bot",
            "iLink-App-ClientVersion": String((2 << 16) | (2 << 8)),
            ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        };
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

function normalizeChat(
    update: IlinkUpdate,
    userId: string,
    accountId: string | undefined,
): { chatId: string; chatType: "direct" | "group" } {
    const roomId = update.room_id || update.chat_room_id;
    if (roomId) {
        return { chatId: roomId, chatType: "group" };
    }
    if (update.msg_type === 1 && accountId && update.to_user_id && update.to_user_id !== accountId) {
        return { chatId: update.to_user_id, chatType: "group" };
    }
    return { chatId: userId, chatType: "direct" };
}

function normalizeUpdates(payload: unknown): IlinkUpdate[] {
    if (Array.isArray(payload)) {
        return payload as IlinkUpdate[];
    }
    if (isRecord(payload)) {
        const updates = payload.updates ?? payload.data ?? payload.messages ?? payload.msgs;
        if (Array.isArray(updates)) {
            return updates as IlinkUpdate[];
        }
        if (isRecord(updates) && Array.isArray(updates.items)) {
            return updates.items as IlinkUpdate[];
        }
    }
    return [];
}

function normalizeBaseInfo(value: IlinkConfig["baseInfo"]): Record<string, unknown> {
    if (isRecord(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (isRecord(parsed)) {
                return parsed;
            }
        } catch {
            return { channel_version: value };
        }
    }
    return { channel_version: "2.2.0" };
}

function extractIlinkText(items: IlinkUpdate["item_list"]): string {
    if (!Array.isArray(items)) {
        return "";
    }
    const text = items
        .map((item) => {
            if (item.type === 1) {
                return item.text_item?.text ?? "";
            }
            if (item.type === 34 && isRecord(item) && isRecord(item.voice_item)) {
                return typeof item.voice_item.text === "string" ? item.voice_item.text : "";
            }
            if (isRecord(item) && isRecord(item.ref_msg)) {
                const ref = item.ref_msg;
                const refItem = isRecord(ref.message_item) ? ref.message_item : undefined;
                const quoted = refItem ? extractIlinkText([refItem as IlinkItem]) : "";
                const current =
                    isRecord(item.text_item) && typeof item.text_item.text === "string" ? item.text_item.text : "";
                return [quoted ? `[quote: ${quoted}]` : "", current].filter(Boolean).join("\n");
            }
            return "";
        })
        .filter(Boolean)
        .join("\n");
    return text.trim();
}

function inferIlinkMessageKind(update: IlinkUpdate): GatewayMessage["messageKind"] {
    if (update.msg_type === 2) {
        return GatewayMessageKind.Voice;
    }
    if (update.msg_type === 3) {
        return GatewayMessageKind.Video;
    }
    if (update.msg_type === 4) {
        return GatewayMessageKind.Document;
    }
    return GatewayMessageKind.Text;
}

function assertIlinkOk(payload: unknown, platform: string): void {
    if (!isRecord(payload)) {
        return;
    }
    const ret = payload.ret ?? payload.errcode ?? payload.code;
    if (typeof ret === "number" && ret !== 0) {
        throw new Error(`${platform} failed: ${ret} ${String(payload.errmsg ?? payload.message ?? "")}`);
    }
}

function isSessionExpiredError(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    return text.includes("-14") || text.toLowerCase().includes("session expired");
}

function randomWechatUin(): string {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return btoa(String(values[0] ?? Date.now()));
}
