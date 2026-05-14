import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelName, GatewayAttachment, GatewayMessage, GatewayRoute } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, json, readString } from "./helpers.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

const LINE_SIGNATURE_HEADER = "x-line-signature";

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
    text?: string;
    type?: string;
}

export class LineAdapter implements ChannelAdapter {
    readonly name: ChannelName = Channel.Line;
    readonly transport = ChannelTransport.Http;
    private readonly seenEvents = new Set<string>();

    constructor(
        private readonly config: LineAdapterConfig,
        private readonly now: () => number = () => Date.now(),
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
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
            const reply = await dispatch(message);
            if (event.replyToken && reply.text.trim()) {
                await this.reply(event.replyToken, reply.text);
            }
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
            text: readString(message.text) ?? "",
            attachments: readLineAttachments(message),
            raw: event,
            receivedAt: new Date(this.now()).toISOString(),
        };
    }

    private async reply(replyToken: string, text: string): Promise<void> {
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
                messages: [{ type: "text", text }],
            }),
        });
        await assertPlatformResponse(response, "LINE");
    }
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
