import type { ChannelName, GatewayMessage, GatewayRoute, GatewayUser } from "../../shared/core/types.ts";
import type { ChannelAdapter, MessageDispatcher } from "./types.ts";

interface GenericWebhookPayload {
    accountId?: string;
    chat_id?: string;
    chatId?: string;
    chatType?: string;
    from?: string | { id?: string; name?: string; username?: string };
    id?: string;
    message?: string | { text?: string };
    sender?: string | { id?: string; name?: string; username?: string };
    text?: string;
    thread_id?: string;
    threadId?: string;
    type?: string;
    user?: string | { id?: string; name?: string; username?: string };
}

export class GenericWebhookAdapter implements ChannelAdapter {
    constructor(
        readonly name: ChannelName,
        private readonly replyUrl?: string,
    ) {}

    async handle(request: Request, dispatch: MessageDispatcher): Promise<Response> {
        const payload = await request.json().catch(() => undefined);
        const message = this.normalize(payload);
        const reply = await dispatch(message);
        await this.send(reply);
        return json({ reply });
    }

    private normalize(input: unknown): GatewayMessage {
        const payload = isRecord(input) ? (input as GenericWebhookPayload) : {};
        const user = normalizeUser(payload.user ?? payload.sender ?? payload.from);
        const route: GatewayRoute = {
            channel: this.name,
            chatId: String(payload.chatId ?? payload.chat_id ?? user.id),
            chatType: normalizeChatType(payload.chatType ?? payload.type),
            threadId: payload.threadId ?? payload.thread_id,
            accountId: payload.accountId,
        };

        return {
            id: String(payload.id ?? crypto.randomUUID()),
            route,
            user,
            text: normalizeText(payload),
            raw: input,
            receivedAt: new Date().toISOString(),
        };
    }

    private async send(reply: { text: string; route: GatewayRoute }): Promise<void> {
        if (!this.replyUrl) {
            return;
        }

        await fetch(this.replyUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                channel: reply.route.channel,
                chatId: reply.route.chatId,
                threadId: reply.route.threadId,
                text: reply.text,
            }),
        });
    }
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

function normalizeText(payload: GenericWebhookPayload): string {
    if (typeof payload.text === "string") {
        return payload.text;
    }
    if (typeof payload.message === "string") {
        return payload.message;
    }
    if (isRecord(payload.message) && typeof payload.message.text === "string") {
        return payload.message.text;
    }
    return "";
}

function normalizeUser(value: GenericWebhookPayload["user"]): GatewayUser {
    if (typeof value === "string") {
        return { id: value };
    }
    if (isRecord(value)) {
        return {
            id: String(value.id ?? value.username ?? "unknown"),
            displayName: value.name ?? value.username,
        };
    }
    return { id: "unknown" };
}

function normalizeChatType(value: unknown): GatewayRoute["chatType"] {
    if (value === "direct" || value === "group" || value === "thread") {
        return value;
    }
    return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
