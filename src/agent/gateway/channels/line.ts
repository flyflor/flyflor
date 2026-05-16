import { createHmac, timingSafeEqual } from "node:crypto";
import type {
    ChannelName,
    GatewayAttachment,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayOutboundEnvelope,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import {
    Channel,
    ChannelTransport,
    ChatType,
    GatewayMessageKind,
    GatewayOutboundOperation,
} from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery, json, readString, truncatePlatformText } from "./helpers.ts";
import { buildDeliveryMetadata, channelCapabilities } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

const LINE_SIGNATURE_HEADER = "x-line-signature";
const LINE_LOADING_SECONDS = 20;

export interface LineAdapterConfig {
    channelAccessToken?: string;
    channelSecret?: string;
}

interface LineWebhookBody {
    destination?: string;
    events?: LineWebhookEvent[];
}

interface LineWebhookEvent {
    message?: LineMessage;
    replyToken?: string;
    source?: LineSource;
    type?: string;
    webhookEventId?: string;
}

interface LineSource {
    groupId?: string;
    roomId?: string;
    type?: string;
    userId?: string;
}

interface LineMessage {
    fileName?: string;
    id?: string;
    quoteToken?: string;
    text?: string;
    type?: string;
}

export class LineAdapter implements ChannelAdapter {
    public readonly name: ChannelName = Channel.Line;
    public readonly transport = ChannelTransport.Http;
    public readonly capabilities = channelCapabilities({
        replyReference: true,
        typing: true,
    });
    private readonly seenEvents = new Set<string>();

    public constructor(
        private readonly config: LineAdapterConfig,
        private readonly now: () => number = () => Date.now(),
    ) {}

    public async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const raw = await request.text();
        if (!this.verifySignature(request, raw)) {
            return json({ ok: false, error: "invalid_signature" }, 401);
        }

        let payload: LineWebhookBody;
        try {
            payload = JSON.parse(raw) as LineWebhookBody;
        } catch {
            return json({ ok: false, error: "invalid_json" }, 400);
        }

