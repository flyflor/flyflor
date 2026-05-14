import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { WeChatOfficialAccountAdapter } from "../src/agent/gateway/channels/wechat.ts";
import { Channel, ChatType, GatewayMessageKind, type GatewayReply } from "../src/protocol/contracts/index.ts";

function signedUrl(path: string, token: string, timestamp: string, nonce: string, echostr = "echo"): string {
    const signature = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
    const url = new URL(path);
    url.searchParams.set("signature", signature);
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("echostr", echostr);
    return url.toString();
}

describe("WeChatOfficialAccountAdapter", () => {
    test("verifies callback URL with the official signature flow", async () => {
        const adapter = new WeChatOfficialAccountAdapter("wechat-token");
        const response = await adapter.handle(
            new Request(signedUrl("https://flyflor.test/wechat", "wechat-token", "1700000000", "nonce-1")),
            async () => {
                throw new Error("should not dispatch");
            },
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("echo");
    });

    test("normalizes text XML and returns an XML reply", async () => {
        const adapter = new WeChatOfficialAccountAdapter("wechat-token");
        let captured: { text: string; route: unknown; kind?: string } | undefined;
        const response = await adapter.handle(
            new Request(
                signedUrl("https://flyflor.test/wechat", "wechat-token", "1700000000", "nonce-2", "ignored"),
                {
                    method: "POST",
                    headers: { "content-type": "application/xml" },
                    body: [
                        "<xml>",
                        "<ToUserName><![CDATA[gh_bot]]></ToUserName>",
                        "<FromUserName><![CDATA[user-1]]></FromUserName>",
                        "<CreateTime>1700000000</CreateTime>",
                        "<MsgType><![CDATA[text]]></MsgType>",
                        "<Content><![CDATA[hello official WeChat]]></Content>",
                        "<MsgId>123</MsgId>",
                        "</xml>",
                    ].join(""),
                },
            ),
            async (message) => {
                captured = { text: message.text, route: message.route, kind: message.messageKind };
                return {
                    messageId: "reply-1",
                    route: message.route,
                    text: "ack from flyflor",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(captured?.text).toBe("hello official WeChat");
        expect(captured?.kind).toBe(GatewayMessageKind.Text);
        expect(captured?.route).toMatchObject({
            channel: Channel.WeChat,
            chatId: "user-1",
            chatType: ChatType.Direct,
        });
        const body = await response.text();
        expect(body).toContain("<MsgType><![CDATA[text]]></MsgType>");
        expect(body).toContain("<Content><![CDATA[ack from flyflor]]></Content>");
    });

    test("normalizes image XML with media attachment", async () => {
        const adapter = new WeChatOfficialAccountAdapter("wechat-token");
        let captured:
            | {
                  attachments?: Array<{ id?: string; kind: string; name?: string }>;
                  kind?: string;
                  metadata?: Record<string, unknown>;
                  text: string;
              }
            | undefined;
        const response = await adapter.handle(
            new Request(
                signedUrl("https://flyflor.test/wechat", "wechat-token", "1700000000", "nonce-3", "ignored"),
                {
                    method: "POST",
                    headers: { "content-type": "application/xml" },
                    body: [
                        "<xml>",
                        "<ToUserName><![CDATA[gh_bot]]></ToUserName>",
                        "<FromUserName><![CDATA[user-2]]></FromUserName>",
                        "<CreateTime>1700000000</CreateTime>",
                        "<MsgType><![CDATA[image]]></MsgType>",
                        "<PicUrl><![CDATA[https://mmbiz.test/pic.jpg]]></PicUrl>",
                        "<MediaId><![CDATA[media-1]]></MediaId>",
                        "<MsgId>456</MsgId>",
                        "</xml>",
                    ].join(""),
                },
            ),
            async (message) => {
                captured = {
                    attachments: message.attachments,
                    kind: message.messageKind,
                    metadata: message.metadata,
                    text: message.text,
                };
                return {
                    messageId: "reply-2",
                    route: message.route,
                    text: "",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("success");
        expect(captured?.text).toBe("");
        expect(captured?.kind).toBe(GatewayMessageKind.Photo);
        expect(captured?.attachments).toEqual([{ id: "media-1", kind: "image", name: undefined }]);
        expect(captured?.metadata).toMatchObject({ PicUrl: "https://mmbiz.test/pic.jpg" });
    });

    test("normalizes voice recognition and location protocol metadata", async () => {
        const adapter = new WeChatOfficialAccountAdapter("wechat-token");
        const captured: Array<{ kind?: string; metadata?: Record<string, unknown>; text: string }> = [];
        for (const [nonce, body] of [
            [
                "nonce-4",
                [
                    "<xml>",
                    "<ToUserName><![CDATA[gh_bot]]></ToUserName>",
                    "<FromUserName><![CDATA[user-3]]></FromUserName>",
                    "<MsgType><![CDATA[voice]]></MsgType>",
                    "<MediaId><![CDATA[voice-1]]></MediaId>",
                    "<Format><![CDATA[amr]]></Format>",
                    "<Recognition><![CDATA[hello by voice]]></Recognition>",
                    "<MsgId>789</MsgId>",
                    "</xml>",
                ].join(""),
            ],
            [
                "nonce-5",
                [
                    "<xml>",
                    "<ToUserName><![CDATA[gh_bot]]></ToUserName>",
                    "<FromUserName><![CDATA[user-4]]></FromUserName>",
                    "<MsgType><![CDATA[location]]></MsgType>",
                    "<Location_X>23.134521</Location_X>",
                    "<Location_Y>113.358803</Location_Y>",
                    "<Scale>20</Scale>",
                    "<Label><![CDATA[Guangzhou]]></Label>",
                    "<MsgId>790</MsgId>",
                    "</xml>",
                ].join(""),
            ],
        ] as const) {
            await adapter.handle(
                new Request(signedUrl("https://flyflor.test/wechat", "wechat-token", "1700000000", nonce), {
                    method: "POST",
                    headers: { "content-type": "application/xml" },
                    body,
                }),
                async (message) => {
                    captured.push({
                        kind: message.messageKind,
                        metadata: message.metadata,
                        text: message.text,
                    });
                    return {
                        messageId: crypto.randomUUID(),
                        route: message.route,
                        text: "",
                        metadata: { engine: "test" },
                    } satisfies GatewayReply;
                },
            );
        }

        expect(captured[0]).toMatchObject({
            kind: GatewayMessageKind.Voice,
            text: "hello by voice",
            metadata: { Format: "amr" },
        });
        expect(captured[1]).toMatchObject({
            kind: GatewayMessageKind.Location,
            text: "",
            metadata: {
                Label: "Guangzhou",
                Location_X: "23.134521",
                Location_Y: "113.358803",
                Scale: "20",
            },
        });
    });
});
