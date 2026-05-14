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

    test("normalizes message event and replies once with replyToken", async () => {
        const adapter = new LineAdapter({ channelAccessToken: TOKEN, channelSecret: SECRET });
        const body = JSON.stringify({
            destination: "line-bot-id",
            events: [
                {
                    type: "message",
                    webhookEventId: "evt-1",
                    replyToken: "reply-1",
                    source: { type: "group", groupId: "group-1", userId: "user-1" },
                    message: { id: "msg-1", type: "text", text: "hello" },
                },
            ],
        });

        let captured: { route: unknown; text: string; attachments?: unknown } | undefined;
        const replies: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            if (String(input) === "https://api.line.me/v2/bot/message/reply") {
                replies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
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
            chatId: "group-1",
            chatType: ChatType.Group,
        });
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({
            replyToken: "reply-1",
        });
    });
});
