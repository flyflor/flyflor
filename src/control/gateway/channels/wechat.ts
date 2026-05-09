import { createHash } from "node:crypto";
import type { GatewayMessage } from "../../../fpc/contracts/index.ts";
import type { ChannelAdapter, MessageDispatcher } from "./types.ts";

export class WeChatOfficialAccountAdapter implements ChannelAdapter {
    readonly name = "wechat";

    constructor(private readonly token: string) {}

    async handle(request: Request, dispatch: MessageDispatcher): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === "GET") {
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

        if (payload.MsgType !== "text") {
            return xmlResponse(payload.FromUserName, payload.ToUserName, "");
        }

        const reply = await dispatch(this.normalize(payload, rawBody));
        return xmlResponse(payload.FromUserName, payload.ToUserName, reply.text);
    }

    private normalize(payload: Record<string, string>, rawBody: string): GatewayMessage {
        return {
            id: payload.MsgId ?? crypto.randomUUID(),
            route: {
                channel: "wechat",
                chatId: payload.FromUserName ?? "unknown",
                chatType: "direct",
            },
            user: {
                id: payload.FromUserName ?? "unknown",
            },
            text: payload.Content ?? "",
            raw: rawBody,
            receivedAt: new Date().toISOString(),
        };
    }

    private verifySignature(signature: string, timestamp: string, nonce: string): boolean {
        const expected = createHash("sha1").update([this.token, timestamp, nonce].sort().join("")).digest("hex");
        return expected === signature;
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
