import { afterEach, describe, expect, test } from "bun:test";
import { FeishuAdapter } from "../src/agent/gateway/channels/feishu.ts";
import { Channel, ChatType, type GatewayMessage, type GatewayReply } from "../src/protocol/contracts/index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function request(body: unknown): Request {
    return new Request("https://flyflor.test/webhook/feishu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

function adapter(): FeishuAdapter {
    return new FeishuAdapter({
        appId: "app-id",
        appSecret: "app-secret",
        verificationToken: "verify-token",
    });
}

describe("FeishuAdapter", () => {
    test("returns url verification challenge", async () => {
        const response = await adapter().handle(
            request({ type: "url_verification", token: "verify-token", challenge: "challenge-1" }),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ challenge: "challenge-1" });
    });

    test("rejects malformed JSON", async () => {
        const response = await adapter().handle(request("{not-json"), async () => {
            throw new Error("should not dispatch");
        });
        expect(response.status).toBe(400);
    });

    test("rejects missing verification token before dispatch", async () => {
        const response = await adapter().handle(
            request({ header: { event_type: "im.message.receive_v1" } }),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(response.status).toBe(401);
    });

    test("normalizes message event and sends reply through Feishu APIs", async () => {
        const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
            sent.push({ url, body });
            if (url.includes("/auth/v3/tenant_access_token/internal")) {
                return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token", expire: 7200 }), {
                    status: 200,
                });
            }
            return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        }) as typeof fetch;

        let captured: GatewayMessage | undefined;
        const response = await adapter().handle(
            request({
                token: "verify-token",
                header: { event_id: "evt-1", event_type: "im.message.receive_v1" },
                event: {
                    message: {
                        chat_id: "chat-1",
                        chat_type: "group",
                        content: JSON.stringify({ text: "hello feishu" }),
                        message_id: "msg-1",
                        message_type: "text",
                    },
                    sender: {
                        sender_id: { open_id: "ou-user" },
                    },
                },
            }),
            async (message) => {
                captured = message;
                return {
                    messageId: "reply-1",
                    route: message.route,
                    text: "ack",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(captured?.id).toBe("evt-1");
        expect(captured?.text).toBe("hello feishu");
        expect(captured?.user.id).toBe("ou-user");
        expect(captured?.route).toMatchObject({
            channel: Channel.Feishu,
            chatId: "chat-1",
            chatType: ChatType.Group,
        });
        expect(sent[0]).toMatchObject({
            url: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            body: { app_id: "app-id", app_secret: "app-secret" },
        });
        expect(sent[1]?.url).toContain("/open-apis/im/v1/messages?receive_id_type=chat_id");
        expect(sent[1]?.body).toMatchObject({
            receive_id: "chat-1",
            msg_type: "text",
            content: JSON.stringify({ text: "ack" }),
        });
    });
});
