/**
 * DingTalk outgoing robot / webhook adapter.
 *
 * Boundary:
 * - Token / signature checks are protocol checks only; no natural-language routing.
 * - Inbound payloads are normalized from DingTalk's structured fields.
 * - Outbound sends text messages to a configured robot webhook. Media download/caching
 *   remains a separate attachment-security concern.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
    ChannelName,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayOutboundEnvelope,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType, GatewayMessageKind, GatewayOutboundOperation } from "../../../protocol/contracts/index.ts";
import {
    assertPlatformResponse,
    dispatchWithDelivery,
    isRecord,
    json,
    readString,
    truncatePlatformText,
} from "./helpers.ts";
import { buildDeliveryMetadata } from "./delivery.protocol.ts";
import { channelCapabilities } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

const DINGTALK_SIGNATURE_WINDOW_MS = 60 * 60 * 1000;

export interface DingTalkAdapterConfig {
    accessToken?: string;
    secret?: string;
    webhookUrl?: string;
}

export class DingTalkAdapter implements ChannelAdapter {
    readonly name: ChannelName = Channel.DingTalk;
    readonly transport = ChannelTransport.Http;
    readonly capabilities = channelCapabilities({
        cardUpdate: false,
        replyReference: true,
    });

    constructor(
        private readonly config: DingTalkAdapterConfig,
        private readonly now: () => number = () => Date.now(),
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const raw = await request.text();
        if (!this.verifyRequest(request)) {
            return json({ ok: false, error: "invalid_dingtalk_signature" }, 401);
        }

        let payload: unknown;
        try {
            payload = JSON.parse(raw);
        } catch {
            return json({ ok: false, error: "invalid_json" }, 400);
        }

        const message = this.normalize(payload);
        if (!message.text) {
            return json({ ok: true, skipped: "empty_text" });
        }

        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.send(text),
            metadata: buildDeliveryMetadata(message),
            operation: (operation) => this.sendOperation(operation),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return json({ ok: true });
    }

    private verifyRequest(request: Request): boolean {
        const url = new URL(request.url);
        if (this.config.accessToken) {
            const token =
                url.searchParams.get("access_token") ??
                request.headers.get("x-dingtalk-token") ??
                request.headers.get("x-dingtalk-access-token");
            if (token !== this.config.accessToken) return false;
        }
        if (!this.config.secret) return true;
        const timestamp = url.searchParams.get("timestamp") ?? request.headers.get("timestamp");
        const signature = url.searchParams.get("sign") ?? request.headers.get("sign");
        if (!timestamp || !signature) return false;
        const ts = Number(timestamp);
        if (!Number.isFinite(ts) || Math.abs(this.now() - ts) > DINGTALK_SIGNATURE_WINDOW_MS) return false;
        const expected = createHmac("sha256", this.config.secret)
            .update(`${timestamp}\n${this.config.secret}`)
            .digest("base64");
        return safeEqual(expected, decodeURIComponent(signature));
    }

    private normalize(input: unknown): GatewayMessage {
        const payload = isRecord(input) ? input : {};
        const conversationId = readString(payload.conversationId);
        const senderId = readString(payload.senderId) ?? readString(payload.senderStaffId) ?? "unknown";
        const msgId = readString(payload.msgId) ?? readString(payload.messageId);
        const route: GatewayRoute = {
            channel: this.name,
            chatId: conversationId ?? senderId,
            chatType: dingTalkChatType(payload.conversationType),
            accountId: readString(payload.chatbotUserId),
        };
        return {
            id: msgId ?? crypto.randomUUID(),
            route,
            user: {
                id: senderId,
                displayName: readString(payload.senderNick),
            },
            messageKind: readString(payload.command) ? GatewayMessageKind.Command : GatewayMessageKind.Text,
            source: {
                chatName: readString(payload.conversationTitle),
                messageId: msgId,
            },
            replyTo: readString(payload.replyMsgId) ? { messageId: readString(payload.replyMsgId) } : undefined,
            text: readDingTalkText(payload),
            raw: input,
            receivedAt: new Date(this.now()).toISOString(),
        };
    }

    private async send(text: string): Promise<void> {
        const content = truncatePlatformText(text, 3900);
        if (!content || !this.config.webhookUrl) return;
        const response = await fetch(this.config.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
                msgtype: "text",
                text: { content },
            }),
        });
        await assertPlatformResponse(response, "DingTalk");
    }

    async sendTyping(_route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // DingTalk robots expose no generic typing endpoint; the hook exists
        // so the gateway can keep a uniform lifecycle contract.
    }

    async sendOperation(operation: GatewayOutboundEnvelope): Promise<void> {
        if (operation.operation === GatewayOutboundOperation.MessageSend && operation.text) {
            await this.send(operation.text);
        }
        // DingTalk card streaming/update requires the official card SDK and
        // template ids. This binary-safe adapter exposes the unsupported
        // operation explicitly and falls back to final text sends.
    }
}

function dingTalkChatType(value: unknown): GatewayRoute["chatType"] {
    if (value === "1" || value === 1 || value === "single") return ChatType.Direct;
    if (value === "2" || value === 2 || value === "group") return ChatType.Group;
    return ChatType.Unknown;
}

function readDingTalkText(payload: Record<string, unknown>): string {
    const text = payload.text;
    if (typeof text === "string") return text.trim();
    if (isRecord(text)) return readString(text.content) ?? "";
    return readString(payload.content ?? payload.message) ?? "";
}

function safeEqual(a: string, b: string): boolean {
    try {
        const left = Buffer.from(a);
        const right = Buffer.from(b);
        return left.length === right.length && timingSafeEqual(left, right);
    } catch {
        return false;
    }
}
