import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { WeComCallbackAdapter } from "../src/agent/gateway/channels/wecom.callback.ts";
import { Channel, ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

const TOKEN = "wecom-token";
const CORP_ID = "ww1234567890";
const AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function signedPlainUrl(timestamp: string, nonce: string, echostr = "echo"): string {
    const signature = sha1([TOKEN, timestamp, nonce].sort().join(""));
    const url = new URL("https://flyflor.test/wecom_callback");
    url.searchParams.set("signature", signature);
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("echostr", echostr);
    return url.toString();
}

function signedEncryptedUrl(encrypt: string, timestamp: string, nonce: string): string {
    const signature = sha1([TOKEN, timestamp, nonce, encrypt].sort().join(""));
    const url = new URL("https://flyflor.test/wecom_callback");
    url.searchParams.set("msg_signature", signature);
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("nonce", nonce);
    return url.toString();
}

describe("WeComCallbackAdapter", () => {
    test("verifies plaintext callback URL", async () => {
        const adapter = new WeComCallbackAdapter({ corpId: CORP_ID, token: TOKEN });
        const response = await adapter.handle(new Request(signedPlainUrl("1700000000", "nonce-1")), async () => {
            throw new Error("should not dispatch");
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("echo");
    });

    test("normalizes plaintext text callback and sends proactive reply", async () => {
        const adapter = new WeComCallbackAdapter({
            agentId: "1000002",
            corpId: CORP_ID,
            corpSecret: "corp-secret",
            token: TOKEN,
        });
        const sent: Array<{ body: Record<string, unknown>; url: string }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            if (url.includes("/cgi-bin/gettoken")) {
                return new Response(JSON.stringify({ errcode: 0, access_token: "access-token", expires_in: 7200 }));
            }
            if (url.includes("/cgi-bin/message/send")) {
                sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
                return new Response(JSON.stringify({ errcode: 0, msgid: "msg-out" }));
            }
            return originalFetch(input, init);
        }) as typeof fetch;

        let captured: { route: unknown; text: string; user: unknown } | undefined;
        const response = await adapter.handle(
            new Request("https://flyflor.test/wecom_callback", {
                method: "POST",
                headers: { "content-type": "application/xml" },
                body: [
                    "<xml>",
                    "<ToUserName>ww1234567890</ToUserName>",
                    "<FromUserName>zhangsan</FromUserName>",
                    "<CreateTime>1710000000</CreateTime>",
                    "<MsgType>text</MsgType>",
                    "<Content><![CDATA[hello wecom]]></Content>",
                    "<MsgId>123456789</MsgId>",
                    "</xml>",
                ].join(""),
            }),
            async (message) => {
                captured = { route: message.route, text: message.text, user: message.user };
                return {
                    messageId: "reply-1",
                    route: message.route,
                    text: "ack wecom",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("success");
        expect(captured?.text).toBe("hello wecom");
        expect(captured?.user).toEqual({ id: "zhangsan" });
        expect(captured?.route).toMatchObject({
            accountId: CORP_ID,
            channel: Channel.WeComCallback,
            chatId: `${CORP_ID}:zhangsan`,
            chatType: ChatType.Direct,
        });
        expect(sent[0]?.url).toContain("access-token");
        expect(sent[0]?.body).toMatchObject({
            touser: "zhangsan",
            agentid: 1000002,
            msgtype: "text",
            text: { content: "ack wecom" },
        });
    });

    test("decrypts encrypted callback XML", async () => {
        const adapter = new WeComCallbackAdapter({ aesKey: AES_KEY, corpId: CORP_ID, token: TOKEN });
        const plaintext = [
            "<xml>",
            "<ToUserName>ww1234567890</ToUserName>",
            "<FromUserName>lisi</FromUserName>",
            "<CreateTime>1710000001</CreateTime>",
            "<MsgType>text</MsgType>",
            "<Content><![CDATA[encrypted hello]]></Content>",
            "<MsgId>m2</MsgId>",
            "</xml>",
        ].join("");
        const encrypt = encryptWeComXml(plaintext);

        let text = "";
        const response = await adapter.handle(
            new Request(signedEncryptedUrl(encrypt, "1700000001", "nonce-2"), {
                method: "POST",
                headers: { "content-type": "application/xml" },
                body: `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`,
            }),
            async (message) => {
                text = message.text;
                return {
                    messageId: "reply-2",
                    route: message.route,
                    text: "",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(text).toBe("encrypted hello");
    });
});

function encryptWeComXml(xml: string): string {
    const key = Buffer.from(`${AES_KEY}=`, "base64");
    const msg = Buffer.from(xml);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(msg.length, 0);
    const payload = Buffer.concat([randomBytes(16), len, msg, Buffer.from(CORP_ID)]);
    const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padWeCom(payload)), cipher.final()]).toString("base64");
}

function padWeCom(input: Buffer): Buffer {
    const pad = 32 - (input.length % 32 || 32);
    const finalPad = pad === 0 ? 32 : pad;
    return Buffer.concat([input, Buffer.alloc(finalPad, finalPad)]);
}

function sha1(value: string): string {
    return createHash("sha1").update(value).digest("hex");
}
