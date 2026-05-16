import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import type { GatewayAttachment, GatewayDeliveryMetadata, GatewayMessage, GatewayRoute } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery } from "./helpers.ts";
import { buildDeliveryMetadata } from "./delivery.protocol.ts";
import type { ChannelAdapter, ChannelAdapterSnapshot, StreamingMessageDispatcher } from "./types.ts";

interface WeComCallbackConfig {
    aesKey?: string;
    agentId?: string;
    corpId: string;
    corpSecret?: string;
    token: string;
}

interface AccessTokenCache {
    expiresAt: number;
    token: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 7200;
const DEDUP_TTL_MS = 5 * 60 * 1000;

export class WeComCallbackAdapter implements ChannelAdapter {
    public readonly name = Channel.WeComCallback;
    public readonly transport = ChannelTransport.Http;
    private readonly seen = new Map<string, number>();
    private accessToken?: AccessTokenCache;
    private lastInboundAt?: string;
    private lastOutboundAt?: string;

    public constructor(private readonly config: WeComCallbackConfig) {}

    public async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === "GET") {
            return this.handleVerify(url);
        }

        const rawBody = await request.text();
        const decrypted = this.decryptCallbackBody(rawBody, url);
        const payload = parseXml(decrypted);
        const message = this.normalize(payload, decrypted);
        if (!message || this.isDuplicate(message.id)) {
            return text("success");
        }

        this.lastInboundAt = message.receivedAt;
        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: async (content, reply) => {
                await this.send(message.route, content, buildDeliveryMetadata(message));
                if (reply) {
                    reply.delivery = { ...(reply.delivery ?? {}), outcome: "success" };
                }
                this.lastOutboundAt = new Date().toISOString();
            },
            metadata: buildDeliveryMetadata(message),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return text("success");
    }

    public snapshot(): ChannelAdapterSnapshot {
        return {
            connected: true,
            detail: "WeCom callback ready",
            lastInboundAt: this.lastInboundAt,
            lastOutboundAt: this.lastOutboundAt,
        };
    }

    public async sendTyping(_route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // WeCom application messages do not expose a typing lifecycle API.
    }

    private handleVerify(url: URL): Response {
        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const echostr = url.searchParams.get("echostr") ?? "";
        if (this.config.aesKey) {
            return text(this.decryptEncryptedValue(echostr, msgSignature, timestamp, nonce));
        }
        const signature = url.searchParams.get("signature") ?? "";
        if (!verifyPlainSignature(this.config.token, signature, timestamp, nonce)) {
            return text("signature verification failed", 403);
        }
        return text(echostr);
    }

    private decryptCallbackBody(rawBody: string, url: URL): string {
        const encrypted = parseXml(rawBody).Encrypt;
        if (!encrypted) {
            return rawBody;
        }
        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        return this.decryptEncryptedValue(encrypted, msgSignature, timestamp, nonce);
    }

    private decryptEncryptedValue(encrypted: string, msgSignature: string, timestamp: string, nonce: string): string {
        if (!this.config.aesKey) {
            throw new Error("WeCom callback encrypted payload requires aesKey");
        }
        const expected = sha1([this.config.token, timestamp, nonce, encrypted].sort().join(""));
        if (!safeEqual(expected, msgSignature)) {
            throw new Error("WeCom callback signature mismatch");
        }
        const key = Buffer.from(`${this.config.aesKey}=`, "base64");
        const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
        decipher.setAutoPadding(false);
        const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
        const plain = unpadWeCom(padded);
        const content = plain.subarray(16);
        const xmlLength = content.readUInt32BE(0);
        const xml = content.subarray(4, 4 + xmlLength).toString("utf8");
        const receiveId = content.subarray(4 + xmlLength).toString("utf8");
        if (receiveId !== this.config.corpId) {
            throw new Error("WeCom callback receive id mismatch");
        }
        return xml;
    }

    private normalize(payload: Record<string, string>, raw: string): GatewayMessage | undefined {
        const msgType = payload.MsgType?.toLowerCase();
        if (msgType === "event" && (payload.Event === "subscribe" || payload.Event === "enter_agent")) {
            return undefined;
        }
        const userId = payload.FromUserName ?? "unknown";
        const corpId = payload.ToUserName ?? this.config.corpId;
        return {
            id: payload.MsgId ?? `${userId}:${payload.CreateTime ?? Date.now()}`,
            route: {
                channel: Channel.WeComCallback,
                chatId: `${corpId}:${userId}`,
                chatType: ChatType.Direct,
                accountId: corpId,
            },
            user: { id: userId },
            messageKind: normalizeMsgType(msgType),
            attachments: normalizeAttachments(payload),
            source: {
                chatName: userId,
                messageId: payload.MsgId,
            },
            text: payload.Content ?? payload.Event ?? payload.Recognition ?? "",
            metadata: normalizeMetadata(payload),
            raw,
            receivedAt: new Date().toISOString(),
        };
    }

    private isDuplicate(id: string): boolean {
        const now = Date.now();
        const seenAt = this.seen.get(id);
        if (seenAt && now - seenAt < DEDUP_TTL_MS) {
            return true;
        }
        this.seen.set(id, now);
        if (this.seen.size > 2000) {
            for (const [key, value] of this.seen) {
                if (now - value >= DEDUP_TTL_MS) {
                    this.seen.delete(key);
                }
            }
        }
        return false;
    }

    private async send(route: GatewayRoute, content: string, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        if (!content || !this.config.corpSecret || !this.config.agentId) {
            return;
        }
        const token = await this.getAccessToken();
        const touser = route.chatId.includes(":") ? route.chatId.split(":").at(-1)! : route.chatId;
        const response = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    touser,
                    msgtype: "text",
                    agentid: Number(this.config.agentId),
                    text: { content: content.slice(0, 2048) },
                    safe: 0,
                }),
            },
        );
        await assertPlatformResponse(response, "WeCom callback send");
    }

    private async getAccessToken(): Promise<string> {
        const now = Date.now();
        if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
            return this.accessToken.token;
        }
        const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
        url.searchParams.set("corpid", this.config.corpId);
        url.searchParams.set("corpsecret", this.config.corpSecret ?? "");
        const response = await fetch(url);
        const payload = await assertPlatformResponse(response, "WeCom callback gettoken");
        const token = typeof (payload as { access_token?: unknown } | undefined)?.access_token === "string"
            ? (payload as { access_token: string }).access_token
            : undefined;
        if (!token) {
            throw new Error("WeCom callback gettoken returned no access_token");
        }
        const ttl = typeof (payload as { expires_in?: unknown }).expires_in === "number"
            ? (payload as { expires_in: number }).expires_in
            : ACCESS_TOKEN_TTL_SECONDS;
        this.accessToken = { token, expiresAt: now + ttl * 1000 };
        return token;
    }
}

