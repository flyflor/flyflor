import { createHash, timingSafeEqual } from "node:crypto";
import type { GatewayAttachment, GatewayMessage } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import type { ChannelAdapter, MessageDispatcher } from "./types.ts";

export class WeChatOfficialAccountAdapter implements ChannelAdapter {
    public readonly name = Channel.WeChat;
    public readonly transport = ChannelTransport.Http;

    public constructor(private readonly token: string) {}

    public async handle(request: Request, dispatch: MessageDispatcher): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === "GET") {
            // Official WeChat callback verification uses the same signature
            // tuple as the platform docs: token + timestamp + nonce.
            const signature = url.searchParams.get("signature") ?? "";
            const timestamp = url.searchParams.get("timestamp") ?? "";
            const nonce = url.searchParams.get("nonce") ?? "";
            const echostr = url.searchParams.get("echostr") ?? "";
            if (!this.verifySignature(signature, timestamp, nonce)) {
                return new Response("invalid signature", { status: 401 });
            }
            return new Response(echostr);
        }

        const rawBody = await request.text();
        const payload = parseXml(rawBody);
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const signature = url.searchParams.get("signature") ?? "";
        if (!this.verifySignature(signature, timestamp, nonce)) {
            return new Response("invalid signature", { status: 401 });
        }

        const reply = await dispatch(this.normalize(payload, rawBody));
        return xmlResponse(payload.FromUserName, payload.ToUserName, reply.text);
    }

    private normalize(payload: Record<string, string>, rawBody: string): GatewayMessage {
        return {
            id: payload.MsgId ?? crypto.randomUUID(),
            route: {
                channel: Channel.WeChat,
                chatId: payload.FromUserName ?? "unknown",
                chatType: ChatType.Direct,
            },
            user: {
                id: payload.FromUserName ?? "unknown",
            },
            messageKind: normalizeMsgType(payload.MsgType),
            attachments: normalizeAttachments(payload),
            source: {
                messageId: payload.MsgId,
            },
            text: normalizeText(payload),
            metadata: normalizeMetadata(payload),
            raw: rawBody,
            receivedAt: new Date().toISOString(),
        };
    }

    private verifySignature(signature: string, timestamp: string, nonce: string): boolean {
        const expected = createHash("sha1").update([this.token, timestamp, nonce].sort().join("")).digest("hex");
        return safeEqual(expected, signature);
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

function xmlResponse(toUser: string | undefined, fromUser: string | undefined, content: string): Response {
    if (!content) {
        return new Response("success");
    }

    // WeChat expects a plain XML envelope for text replies in callback mode.
    const body = `<xml>
<ToUserName><![CDATA[${escapeCdata(toUser ?? "")}]]></ToUserName>
<FromUserName><![CDATA[${escapeCdata(fromUser ?? "")}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${escapeCdata(content)}]]></Content>
</xml>`;

    return new Response(body, {
        headers: { "content-type": "application/xml; charset=utf-8" },
    });
}

function escapeCdata(value: string): string {
    return value.replaceAll("]]>", "]]]]><![CDATA[>");
}

function normalizeMsgType(type: string | undefined): GatewayMessage["messageKind"] {
    if (type === "image") return GatewayMessageKind.Photo;
    if (type === "video") return GatewayMessageKind.Video;
    if (type === "voice") return GatewayMessageKind.Voice;
    if (type === "shortvideo") return GatewayMessageKind.Video;
    if (type === "location") return GatewayMessageKind.Location;
    if (type === "link") return GatewayMessageKind.Document;
    if (type === "event") return GatewayMessageKind.Unknown;
    return GatewayMessageKind.Text;
}

function normalizeText(payload: Record<string, string>): string {
    return (
        payload.Content ??
        payload.Recognition ??
        payload.Title ??
        payload.Description ??
        payload.Event ??
        ""
    );
}

function normalizeAttachments(payload: Record<string, string>): GatewayAttachment[] | undefined {
    const mediaId = payload.MediaId;
    const msgType = payload.MsgType;
    if (!mediaId) {
        if (payload.Url && msgType === "link") {
            return [{ kind: "file", path: payload.Url, name: payload.Title }];
        }
        return undefined;
    }
    return [
        {
            kind: msgType === "image" ? "image" : "file",
            id: mediaId,
            name: payload.Title,
        },
    ];
}

function normalizeMetadata(payload: Record<string, string>): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    for (const key of [
        "CreateTime",
        "Event",
        "EventKey",
        "Format",
        "Label",
        "Latitude",
        "Location_X",
        "Location_Y",
        "Longitude",
        "PicUrl",
        "Precision",
        "Scale",
        "ThumbMediaId",
        "Url",
    ]) {
        if (payload[key] !== undefined) {
            metadata[key] = payload[key];
        }
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
