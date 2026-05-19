import { createHash } from "node:crypto";
import type {
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayOutboundEnvelope,
    GatewayReply,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType, GatewayMessageKind, GatewayOutboundOperation } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery } from "./helpers.ts";
import { buildDeliveryMetadata, channelCapabilities } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

interface FeishuConfig {
    appId: string;
    appSecret: string;
    encryptKey?: string;
    verificationToken?: string;
}

interface FeishuPayload {
    challenge?: string;
    event?: {
        message?: {
            chat_id?: string;
            chat_type?: string;
            content?: string;
            message_id?: string;
            message_type?: string;
            parent_id?: string;
            root_id?: string;
        };
        sender?: {
            sender_id?: {
                open_id?: string;
                user_id?: string;
            };
            sender_type?: string;
        };
    };
    header?: {
        event_id?: string;
        event_type?: string;
    };
    token?: string;
    type?: string;
}

export class FeishuAdapter implements ChannelAdapter {
    public readonly name = Channel.Feishu;
    public readonly transport = ChannelTransport.Http;
    public readonly capabilities = channelCapabilities({
        messageUpdate: true,
        replyReference: true,
        thread: true,
    });
    private tenantToken?: { expiresAt: number; value: string };

    public constructor(private readonly config: FeishuConfig) {}

    public async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const rawBody = await request.text();
        let payload: FeishuPayload;
        try {
            payload = JSON.parse(rawBody) as FeishuPayload;
        } catch {
            return json({ error: "invalid_json" }, 400);
        }

        if (payload.type === "url_verification" && payload.challenge) {
            return json({ challenge: payload.challenge });
        }

        if (!this.verifyRequest(request, rawBody, payload)) {
            return json({ error: "invalid_feishu_signature" }, 401);
        }

        if (payload.header?.event_type !== "im.message.receive_v1") {
            return json({ ok: true, skipped: "unsupported_feishu_event" });
        }

