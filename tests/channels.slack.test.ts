/**
 * Slack 适配器签名 + 富媒体 + 群组识别测试（G-01 子项）。
 */

import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { SlackAdapter } from "../src/agent/gateway/channels/slack.ts";
import { Channel, ChatType } from "../src/protocol/contracts/index.ts";
import type { GatewayReply } from "../src/protocol/contracts/index.ts";

const SECRET = "test-signing-secret";
const FIXED_NOW = 1_700_000_000_000;

function signedRequest(body: string, opts: { ts?: number; signature?: string } = {}): Request {
    const tsSeconds = Math.floor((opts.ts ?? FIXED_NOW) / 1000);
    const expected = createHmac("sha256", SECRET).update(`v0:${tsSeconds}:${body}`).digest("hex");
    return new Request("https://flyflor.test/gateway/slack", {
        method: "POST",
        headers: {
            "x-slack-signature": opts.signature ?? `v0=${expected}`,
            "x-slack-request-timestamp": String(tsSeconds),
            "content-type": "application/json",
        },
        body,
    });
}

function buildAdapter(opts: { botToken?: string } = {}): SlackAdapter {
    return new SlackAdapter({ signingSecret: SECRET, botToken: opts.botToken }, () => FIXED_NOW);
}

const noopDispatch = async (): Promise<GatewayReply> => ({
    messageId: "test",
    route: { channel: Channel.Slack, chatId: "x", chatType: ChatType.Direct },
    text: "",
    metadata: { engine: "test" },
});

describe("SlackAdapter signature verification", () => {
    test("rejects when signature missing", async () => {
        const adapter = buildAdapter();
        const request = new Request("https://flyflor.test/gateway/slack", {
            method: "POST",
            body: JSON.stringify({ type: "url_verification", challenge: "abc" }),
        });
        const response = await adapter.handle(request, noopDispatch);
        expect(response.status).toBe(401);
    });

    test("rejects when signature mismatches", async () => {
        const adapter = buildAdapter();
        const response = await adapter.handle(
            signedRequest(JSON.stringify({ type: "url_verification" }), { signature: "v0=deadbeef" }),
            noopDispatch,
        );
        expect(response.status).toBe(401);
    });

    test("rejects when timestamp outside 5-minute window", async () => {
        const adapter = buildAdapter();
        const response = await adapter.handle(
            signedRequest(JSON.stringify({ type: "url_verification" }), { ts: FIXED_NOW - 10 * 60 * 1000 }),
            noopDispatch,
        );
        expect(response.status).toBe(401);
    });

    test("returns challenge on valid url_verification", async () => {
        const adapter = buildAdapter();
        const body = JSON.stringify({ type: "url_verification", challenge: "hello" });
        const response = await adapter.handle(signedRequest(body), noopDispatch);
        expect(response.status).toBe(200);
        const json = (await response.json()) as { challenge: string };
        expect(json.challenge).toBe("hello");
    });
});

describe("SlackAdapter event normalize", () => {
    test("im event marked as direct chat with attachments", async () => {
        const adapter = buildAdapter();
        const payload = JSON.stringify({
            team_id: "T123",
            event: {
                user: "U1",
                channel: "D9",
                channel_type: "im",
                text: "look",
                ts: "1700000000.0001",
                files: [
                    {
                        id: "F1",
                        name: "snap.png",
                        mimetype: "image/png",
                        size: 4096,
                        url_private: "https://files.test/F1",
                    },
                ],
            },
        });

        let captured: { route: unknown; attachments: unknown } | undefined;
        const dispatch = async (message: import("../src/protocol/contracts/index.ts").GatewayMessage) => {
            captured = { route: message.route, attachments: message.attachments };
            return {
                messageId: "test",
                route: message.route,
                text: "ack",
                metadata: { engine: "test" },
            } as GatewayReply;
        };
        const response = await adapter.handle(signedRequest(payload), dispatch);
        expect(response.status).toBe(200);
        expect(captured).toBeDefined();
        const route = captured!.route as { channel: string; chatType: string; chatId: string };
        expect(route.channel).toBe(Channel.Slack);
        expect(route.chatType).toBe(ChatType.Direct);
        expect(route.chatId).toBe("D9");
        const attachments = captured!.attachments as Array<{ kind: string; name: string }>;
        expect(attachments).toHaveLength(1);
        expect(attachments[0]!.kind).toBe("image");
        expect(attachments[0]!.name).toBe("snap.png");
    });

    test("group channel + thread parent", async () => {
        const adapter = buildAdapter();
        const payload = JSON.stringify({
            event: {
                user: "U2",
                channel: "C5",
                channel_type: "channel",
                text: "thread reply",
                thread_ts: "1700000000.001",
                ts: "1700000001.002",
            },
        });
        let route: { chatType: string; threadId?: string } | undefined;
        const dispatch = async (message: { route: { chatType: string; threadId?: string } }) => {
            route = message.route;
            return { messageId: "test", route: { channel: "telegram", chatId: "x", chatType: "group" }, text: "", metadata: { engine: "test" } } as unknown as GatewayReply;
        };
        await adapter.handle(signedRequest(payload), dispatch);
        expect(route?.chatType).toBe(ChatType.Group);
        expect(route?.threadId).toBe("1700000000.001");
    });

    test("skips bot echo events", async () => {
        const adapter = buildAdapter();
        const payload = JSON.stringify({ event: { user: "U", channel: "C", bot_id: "B1", text: "echo" } });
        let dispatched = false;
        const dispatch = async () => {
            dispatched = true;
            return { messageId: "test", route: { channel: "telegram", chatId: "x", chatType: "group" }, text: "", metadata: { engine: "test" } } as unknown as GatewayReply;
        };
        const response = await adapter.handle(signedRequest(payload), dispatch);
        expect(response.status).toBe(200);
        expect(dispatched).toBe(false);
    });
});
