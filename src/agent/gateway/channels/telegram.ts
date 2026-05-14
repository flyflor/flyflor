import type { GatewayAttachment, GatewayDeliveryMetadata, GatewayMessage, GatewayRoute } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType, GatewayMessageAction, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery } from "./helpers.ts";
import { buildDeliveryMetadata, readPlatformMessageId } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

interface TelegramPhotoSize {
    file_id?: string;
    file_size?: number;
    file_unique_id?: string;
    height?: number;
    width?: number;
}

interface TelegramDocument {
    file_id?: string;
    file_name?: string;
    file_size?: number;
    file_unique_id?: string;
    mime_type?: string;
}

interface TelegramMessage {
    caption?: string;
    chat?: {
        id?: number | string;
        type?: string;
        title?: string;
        username?: string;
    };
    document?: TelegramDocument;
    entities?: TelegramMessageEntity[];
    from?: {
        first_name?: string;
        id?: number | string;
        username?: string;
    };
    message_id?: number;
    message_thread_id?: number;
    photo?: TelegramPhotoSize[];
    quote?: { text?: string };
    reply_to_message?: {
        caption?: string;
        message_id?: number;
        text?: string;
    };
    text?: string;
    voice?: TelegramDocument;
}

interface TelegramMessageEntity {
    length?: number;
    offset?: number;
    type?: string;
    user?: {
        first_name?: string;
        id?: number | string;
        username?: string;
    };
}

interface TelegramUpdate {
    channel_post?: TelegramMessage;
    edited_channel_post?: TelegramMessage;
    edited_message?: TelegramMessage;
    message?: TelegramMessage;
    update_id?: number;
}

export class TelegramAdapter implements ChannelAdapter {
    readonly name = Channel.Telegram;
    readonly transport = ChannelTransport.Http;
    private readonly seenUpdates = new Set<number>();

    constructor(
        private readonly botToken: string,
        private readonly secretToken?: string,
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        if (this.secretToken) {
            const received = request.headers.get("x-telegram-bot-api-secret-token");
            if (received !== this.secretToken) {
                return json({ ok: false, error: "invalid_telegram_secret" }, 401);
            }
        }

        const update = (await request.json()) as TelegramUpdate;
        if (update.update_id !== undefined && this.seenUpdates.has(update.update_id)) {
            return json({ ok: true, duplicate: true });
        }
        if (update.update_id !== undefined) {
            this.rememberUpdate(update.update_id);
        }

        const message = this.normalize(update);
        if (!message.text) {
            return json({ ok: true, skipped: "non_text_update" });
        }

        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.sendMessage(message.route, text, buildDeliveryMetadata(message)),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return json({ ok: true });
    }

    private normalize(update: TelegramUpdate): GatewayMessage {
        const message = update.message ?? update.edited_message ?? update.edited_channel_post ?? update.channel_post;
        const text = message?.text ?? message?.caption ?? "";
        const chatId = message?.chat?.id ?? "unknown";
        const from = message?.from;
        const attachments = readTelegramAttachments(message);
        const threadId =
            message?.message_thread_id !== undefined ? String(message.message_thread_id) : undefined;
        const messageId = readPlatformMessageId(message?.message_id);
        const replyToMessageId = readPlatformMessageId(message?.reply_to_message?.message_id);
        const replyToText = message?.quote?.text ?? message?.reply_to_message?.text ?? message?.reply_to_message?.caption;

        return {
            id: String(update.update_id ?? message?.message_id ?? crypto.randomUUID()),
            route: {
                channel: Channel.Telegram,
                chatId: String(chatId),
                chatType: normalizeTelegramChatType(message?.chat?.type),
                threadId,
            },
            user: {
                id: String(from?.id ?? "unknown"),
                displayName: from?.username ?? from?.first_name,
            },
            text,
            messageAction:
                update.edited_message || update.edited_channel_post
                    ? GatewayMessageAction.Edit
                    : GatewayMessageAction.Create,
            messageKind: inferTelegramMessageKind(message),
            platformUpdateId: typeof update.update_id === "number" ? update.update_id : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
            mentions: readTelegramMentions(message, text),
            source: {
                chatName: message?.chat?.title ?? message?.chat?.username,
                messageId,
            },
            replyTo:
                replyToMessageId || replyToText
                    ? {
                          messageId: replyToMessageId,
                          text: replyToText,
                          quoteText: message?.quote?.text,
                      }
                    : undefined,
            raw: update,
            receivedAt: new Date().toISOString(),
        };
    }

