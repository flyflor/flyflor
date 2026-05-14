import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { DingTalkAdapter } from "../src/agent/gateway/channels/dingtalk.ts";
import { Channel, ChatType, type GatewayMessage, type GatewayReply } from "../src/protocol/contracts/index.ts";

const ACCESS_TOKEN = "dt-token";
const SECRET = "dt-secret";
const FIXED_NOW = 1_700_000_000_000;

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function signedRequest(body: string, opts: { token?: string; timestamp?: number; sign?: string } = {}): Request {
    const timestamp = String(opts.timestamp ?? FIXED_NOW);
    const sign =
        opts.sign ??
        encodeURIComponent(createHmac("sha256", SECRET).update(`${timestamp}\n${SECRET}`).digest("base64"));
    const url = new URL("https://flyflor.test/webhook/dingtalk");
    url.searchParams.set("access_token", opts.token ?? ACCESS_TOKEN);
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("sign", sign);
    return new Request(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
    });
}

function buildAdapter(webhookUrl?: string): DingTalkAdapter {
    return new DingTalkAdapter({ accessToken: ACCESS_TOKEN, secret: SECRET, webhookUrl }, () => FIXED_NOW);
}

describe("DingTalkAdapter", () => {
    test("rejects wrong token before dispatch", async () => {
        const adapter = buildAdapter();
        const response = await adapter.handle(
            signedRequest(JSON.stringify({ text: { content: "hello" } }), { token: "bad" }),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(response.status).toBe(401);
    });

    test("rejects stale signature before dispatch", async () => {
        const adapter = buildAdapter();
        const response = await adapter.handle(
            signedRequest(JSON.stringify({ text: { content: "hello" } }), {
                timestamp: FIXED_NOW - 2 * 60 * 60 * 1000,
            }),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(response.status).toBe(401);
    });

    test("normalizes outgoing robot group message", async () => {
        const adapter = buildAdapter();
        const body = JSON.stringify({
            conversationId: "cid-group",
            conversationType: "2",
            chatbotUserId: "bot-1",
            msgId: "msg-1",
            senderId: "user-1",
            senderNick: "Alice",
            text: { content: "hello from ding" },
        });

        let captured: GatewayMessage | undefined;
        const response = await adapter.handle(signedRequest(body), async (message) => {
            captured = message;
            return {
                messageId: "reply-1",
                route: message.route,
                text: "ack",
                metadata: { engine: "test" },
            } satisfies GatewayReply;
        });

        expect(response.status).toBe(200);
        expect(captured?.id).toBe("msg-1");
        expect(captured?.text).toBe("hello from ding");
        expect(captured?.user).toEqual({ id: "user-1", displayName: "Alice" });
        expect(captured?.route).toMatchObject({
            channel: Channel.DingTalk,
            chatId: "cid-group",
            chatType: ChatType.Group,
            accountId: "bot-1",
        });
    });

    test("sends text replies to configured robot webhook", async () => {
        const webhookUrl = "https://oapi.dingtalk.test/robot/send";
        const adapter = buildAdapter(webhookUrl);
        const posted: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            if (String(input) === webhookUrl) {
                posted.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
                return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
            }
            return originalFetch(input, init);
        }) as typeof fetch;

        const response = await adapter.handle(
            signedRequest(
                JSON.stringify({
                    conversationId: "cid",
                    conversationType: "1",
                    senderId: "u1",
                    text: { content: "ping" },
                }),
            ),
            async (message) => ({
                messageId: "reply-1",
                route: message.route,
                text: "pong",
                metadata: { engine: "test" },
            }),
        );

        expect(response.status).toBe(200);
        expect(posted).toEqual([{ msgtype: "text", text: { content: "pong" } }]);
    });
});
