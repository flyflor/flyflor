import { createHash } from "node:crypto";
import type { GatewayMessage, GatewayReply } from "../../../protocol/contracts/index.ts";
import { ChannelTransport } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery } from "./helpers.ts";
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
    readonly name = "feishu";
    readonly transport = ChannelTransport.Http;
    private tenantToken?: { expiresAt: number; value: string };

    constructor(private readonly config: FeishuConfig) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const rawBody = await request.text();
        const payload = JSON.parse(rawBody) as FeishuPayload;

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
                }),
        });
        return json({ ok: true });
    }

    private verifyRequest(request: Request, rawBody: string, payload: FeishuPayload): boolean {
        if (this.config.verificationToken && payload.token && payload.token !== this.config.verificationToken) {
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
                channel: "feishu",
                chatId: event?.message?.chat_id ?? senderId,
                chatType: event?.message?.chat_type === "p2p" ? "direct" : "group",
            },
            user: {
                id: senderId,
            },
            text: content,
            raw: payload,
            receivedAt: new Date().toISOString(),
        };
    }

    private async sendReply(reply: GatewayReply): Promise<void> {
        const token = await this.getTenantAccessToken();
        const receiveIdType = reply.route.chatId.startsWith("ou_") ? "open_id" : "chat_id";

        const response = await fetch(
            `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    receive_id: reply.route.chatId,
                    msg_type: "text",
                    content: JSON.stringify({ text: reply.text }),
                }),
            },
        );
        await assertPlatformResponse(response, "Feishu");
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
