import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { LineAdapter } from "../src/agent/gateway/channels/line.ts";
import { Channel, ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

const TOKEN = "line-channel-token";
const SECRET = "line-channel-secret";

function signedRequest(body: string, signature?: string): Request {
    return new Request("https://flyflor.test/gateway/line", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-line-signature": signature ?? createHmac("sha256", SECRET).update(body).digest("base64"),
        },
        body,
    });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("LineAdapter", () => {
    test("rejects invalid signature", async () => {
        const adapter = new LineAdapter({ channelAccessToken: TOKEN, channelSecret: SECRET });
        const response = await adapter.handle(signedRequest(JSON.stringify({ events: [] }), "bad"), async () => {
            throw new Error("should not dispatch");
        });
        expect(response.status).toBe(401);
    });

    test("normalizes message event, starts official loading and replies once with replyToken", async () => {
        const adapter = new LineAdapter({ channelAccessToken: TOKEN, channelSecret: SECRET });
        const body = JSON.stringify({
            destination: "line-bot-id",
            events: [
                {
                    type: "message",
                    webhookEventId: "evt-1",
                    replyToken: "reply-1",
                    source: { type: "user", userId: "user-1" },
                    message: { id: "msg-1", quoteToken: "quote-1", type: "text", text: "hello" },
                },
            ],
        });

        let captured: { route: unknown; text: string; attachments?: unknown } | undefined;
        const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            if (String(input).startsWith("https://api.line.me/v2/bot/")) {
                calls.push({
                    url: String(input),
                    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
                });
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            return originalFetch(input, init);
        }) as typeof fetch;

        const response = await adapter.handle(signedRequest(body), async (message) => {
            captured = { route: message.route, text: message.text, attachments: message.attachments };
            return {
                messageId: "reply",
                route: message.route,
                text: "ack",
                metadata: { engine: "test" },
            } satisfies GatewayReply;
        });

        expect(response.status).toBe(200);
        expect(captured?.text).toBe("hello");
        expect(captured?.route).toMatchObject({
            channel: Channel.Line,
            chatId: "user-1",
            chatType: ChatType.Direct,
        });
        expect(calls.map((call) => call.url)).toEqual([
            "https://api.line.me/v2/bot/chat/loading/start",
            "https://api.line.me/v2/bot/message/reply",
        ]);
        expect(calls[0]?.body).toMatchObject({ chatId: "user-1", loadingSeconds: 20 });
        expect(calls[1]?.body).toMatchObject({
            replyToken: "reply-1",
            messages: [{ type: "text", text: "ack", quoteToken: "quote-1" }],
        });
    });

    test("falls back to push when reply token delivery fails", async () => {
        const adapter = new LineAdapter({ channelAccessToken: TOKEN, channelSecret: SECRET });
        const body = JSON.stringify({
            events: [
                {
                    type: "message",
                    webhookEventId: "evt-push-fallback",
                    replyToken: "expired-reply",
                    source: { type: "group", groupId: "group-1", userId: "user-1" },
                    message: { id: "msg-2", type: "text", text: "hello group" },
                },
            ],
        });
        const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            calls.push({
                url,
                body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            });
            if (url === "https://api.line.me/v2/bot/message/reply") {
                return new Response(JSON.stringify({ message: "Invalid reply token" }), { status: 400 });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch;

        const response = await adapter.handle(signedRequest(body), async (message) => ({
            messageId: "reply",
            route: message.route,
            text: "fallback ack",
        }));

        expect(response.status).toBe(200);
        expect(calls.map((call) => call.url)).toEqual([
            "https://api.line.me/v2/bot/message/reply",
            "https://api.line.me/v2/bot/message/push",
        ]);
        expect(calls[1]?.body).toMatchObject({
            to: "group-1",
            messages: [{ type: "text", text: "fallback ack" }],
        });
    });
});