    private async sendMessage(route: GatewayRoute, text: string, metadata?: GatewayDeliveryMetadata): Promise<void> {
        const body: Record<string, unknown> = {
            chat_id: route.chatId,
            text,
        };
        if (metadata?.telegramDmTopicReplyFallback && metadata.replyToMessageId && metadata.threadId) {
            body.message_thread_id = Number(metadata.threadId);
            body.reply_to_message_id = Number(metadata.replyToMessageId);
        } else if (route.threadId) {
            body.message_thread_id = Number(route.threadId);
        }
        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        await assertPlatformResponse(response, "Telegram");
    }

    async sendTyping(route: GatewayRoute, metadata?: GatewayDeliveryMetadata): Promise<void> {
        if (metadata?.telegramDmTopicReplyFallback && !metadata.replyToMessageId) {
            return;
        }
        const body: Record<string, unknown> = {
            chat_id: route.chatId,
            action: "typing",
        };
        if (route.threadId && !metadata?.telegramDmTopicReplyFallback) {
            body.message_thread_id = Number(route.threadId);
        }
        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendChatAction`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        await assertPlatformResponse(response, "Telegram typing");
    }

    private rememberUpdate(updateId: number): void {
        this.seenUpdates.add(updateId);
        if (this.seenUpdates.size > 10_000) {
            const first = this.seenUpdates.values().next().value as number | undefined;
            if (first !== undefined) {
                this.seenUpdates.delete(first);
            }
        }
    }
}

function readTelegramMentions(message: TelegramMessage | undefined, text: string): GatewayMessage["mentions"] {
    if (!message?.entities?.length) return undefined;
    const mentions = message.entities
        .filter((entity) => entity.type === "mention" || entity.type === "text_mention")
        .map((entity) => {
            const start = typeof entity.offset === "number" ? entity.offset : undefined;
            const end = start !== undefined && typeof entity.length === "number" ? start + entity.length : undefined;
            return {
                id: entity.user?.id !== undefined ? String(entity.user.id) : undefined,
                kind: entity.type,
                displayName: entity.user?.username ?? entity.user?.first_name,
                text: start !== undefined && end !== undefined ? text.slice(start, end) : undefined,
            };
        });
    return mentions.length > 0 ? mentions : undefined;
}

function normalizeTelegramChatType(value: string | undefined): GatewayMessage["route"]["chatType"] {
    if (value === "private") {
        return ChatType.Direct;
    }
    if (value === "group" || value === "supergroup" || value === "channel") {
        return ChatType.Group;
    }
    return ChatType.Unknown;
}

function inferTelegramMessageKind(message: TelegramMessage | undefined): GatewayMessage["messageKind"] {
    if (!message) return GatewayMessageKind.Unknown;
    if (message.voice) return GatewayMessageKind.Voice;
    if (message.document) return GatewayMessageKind.Document;
    if (message.photo && message.photo.length > 0) return GatewayMessageKind.Photo;
    return GatewayMessageKind.Text;
}

function readTelegramAttachments(message: TelegramMessage | undefined): GatewayAttachment[] {
    if (!message) return [];
    const out: GatewayAttachment[] = [];
    if (Array.isArray(message.photo) && message.photo.length > 0) {
        // Telegram 同一张图会以多种尺寸列出，取最后一个（通常最大）。
        const biggest = message.photo[message.photo.length - 1]!;
        if (biggest.file_id) {
            out.push({
                id: biggest.file_unique_id ?? biggest.file_id,
                kind: "image",
                mimeType: "image/jpeg",
                size: typeof biggest.file_size === "number" ? biggest.file_size : undefined,
            });
        }
    }
    if (message.document?.file_id) {
        const mimeType = message.document.mime_type;
        out.push({
            id: message.document.file_unique_id ?? message.document.file_id,
            name: message.document.file_name,
            mimeType,
            kind: mimeType && mimeType.startsWith("image/") ? "image" : "file",
            size: typeof message.document.file_size === "number" ? message.document.file_size : undefined,
        });
    }
    if (message.voice?.file_id) {
        out.push({
            id: message.voice.file_unique_id ?? message.voice.file_id,
            mimeType: message.voice.mime_type ?? "audio/ogg",
            kind: "file",
            size: typeof message.voice.file_size === "number" ? message.voice.file_size : undefined,
        });
    }
    return out;
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}
