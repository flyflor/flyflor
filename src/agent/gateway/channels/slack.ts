/**
 * Slack 事件 API 专用适配器（G-01 子项）。
 *
 * 相对 `HttpPlatformAdapter`：
 *  - HMAC-SHA256 签名校验：`x-slack-signature = v0=<hex(hmac(signingSecret, "v0:" + ts + ":" + body))>`，
 *    时间戳窗口 5 分钟内有效，超出即拒；
 *  - 兼容 `url_verification` challenge；
 *  - 区分 IM（`channel_type==="im"`）/ 群组（`channel`/`group`）/ thread；
 *  - 富媒体：把 `files[]` 暴露为 `GatewayAttachment[]`；
 *  - 不做关键词识别；空文本 + 无附件返回 skipped。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
    ChannelName,
    ChatType,
    GatewayAttachment,
    GatewayMessage,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType as ChatTypeValue } from "../../../protocol/contracts/index.ts";
import {
    assertPlatformResponse,
    dispatchWithDelivery,
    isRecord,
    json,
    readString,
} from "./helpers.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

const SLACK_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export interface SlackAdapterConfig {
    botToken?: string;
    signingSecret?: string;
}

export class SlackAdapter implements ChannelAdapter {
    readonly name: ChannelName = Channel.Slack;
    readonly transport = ChannelTransport.Http;

    constructor(
        private readonly config: SlackAdapterConfig,
        private readonly now: () => number = () => Date.now(),
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const raw = await request.text();
        const verified = this.verifySignature(request, raw);
        if (!verified) {
            return new Response(JSON.stringify({ ok: false, error: "invalid_signature" }), {
                status: 401,
                headers: { "content-type": "application/json; charset=utf-8" },
            });
        }

        let payload: unknown;
        try {
            payload = JSON.parse(raw);
        } catch {
            return json({ ok: false, error: "invalid_json" }, 400);
        }

        if (isRecord(payload) && payload.type === "url_verification" && typeof payload.challenge === "string") {
            return json({ challenge: payload.challenge });
        }

        const event = isRecord(payload) && isRecord(payload.event) ? (payload.event as Record<string, unknown>) : undefined;
        if (!event) {
            return json({ ok: true, skipped: "no_event" });
        }
        if (event.subtype === "bot_message" || event.bot_id) {
            return json({ ok: true, skipped: "bot_echo" });
        }

        const message = this.normalize(event, payload as Record<string, unknown>);
        if (!message.text && (!message.attachments || message.attachments.length === 0)) {
            return json({ ok: true, skipped: "empty" });
        }

        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.send(message.route, text),
        });
        return json({ ok: true });
    }

    private verifySignature(request: Request, body: string): boolean {
        const secret = this.config.signingSecret;
        if (!secret) {
            // 未配置 signingSecret 时拒绝所有未签名请求；调用方需显式配置才能放行。
            return false;
        }
        const sig = request.headers.get("x-slack-signature");
        const ts = request.headers.get("x-slack-request-timestamp");
        if (!sig || !ts) return false;
        const tsNum = Number(ts);
        if (!Number.isFinite(tsNum)) return false;
        if (Math.abs(this.now() - tsNum * 1000) > SLACK_SIGNATURE_WINDOW_MS) return false;
        const expected = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
        try {
            const a = Buffer.from(expected);
            const b = Buffer.from(sig);
            if (a.length !== b.length) return false;
            return timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    private normalize(event: Record<string, unknown>, payload: Record<string, unknown>): GatewayMessage {
        const userId = readString(event.user) ?? "unknown";
        const chatId = readString(event.channel) ?? userId;
        const chatType = readSlackChatType(event);
        const threadId = readString(event.thread_ts);
        const route: GatewayRoute = {
            channel: this.name,
            chatId,
            chatType,
            threadId,
            accountId: readString(payload.team_id),
        };
        const attachments = readSlackFiles(event.files);
        return {
            id: readString(event.client_msg_id) ?? readString(event.event_ts) ?? readString(event.ts) ?? crypto.randomUUID(),
            route,
            user: {
                id: userId,
                displayName: readString(event.user_name),
            },
            text: readString(event.text) ?? "",
            attachments: attachments.length > 0 ? attachments : undefined,
            raw: event,
            receivedAt: new Date().toISOString(),
        };
    }

    private async send(route: GatewayRoute, text: string): Promise<void> {
        if (!this.config.botToken) return;
        const body: Record<string, unknown> = { channel: route.chatId, text };
        if (route.threadId) body.thread_ts = route.threadId;
        const response = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "content-type": "application/json; charset=utf-8",
                authorization: `Bearer ${this.config.botToken}`,
            },
            body: JSON.stringify(body),
        });
        await assertPlatformResponse(response, "Slack");
    }
}

function readSlackChatType(event: Record<string, unknown>): ChatType {
    const channelType = readString(event.channel_type);
    if (channelType === "im") return ChatTypeValue.Direct;
    if (channelType === "channel" || channelType === "group" || channelType === "mpim") return ChatTypeValue.Group;
    return ChatTypeValue.Unknown;
}

function readSlackFiles(input: unknown): GatewayAttachment[] {
    if (!Array.isArray(input)) return [];
    return input
        .filter(isRecord)
        .map((file): GatewayAttachment => {
            const mimeType = readString(file.mimetype);
            const kind: GatewayAttachment["kind"] = mimeType && mimeType.startsWith("image/") ? "image" : "file";
            const size = typeof file.size === "number" ? file.size : undefined;
            return {
                id: readString(file.id),
                name: readString(file.name),
                mimeType,
                size,
                kind,
                path: readString(file.url_private_download) ?? readString(file.url_private),
            };
        });
}
