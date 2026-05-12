import type { GatewayAttachment, GatewayMessage } from "../../../protocol/contracts/index.ts";
import { ChannelTransport } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery } from "./helpers.ts";
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
    };
    document?: TelegramDocument;
    from?: {
        first_name?: string;
        id?: number | string;
        username?: string;
    };
    message_id?: number;
    message_thread_id?: number;
    photo?: TelegramPhotoSize[];
    text?: string;
    voice?: TelegramDocument;
}

interface TelegramUpdate {
    channel_post?: TelegramMessage;
    edited_message?: TelegramMessage;
    message?: TelegramMessage;
    update_id?: number;
}

export class TelegramAdapter implements ChannelAdapter {
    readonly name = "telegram";
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
            deliver: (text) => this.sendMessage(String(message.route.chatId), text),
        });
        return json({ ok: true });
    }

    private normalize(update: TelegramUpdate): GatewayMessage {
        const message = update.message ?? update.edited_message ?? update.channel_post;
        const text = message?.text ?? message?.caption ?? "";
        const chatId = message?.chat?.id ?? "unknown";
        const from = message?.from;
        const attachments = readTelegramAttachments(message);
        const threadId =
            message?.message_thread_id !== undefined ? String(message.message_thread_id) : undefined;

        return {
            id: String(update.update_id ?? message?.message_id ?? crypto.randomUUID()),
            route: {
                channel: "telegram",
                chatId: String(chatId),
                chatType: normalizeTelegramChatType(message?.chat?.type),
                threadId,
            },
            user: {
                id: String(from?.id ?? "unknown"),
                displayName: from?.username ?? from?.first_name,
            },
            text,
            attachments: attachments.length > 0 ? attachments : undefined,
            raw: update,
            receivedAt: new Date().toISOString(),
        };
    }

    private async sendMessage(chatId: string, text: string): Promise<void> {
        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
            }),
        });
        await assertPlatformResponse(response, "Telegram");
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

function normalizeTelegramChatType(value: string | undefined): GatewayMessage["route"]["chatType"] {
    if (value === "private") {
        return "direct";
    }
    if (value === "group" || value === "supergroup" || value === "channel") {
        return "group";
    }
    return "unknown";
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
