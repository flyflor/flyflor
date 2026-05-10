import type { ChannelName, GatewayMessage, GatewayRoute } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType } from "../../../protocol/contracts/index.ts";
import {
    dispatchWithDelivery,
    assertPlatformResponse,
    isRecord,
    json,
    normalizeChatType,
    normalizeUser,
    readString,
    readTextPayload,
    truncatePlatformText,
} from "./helpers.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

export interface HttpPlatformConfig {
    accessToken?: string;
    apiBaseUrl?: string;
    baseUrl?: string;
    botToken?: string;
    channelAccessToken?: string;
    number?: string;
    phoneNumberId?: string;
    replyUrl?: string;
    token?: string;
    url?: string;
    webhookUrl?: string;
}

export class HttpPlatformAdapter implements ChannelAdapter {
    readonly transport = ChannelTransport.Http;

    constructor(
        readonly name: ChannelName,
        private readonly config: HttpPlatformConfig,
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const payload = await request.json().catch(() => undefined);
        if (this.name === Channel.Slack && isRecord(payload) && typeof payload.challenge === "string") {
            return json({ challenge: payload.challenge });
        }
        const message = this.normalize(payload);
        if (!message.text) {
            return json({ ok: true, skipped: "empty_text" });
        }
        const reply = await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.send(message.route, text),
        });
        return json({ ok: true, reply });
    }

    normalize(input: unknown): GatewayMessage {
        const payload = isRecord(input) ? input : {};
        const event = isRecord(payload.event) ? payload.event : payload;
        const message = isRecord(event.message) ? event.message : event;
        const sender = event.sender ?? event.user ?? message.from ?? payload.sender ?? payload.user ?? payload.from;
        const user = normalizeUser(sender);
        const chatId = readChatId(payload, event, message, user.id);
        return {
            id: String(
                event.event_id ?? event.id ?? message.id ?? message.message_id ?? payload.id ?? crypto.randomUUID(),
            ),
            route: {
                channel: this.name,
                chatId,
                chatType: normalizeChatType(event.chat_type ?? message.chat_type ?? message.type ?? payload.chatType),
                threadId: readString(event.thread_ts ?? event.thread_id ?? message.thread_id ?? payload.threadId),
                accountId: readString(payload.accountId ?? payload.account_id),
            },
            user,
            text: readTextPayload(message) || readTextPayload(event) || readTextPayload(payload),
            raw: input,
            receivedAt: new Date().toISOString(),
        };
    }

    private async send(route: GatewayRoute, text: string): Promise<void> {
        const content = truncatePlatformText(text, 3900);
        if (!content) {
            return;
        }
        if (await this.sendNative(route, content)) {
            return;
        }
        const target = this.config.replyUrl ?? this.config.webhookUrl;
        if (!target) {
            return;
        }
        await fetch(target, {
            method: "POST",
            headers: this.authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({
                channel: route.channel,
                chatId: route.chatId,
                threadId: route.threadId,
                text: content,
            }),
        });
    }

    private async sendNative(route: GatewayRoute, text: string): Promise<boolean> {
        if (this.name === Channel.Slack && this.config.botToken) {
            await postJson("https://slack.com/api/chat.postMessage", {
                headers: { authorization: `Bearer ${this.config.botToken}` },
                body: { channel: route.chatId, text, thread_ts: route.threadId },
            });
            return true;
        }
        if (this.name === Channel.Mattermost && this.config.baseUrl && this.config.botToken) {
            await postJson(new URL("/api/v4/posts", this.config.baseUrl).toString(), {
                headers: { authorization: `Bearer ${this.config.botToken}` },
                body: { channel_id: route.chatId, message: text, root_id: route.threadId },
            });
            return true;
        }
        if (this.name === Channel.Matrix && this.config.apiBaseUrl && this.config.accessToken) {
            await postJson(
                new URL(
                    `/_matrix/client/v3/rooms/${encodeURIComponent(route.chatId)}/send/m.room.message/${crypto.randomUUID()}`,
                    this.config.apiBaseUrl,
                ).toString(),
                {
                    headers: { authorization: `Bearer ${this.config.accessToken}` },
                    body: { msgtype: "m.text", body: text },
                },
            );
            return true;
        }
        if (this.name === Channel.Signal && this.config.apiBaseUrl && this.config.number) {
            await postJson(new URL("/v2/send", this.config.apiBaseUrl).toString(), {
                body: { number: this.config.number, recipients: [route.chatId], message: text },
            });
            return true;
        }
        if (this.name === Channel.HomeAssistant && this.config.apiBaseUrl && this.config.accessToken) {
            await postJson(new URL("/api/services/persistent_notification/create", this.config.apiBaseUrl).toString(), {
                headers: { authorization: `Bearer ${this.config.accessToken}` },
                body: { title: "Flyflor", message: text },
            });
            return true;
        }
        if (this.name === Channel.BlueBubbles && this.config.apiBaseUrl) {
            const url = new URL("/api/v1/message/text", this.config.apiBaseUrl);
            if (this.config.token) {
                url.searchParams.set("password", this.config.token);
            }
            await postJson(url.toString(), {
                body: { chatGuid: route.chatId, text },
            });
            return true;
        }
        if (this.name === Channel.Line && this.config.channelAccessToken) {
            await postJson("https://api.line.me/v2/bot/message/push", {
                headers: { authorization: `Bearer ${this.config.channelAccessToken}` },
                body: { to: route.chatId, messages: [{ type: "text", text }] },
            });
            return true;
        }
        if (this.name === Channel.WhatsApp && this.config.accessToken && this.config.phoneNumberId) {
            await postJson(`https://graph.facebook.com/v20.0/${this.config.phoneNumberId}/messages`, {
                headers: { authorization: `Bearer ${this.config.accessToken}` },
                body: {
                    messaging_product: "whatsapp",
                    to: route.chatId,
                    type: "text",
                    text: { body: text },
                },
            });
            return true;
        }
        return false;
    }

    private authHeaders(headers: Record<string, string>): Record<string, string> {
        const token = this.config.accessToken ?? this.config.botToken ?? this.config.token;
        return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
    }
}

function readChatId(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
    fallback: string,
): string {
    return String(
        message.chat_id ??
            message.chatId ??
            message.channel ??
            message.channel_id ??
            message.room_id ??
            message.from ??
            event.chat_id ??
            event.chatId ??
            event.channel ??
            event.room_id ??
            payload.chatId ??
            payload.chat_id ??
            fallback,
    );
}

async function postJson(url: string, input: { body: unknown; headers?: Record<string, string> }): Promise<void> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(input.headers ?? {}) },
        body: JSON.stringify(input.body),
    });
    await assertPlatformResponse(response, `HTTP platform ${url}`);
}
