import type {
    ChannelName,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayRoute,
    GatewayUser,
} from "../../../protocol/contracts/index.ts";
import { ChannelTransport, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import { GatewayMessageAction } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery, readString } from "./helpers.ts";
import { buildDeliveryMetadata } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

interface GenericWebhookPayload {
    accountId?: string;
    chat_id?: string;
    chatId?: string;
    chatType?: string;
    from?: string | { id?: string; name?: string; username?: string };
    id?: string;
    message?: string | { text?: string };
    messageAction?: string;
    mentions?: Array<{ id?: string; kind?: string; name?: string; text?: string; type?: string; username?: string }>;
    reaction?: string | { added?: boolean; count?: number; emoji?: string; key?: string; messageId?: string; name?: string };
    reactions?: Array<string | { added?: boolean; count?: number; emoji?: string; key?: string; messageId?: string; name?: string }>;
    sender?: string | { id?: string; name?: string; username?: string };
    text?: string;
    thread_id?: string;
    threadId?: string;
    type?: string;
    user?: string | { id?: string; name?: string; username?: string };
}

export class GenericWebhookAdapter implements ChannelAdapter {
    readonly transport = ChannelTransport.Http;

    constructor(
        readonly name: ChannelName,
        private readonly replyUrl?: string,
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const payload = await request.json().catch(() => undefined);
        const message = this.normalize(payload);
        const reply = await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.send({ route: message.route, text }),
            metadata: buildDeliveryMetadata(message),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return json({ reply });
    }

    normalize(input: unknown): GatewayMessage {
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
            messageAction: normalizeMessageAction(payload.messageAction ?? payload.type),
            messageKind: inferWebhookMessageKind(payload),
            mentions: normalizeMentions(payload.mentions),
            reactions: normalizeReactions(payload.reactions ?? (payload.reaction ? [payload.reaction] : undefined)),
            replyTo: payload.threadId || payload.thread_id ? { messageId: String(payload.threadId ?? payload.thread_id) } : undefined,
            source: {
                chatName: readString(payload.chatId ?? payload.chat_id),
                messageId: readString(payload.id),
            },
            text: normalizeText(payload),
            raw: input,
            receivedAt: new Date().toISOString(),
        };
    }

    private async send(reply: { text: string; route: GatewayRoute }): Promise<void> {
        if (!this.replyUrl) {
            return;
        }

        const response = await fetch(this.replyUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                channel: reply.route.channel,
                chatId: reply.route.chatId,
                threadId: reply.route.threadId,
                text: reply.text,
            }),
        });
        await assertPlatformResponse(response, "Webhook reply");
    }

    async sendTyping(_route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // Generic webhook delivery has no native typing signal.
    }
}

function normalizeMessageAction(value: unknown): GatewayMessage["messageAction"] {
    if (value === "edit" || value === "edited") return GatewayMessageAction.Edit;
    if (value === "delete" || value === "deleted") return GatewayMessageAction.Delete;
    if (value === "reaction") return GatewayMessageAction.Reaction;
    return GatewayMessageAction.Create;
}

function normalizeMentions(input: GenericWebhookPayload["mentions"]): GatewayMessage["mentions"] {
    if (!Array.isArray(input)) return undefined;
    const mentions = input.map((mention) => ({
        id: readString(mention.id),
        kind: readString(mention.kind ?? mention.type),
        displayName: readString(mention.name ?? mention.username),
        text: readString(mention.text),
    }));
    return mentions.length > 0 ? mentions : undefined;
}

function normalizeReactions(input: GenericWebhookPayload["reactions"]): GatewayMessage["reactions"] {
    if (!Array.isArray(input)) return undefined;
    const reactions = input
        .map((reaction) => {
            if (typeof reaction === "string") return { key: reaction };
            if (!isRecord(reaction)) return undefined;
            const key = readString(reaction.key ?? reaction.name ?? reaction.emoji);
            return key
                ? {
                      key,
                      targetMessageId: readString(reaction.messageId),
                      added: typeof reaction.added === "boolean" ? reaction.added : undefined,
                      count: typeof reaction.count === "number" ? reaction.count : undefined,
                  }
                : undefined;
        })
        .filter((reaction): reaction is NonNullable<typeof reaction> => Boolean(reaction));
    return reactions.length > 0 ? reactions : undefined;
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

function inferWebhookMessageKind(payload: GenericWebhookPayload): GatewayMessage["messageKind"] {
    if (payload.type === "command") {
        return GatewayMessageKind.Command;
    }
    if (payload.type === "comment") {
        return GatewayMessageKind.Comment;
    }
    return GatewayMessageKind.Text;
}