        const events = Array.isArray(payload.events) ? payload.events : [];
        let processed = 0;
        for (const event of events) {
            if (!this.shouldProcess(event)) {
                continue;
            }
            const message = this.normalize(event, payload.destination);
            if (!message.text && (!message.attachments || message.attachments.length === 0)) {
                continue;
            }
            processed += 1;
            const metadata = buildDeliveryMetadata(message);
            await dispatchWithDelivery({
                dispatch,
                message,
                deliver: (text) => this.sendFinal(message.route, event.replyToken, text, metadata),
                metadata,
                operation: (operation) =>
                    this.sendOperation({
                        ...operation,
                        metadata: operation.metadata ?? metadata,
                        raw: { replyToken: event.replyToken },
                    }),
                typing: () => this.sendTyping(message.route, metadata),
            });
        }
        return json({ ok: true, processed });
    }

    private verifySignature(request: Request, raw: string): boolean {
        const secret = this.config.channelSecret;
        if (!secret) return false;
        const signature = request.headers.get(LINE_SIGNATURE_HEADER);
        if (!signature) return false;
        const expected = createHmac("sha256", secret).update(raw).digest("base64");
        try {
            const a = Buffer.from(expected);
            const b = Buffer.from(signature);
            return a.length === b.length && timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    private shouldProcess(event: LineWebhookEvent): boolean {
        if (!event || event.type !== "message" || !event.message) {
            return false;
        }
        const key = event.webhookEventId ?? event.replyToken ?? event.message.id;
        if (!key) {
            return true;
        }
        if (this.seenEvents.has(key)) {
            return false;
        }
        this.seenEvents.add(key);
        if (this.seenEvents.size > 10_000) {
            const first = this.seenEvents.values().next().value as string | undefined;
            if (first) {
                this.seenEvents.delete(first);
            }
        }
        return true;
    }

    private normalize(event: LineWebhookEvent, destination?: string): GatewayMessage {
        const source = event.source ?? {};
        const message = event.message ?? {};
        const route: GatewayRoute = {
            channel: this.name,
            chatId: readString(source.groupId ?? source.roomId ?? source.userId) ?? "unknown",
            chatType: lineChatType(source.type),
            accountId: readString(destination),
        };
        return {
            id: readString(event.webhookEventId ?? message.id ?? event.replyToken) ?? crypto.randomUUID(),
            route,
            user: { id: readString(source.userId) ?? "unknown" },
            messageKind: normalizeLineMessageKind(message.type),
            source: {
                chatName: readString(source.groupId ?? source.roomId ?? source.userId),
                messageId: readString(message.id),
            },
            // LINE replyToken is a short-lived send credential. Only quoteToken
            // is a durable protocol anchor for native quoted replies.
            replyTo: message.quoteToken ? { messageId: message.quoteToken } : undefined,
            text: readString(message.text) ?? "",
            attachments: readLineAttachments(message),
            raw: event,
            receivedAt: new Date(this.now()).toISOString(),
        };
    }

    public async sendOperation(operation: GatewayOutboundEnvelope): Promise<void> {
        if (operation.operation === GatewayOutboundOperation.TypingStart) {
            await this.sendTyping(operation.route, operation.metadata);
            return;
        }
        if (operation.operation === GatewayOutboundOperation.MessageSend && operation.text) {
            const replyToken = readString(operation.raw?.replyToken);
            await this.sendFinal(operation.route, replyToken, operation.text, operation.metadata);
        }
    }

    private async sendFinal(
        route: GatewayRoute,
        replyToken: string | undefined,
        text: string,
        metadata?: GatewayDeliveryMetadata,
    ): Promise<void> {
        const content = truncatePlatformText(text.trim(), 5000);
        if (!content) {
            return;
        }
        if (replyToken) {
            try {
                await this.reply(replyToken, content, metadata);
                return;
            } catch (error) {
                console.error(JSON.stringify({ type: "line.reply.failed", error: String(error) }));
            }
        }
        await this.push(route, content, metadata);
    }

    private async reply(replyToken: string, text: string, metadata?: GatewayDeliveryMetadata): Promise<void> {
        if (!this.config.channelAccessToken) {
            return;
        }
        const response = await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                authorization: `Bearer ${this.config.channelAccessToken}`,
            },
            body: JSON.stringify({
                replyToken,
                messages: [lineTextMessage(text, metadata)],
            }),
        });
        await assertPlatformResponse(response, "LINE");
    }

    private async push(route: GatewayRoute, text: string, metadata?: GatewayDeliveryMetadata): Promise<void> {
        if (!this.config.channelAccessToken) {
            return;
        }
        const response = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                authorization: `Bearer ${this.config.channelAccessToken}`,
            },
            body: JSON.stringify({
                to: route.chatId,
                messages: [lineTextMessage(text, metadata)],
            }),
        });
        await assertPlatformResponse(response, "LINE push");
    }

    public async sendTyping(route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        if (!this.config.channelAccessToken || route.chatType !== ChatType.Direct) {
            return;
        }
        const response = await fetch("https://api.line.me/v2/bot/chat/loading/start", {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                authorization: `Bearer ${this.config.channelAccessToken}`,
            },
            body: JSON.stringify({
                chatId: route.chatId,
                loadingSeconds: LINE_LOADING_SECONDS,
            }),
        });
        await assertPlatformResponse(response, "LINE loading");
    }
}

function lineTextMessage(text: string, metadata?: GatewayDeliveryMetadata): Record<string, unknown> {
    return {
        type: "text",
        text,
        ...(metadata?.replyToMessageId ? { quoteToken: metadata.replyToMessageId } : {}),
    };
}

function lineChatType(sourceType: string | undefined): GatewayMessage["route"]["chatType"] {
    if (sourceType === "user") {
        return ChatType.Direct;
    }
    if (sourceType === "group" || sourceType === "room") {
        return ChatType.Group;
    }
    return ChatType.Unknown;
}

function readLineAttachments(message: LineMessage): GatewayAttachment[] {
    if (message.type === "image") {
        return [{ id: message.id, kind: "image" }];
    }
    if (message.type === "video" || message.type === "audio" || message.type === "file") {
        return [{ id: message.id, kind: "file", name: message.fileName }];
    }
    return [];
}

function normalizeLineMessageKind(type: string | undefined): GatewayMessage["messageKind"] {
    if (type === "image") {
        return GatewayMessageKind.Photo;
    }
    if (type === "video") {
        return GatewayMessageKind.Video;
    }
    if (type === "audio") {
        return GatewayMessageKind.Audio;
    }
    if (type === "file") {
        return GatewayMessageKind.Document;
    }
    return GatewayMessageKind.Text;
}
