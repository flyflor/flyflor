/**
 * BlueBubbles / iMessage 专用适配器（G-01 子项）。
 *
 * 相对 `HttpPlatformAdapter`：
 *  - 共享密码校验：BlueBubbles webhook 在 `?password=xxx` 或 `x-bluebubbles-password` 头中携带共享密码，
 *    与配置 `password` 做精确等值（timing-safe）比对；
 *  - 群聊识别：`chat.style` 为 `group` 时 `chatType = group`，否则 `direct`；
 *  - 富媒体：`attachments[]` 暴露为 `GatewayAttachment[]`（含 mimeType / size / guid）。
 *
 * 零关键词匹配；空文本 + 无附件返回 skipped。
 */

import { timingSafeEqual } from "node:crypto";
import type {
    ChannelName,
    ChatType,
    GatewayAttachment,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import { ChannelTransport, ChatType as ChatTypeValue, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery, isRecord, json, readString } from "./helpers.ts";
import { buildDeliveryMetadata } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

export interface BlueBubblesAdapterConfig {
    apiBaseUrl?: string;
    password: string;
}

export class BlueBubblesAdapter implements ChannelAdapter {
    readonly transport = ChannelTransport.Http;

    constructor(
        readonly name: ChannelName,
        private readonly config: BlueBubblesAdapterConfig,
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        if (!this.verifyPassword(request)) {
            return new Response(JSON.stringify({ ok: false, error: "invalid_password" }), {
                status: 401,
                headers: { "content-type": "application/json; charset=utf-8" },
            });
        }

        let payload: unknown;
        try {
            payload = await request.json();
        } catch {
            return json({ ok: false, error: "invalid_json" }, 400);
        }
        if (!isRecord(payload)) return json({ ok: true, skipped: "no_payload" });

        const data = isRecord(payload.data) ? payload.data : payload;
        const message = this.normalize(data, payload);
        if (!message.text && (!message.attachments || message.attachments.length === 0)) {
            return json({ ok: true, skipped: "empty" });
        }

        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.send(message.route, text),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return json({ ok: true });
    }

    private verifyPassword(request: Request): boolean {
        const headerToken = request.headers.get("x-bluebubbles-password") ?? "";
        const url = new URL(request.url);
        const queryToken = url.searchParams.get("password") ?? "";
        const received = headerToken || queryToken;
        if (!received) return false;
        const a = Buffer.from(received);
        const b = Buffer.from(this.config.password);
        if (a.length !== b.length) return false;
        try {
            return timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    private normalize(data: Record<string, unknown>, envelope: Record<string, unknown>): GatewayMessage {
        const chat = isRecord(data.chat) ? data.chat : isRecord(data.chats) && Array.isArray(data.chats) ? undefined : undefined;
        const chats = Array.isArray(data.chats) ? data.chats.filter(isRecord) : [];
        const firstChat = chat ?? (chats[0] as Record<string, unknown> | undefined);
        const style = readString(firstChat?.style);
        const chatType: ChatType = style === "group" ? ChatTypeValue.Group : ChatTypeValue.Direct;
        const chatId =
            readString(firstChat?.guid) ?? readString(data.chatGuid) ?? readString(envelope.chatGuid) ?? "unknown";
        const handle = isRecord(data.handle) ? data.handle : undefined;
        const userId = readString(handle?.address) ?? readString(data.handleId) ?? readString(data.from) ?? chatId;
        const attachments = readBlueBubblesAttachments(data.attachments);
        const route: GatewayRoute = { channel: this.name, chatId, chatType };
        return {
            id: readString(data.guid) ?? readString(data.id) ?? crypto.randomUUID(),
            route,
            user: {
                id: userId,
                displayName: readString(handle?.firstName ?? handle?.nickname),
            },
            messageKind: attachments.length > 0 ? GatewayMessageKind.Document : GatewayMessageKind.Text,
            source: {
                chatName: readString(firstChat?.displayName ?? firstChat?.name),
                messageId: readString(data.guid ?? data.id),
            },
            text: readString(data.text) ?? "",
            attachments: attachments.length > 0 ? attachments : undefined,
            raw: envelope,
            receivedAt: new Date().toISOString(),
        };
    }

    private async send(route: GatewayRoute, text: string): Promise<void> {
        if (!this.config.apiBaseUrl) return;
        const url = new URL("/api/v1/message/text", this.config.apiBaseUrl);
        url.searchParams.set("password", this.config.password);
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chatGuid: route.chatId, message: text }),
        });
        await assertPlatformResponse(response, "BlueBubbles");
    }

    async sendTyping(_route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // BlueBubbles does not expose a stable bot typing endpoint in the
        // current gateway surface.
    }
}

function readBlueBubblesAttachments(input: unknown): GatewayAttachment[] {
    if (!Array.isArray(input)) return [];
    return input.filter(isRecord).map((att): GatewayAttachment => {
        const mimeType = readString(att.mimeType);
        return {
            id: readString(att.guid),
            name: readString(att.transferName),
            mimeType,
            size: typeof att.totalBytes === "number" ? att.totalBytes : undefined,
            kind: mimeType && mimeType.startsWith("image/") ? "image" : "file",
            path: readString(att.path) ?? readString(att.url),
        };
    });
}