        const message = this.normalize(payload);
        if (!message.text) {
            return json({ ok: true, skipped: "non_text_message" });
        }

        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) =>
                this.sendReply({
                    messageId: crypto.randomUUID(),
                    route: message.route,
                    text,
                }, buildDeliveryMetadata(message)),
            metadata: buildDeliveryMetadata(message),
            operation: (operation) =>
                this.sendOperation({ ...operation, metadata: operation.metadata ?? buildDeliveryMetadata(message) }),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return json({ ok: true });
    }

    private verifyRequest(request: Request, rawBody: string, payload: FeishuPayload): boolean {
        // 配置了 verificationToken 就必须匹配；缺失 token 也拒绝，避免无凭据 payload 误入站。
        if (this.config.verificationToken && payload.token !== this.config.verificationToken) {
            return false;
        }

        if (!this.config.encryptKey) {
            return true;
        }

        const timestamp = request.headers.get("x-lark-request-timestamp");
        const nonce = request.headers.get("x-lark-request-nonce");
        const signature = request.headers.get("x-lark-signature");
        if (!timestamp || !nonce || !signature) {
            return false;
        }

        const expected = createHash("sha256")
            .update(timestamp + nonce + this.config.encryptKey + rawBody)
            .digest("hex");
        return timingSafeEqualString(expected, signature);
    }

    private normalize(payload: FeishuPayload): GatewayMessage {
        const event = payload.event;
        const content = parseFeishuContent(event?.message?.content);
        const senderId = event?.sender?.sender_id?.open_id ?? event?.sender?.sender_id?.user_id ?? "unknown";

        return {
            id: payload.header?.event_id ?? event?.message?.message_id ?? crypto.randomUUID(),
            route: {
                channel: Channel.Feishu,
                chatId: event?.message?.chat_id ?? senderId,
                chatType: event?.message?.chat_type === "p2p" ? ChatType.Direct : ChatType.Group,
                threadId: event?.message?.root_id,
            },
            user: {
                id: senderId,
            },
            text: content,
            messageKind: normalizeFeishuMessageKind(event?.message?.message_type),
            source: {
                messageId: event?.message?.message_id,
            },
            replyTo:
                event?.message?.parent_id || event?.message?.root_id
                    ? {
                          messageId: event?.message?.parent_id ?? event?.message?.root_id,
                      }
                    : undefined,
            raw: payload,
            receivedAt: new Date().toISOString(),
        };
    }

    private async sendReply(reply: GatewayReply, metadata?: GatewayDeliveryMetadata): Promise<void> {
        const token = await this.getTenantAccessToken();
        const receiveIdType = reply.route.chatId.startsWith("ou_") ? "open_id" : "chat_id";
        const body: Record<string, unknown> = {
            receive_id: reply.route.chatId,
            msg_type: "text",
            content: JSON.stringify({ text: reply.text }),
        };
        if (metadata?.replyToMessageId) {
            body.reply_in_thread = true;
        }

        const response = await fetch(
            `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(body),
            },
        );
        const payload = await assertPlatformResponse(response, "Feishu");
        const messageId = readFeishuMessageId(payload);
        if (messageId) {
            reply.delivery = { messageId, outcome: "success", rawResponse: payload };
        }
    }

    public async sendTyping(_route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // Feishu open platform does not expose a generic bot typing endpoint for
        // ordinary IM messages; the method exists so the gateway lifecycle has
        // a uniform channel contract.
    }

    public async sendOperation(operation: GatewayOutboundEnvelope): Promise<void> {
        if (operation.operation === GatewayOutboundOperation.MessageSend && operation.text) {
            await this.sendReply(
                { messageId: crypto.randomUUID(), route: operation.route, text: operation.text },
                operation.metadata,
            );
            return;
        }
        if (operation.operation === GatewayOutboundOperation.MessageEdit && operation.text && operation.targetMessageId) {
            const token = await this.getTenantAccessToken();
            const response = await fetch(
                `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(operation.targetMessageId)}`,
                {
                    method: "PATCH",
                    headers: {
                        authorization: `Bearer ${token}`,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        content: JSON.stringify({ text: operation.text }),
                    }),
                },
            );
            await assertPlatformResponse(response, "Feishu update");
        }
    }

    private async getTenantAccessToken(): Promise<string> {
        if (this.tenantToken && this.tenantToken.expiresAt > Date.now() + 60_000) {
            return this.tenantToken.value;
        }

        const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                app_id: this.config.appId,
                app_secret: this.config.appSecret,
            }),
        });
        const payload = (await assertPlatformResponse(response, "Feishu tenant token")) as {
            expire?: number;
            tenant_access_token?: string;
        };
        if (!payload.tenant_access_token) {
            throw new Error("Feishu tenant token failed: missing tenant_access_token");
        }

        this.tenantToken = {
            value: payload.tenant_access_token,
            expiresAt: Date.now() + (payload.expire ?? 7200) * 1000,
        };
        return this.tenantToken.value;
    }
}

function readFeishuMessageId(payload: unknown): string | undefined {
    const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    const data = typeof record.data === "object" && record.data !== null ? (record.data as Record<string, unknown>) : record;
    const messageId = data.message_id ?? data.messageId;
    return typeof messageId === "string" && messageId.trim() ? messageId.trim() : undefined;
}

function parseFeishuContent(content: string | undefined): string {
    if (!content) {
        return "";
    }
    try {
        const parsed = JSON.parse(content) as { text?: string };
        return parsed.text ?? "";
    } catch {
        return content;
    }
}

function normalizeFeishuMessageKind(kind: string | undefined): GatewayMessage["messageKind"] {
    if (kind === "image") return GatewayMessageKind.Photo;
    if (kind === "file") return GatewayMessageKind.Document;
    if (kind === "audio") return GatewayMessageKind.Audio;
    return GatewayMessageKind.Text;
}

function timingSafeEqualString(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let result = 0;
    for (let index = 0; index < a.length; index += 1) {
        result |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return result === 0;
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}
