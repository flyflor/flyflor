import type {
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayOutboundEnvelope,
    GatewayReply,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import {
    ChannelLinkState,
    ChannelTransport,
    GatewayMessageKind,
    GatewayOutboundOperation,
} from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery, isRecord, PlatformResponseError } from "./helpers.ts";
import { buildDeliveryMetadata, channelCapabilities } from "./delivery.protocol.ts";
import type { ChannelAdapter, ChannelAdapterSnapshot, StreamingMessageDispatcher } from "./types.ts";

const ILINK_TYPING_TICKET_TTL_MS = 10 * 60 * 1000;
const ILINK_TYPING_START = 1;
const ILINK_TYPING_STOP = 2;

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
    public readonly name: "wechat" | "weixin-ilink";
    public readonly transport = ChannelTransport.Polling;
    public readonly capabilities = channelCapabilities({
        replyReference: true,
        typing: true,
    });
    private readonly seen = new Set<string>();
    private readonly typingTickets = new Map<string, { ticket: string; seenAt: number }>();
    private running = false;
    private lastError?: string;
    private lastErrorAt?: string;
    private lastInboundAt?: string;
    private lastOutboundAt?: string;
    private lastPollAt?: string;

    public constructor(
        private readonly config: IlinkConfig,
        name: "wechat" | "weixin-ilink" = "weixin-ilink",
    ) {
        this.name = name;
    }

    public async handle(): Promise<Response> {
        return new Response(
            JSON.stringify({
                ok: true,
                channel: this.name,
                mode: "polling",
            }),
            { headers: { "content-type": "application/json; charset=utf-8" } },
        );
    }

    public start(dispatch: StreamingMessageDispatcher): void {
        if (this.running) {
            return;
        }
        this.running = true;
        void this.poll(dispatch);
    }

    public snapshot(): ChannelAdapterSnapshot {
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

                    await this.dispatchUpdate(update, dispatch);
                }
            } catch (error) {
                this.lastError = String(error);
                this.lastErrorAt = new Date().toISOString();
                console.error(JSON.stringify({ type: "weixin_ilink.poll.error", error: String(error) }));
            }
            await Bun.sleep(this.config.pollIntervalMs);
        }
    }

    private async dispatchUpdate(update: IlinkUpdate, dispatch: StreamingMessageDispatcher): Promise<void> {
        const message = this.normalize(update);
        if (!message.text) {
            return;
        }
        await this.maybeFetchTypingTicket(update);
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
            metadata: buildDeliveryMetadata(message),
            operation: (operation) => this.sendOperation(operation, update),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
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

    public normalize(update: IlinkUpdate): GatewayMessage {
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

    public async sendTyping(route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        const ticket = this.readTypingTicket(route.chatId);
        if (!ticket || !this.config.token) {
            return;
        }
        await this.sendTypingStatus(route.chatId, ticket, ILINK_TYPING_START);
    }

    public async sendOperation(operation: GatewayOutboundEnvelope, sourceUpdate?: IlinkUpdate): Promise<void> {
        if (operation.operation === GatewayOutboundOperation.MessageSend && operation.text) {
            if (!sourceUpdate) {
                return;
            }
            // iLink replies require the original context_token from the inbound
            // update. Standalone MessageSend is therefore a no-op unless the
            // poll loop supplies the source update to preserve official routing.
            await this.sendReply(sourceUpdate, {
                messageId: crypto.randomUUID(),
                route: operation.route,
                text: operation.text,
            });
            this.lastOutboundAt = new Date().toISOString();
            return;
        }
        if (operation.operation === GatewayOutboundOperation.TypingStart) {
            await this.sendTyping(operation.route, operation.metadata);
            return;
        }
        if (operation.operation === GatewayOutboundOperation.TypingStop) {
            const ticket = this.readTypingTicket(operation.route.chatId);
            if (ticket && this.config.token) {
                await this.sendTypingStatus(operation.route.chatId, ticket, ILINK_TYPING_STOP);
            }
        }
    }

    private async maybeFetchTypingTicket(update: IlinkUpdate): Promise<void> {
        if (!this.config.token || !update.context_token) {
            return;
        }
        const userId = update.from_user_id ?? update.from_user_name;
        if (!userId || this.readTypingTicket(userId)) {
            return;
        }
        const body = JSON.stringify({
            base_info: normalizeBaseInfo(this.config.baseInfo),
            ilink_user_id: userId,
            context_token: update.context_token,
        });
        try {
            const response = await fetch(new URL("/ilink/bot/getconfig", this.config.apiBaseUrl), {
                method: "POST",
                headers: this.headers(body),
                body,
            });
            const payload = await assertPlatformResponse(response, "iLink getconfig");
            const ticket = readRecordString(payload, "typing_ticket");
            if (ticket) {
                this.typingTickets.set(userId, { ticket, seenAt: Date.now() });
            }
        } catch (error) {
            console.error(JSON.stringify({ type: "weixin_ilink.getconfig.failed", error: String(error) }));
        }
    }

    private readTypingTicket(userId: string): string | undefined {
        const item = this.typingTickets.get(userId);
        if (!item) {
            return undefined;
        }
        if (Date.now() - item.seenAt >= ILINK_TYPING_TICKET_TTL_MS) {
            this.typingTickets.delete(userId);
            return undefined;
        }
        return item.ticket;
    }

    private async sendTypingStatus(userId: string, ticket: string, status: number): Promise<void> {
        const body = JSON.stringify({
            base_info: normalizeBaseInfo(this.config.baseInfo),
            ilink_user_id: userId,
            typing_ticket: ticket,
            status,
        });
        const response = await fetch(new URL("/ilink/bot/sendtyping", this.config.apiBaseUrl), {
            method: "POST",
            headers: this.headers(body),
            body,
        });
        await assertPlatformResponse(response, "iLink sendtyping");
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
        throw new PlatformResponseError(
            `${platform} failed: ${ret} ${String(payload.errmsg ?? payload.message ?? "")}`,
            platform,
            { code: ret, payload },
        );
    }
}

function readRecordString(payload: unknown, key: string): string | undefined {
    if (!isRecord(payload)) {
        return undefined;
    }
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSessionExpiredError(error: unknown): boolean {
    // iLink ret=-14 is the official context-token/session expiry signal. Retry
    // logic must key off the structured code, not localized error text.
    return error instanceof PlatformResponseError && error.details.code === -14;
}

function randomWechatUin(): string {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return btoa(String(values[0] ?? Date.now()));
}