function parseXml(xml: string): Record<string, string> {
    const result: Record<string, string> = {};
    const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[(.*?)\]\]>|([^<]*))<\/\1>/g;
    for (const match of xml.matchAll(pattern)) {
        result[match[1]!] = match[2] ?? match[3] ?? "";
    }
    return result;
}

function normalizeMsgType(type: string | undefined): GatewayMessage["messageKind"] {
    if (type === "image") return GatewayMessageKind.Photo;
    if (type === "video") return GatewayMessageKind.Video;
    if (type === "voice") return GatewayMessageKind.Voice;
    if (type === "location") return GatewayMessageKind.Location;
    return GatewayMessageKind.Text;
}

function normalizeAttachments(payload: Record<string, string>): GatewayAttachment[] | undefined {
    if (!payload.MediaId) {
        return undefined;
    }
    return [{ id: payload.MediaId, kind: payload.MsgType === "image" ? "image" : "file" }];
}

function normalizeMetadata(payload: Record<string, string>): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    for (const key of ["AgentID", "CreateTime", "Event", "EventKey", "Format", "MsgType", "PicUrl"]) {
        if (payload[key] !== undefined) {
            metadata[key] = payload[key];
        }
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function verifyPlainSignature(token: string, signature: string, timestamp: string, nonce: string): boolean {
    return safeEqual(sha1([token, timestamp, nonce].sort().join("")), signature);
}

function sha1(value: string): string {
    return createHash("sha1").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function unpadWeCom(input: Buffer): Buffer {
    const pad = input.at(-1) ?? 0;
    if (pad < 1 || pad > 32) {
        throw new Error("invalid WeCom callback padding");
    }
    return input.subarray(0, input.length - pad);
}

function text(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
    });
}
