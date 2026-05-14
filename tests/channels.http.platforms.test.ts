import { describe, expect, test, afterEach } from "bun:test";
import { HttpPlatformAdapter } from "../src/agent/gateway/channels/http.platforms.ts";
import {
    Channel,
    ChatType,
    GatewayMessageAction,
    GatewayMessageKind,
    type GatewayReply,
} from "../src/protocol/contracts/index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function reply(message: { route: GatewayReply["route"] }, text = "ack"): GatewayReply {
    return { messageId: "reply", route: message.route, text, metadata: { engine: "test" } };
}

describe("HttpPlatformAdapter specialized protocols", () => {
    test("WhatsApp verifies webhook and normalizes message payload", async () => {
        const adapter = new HttpPlatformAdapter(Channel.WhatsApp, {
            accessToken: "wa-token",
            phoneNumberId: "phone-1",
            token: "verify-token",
        });
        const verify = await adapter.handle(
            new Request("https://flyflor.test/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=ok"),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(await verify.text()).toBe("ok");

        const wrongVerify = await adapter.handle(
            new Request("https://flyflor.test/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=ok"),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(wrongVerify.status).toBe(403);

        let captured: { attachments?: unknown; route: unknown; text: string } | undefined;
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            expect(String(input)).toContain("/phone-1/messages");
            expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
                messaging_product: "whatsapp",
                to: "15550001",
                text: { body: "ack" },
            });
            return new Response(JSON.stringify({ success: true }));
        }) as typeof fetch;

        const response = await adapter.handle(
            new Request("https://flyflor.test/whatsapp", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    entry: [
                        {
                            changes: [
                                {
                                    value: {
                                        contacts: [{ wa_id: "15550001", profile: { name: "Alice" } }],
                                        messages: [{ id: "wamid.1", from: "15550001", type: "text", text: { body: "hi" } }],
                                    },
                                },
                            ],
                        },
                    ],
                }),
            }),
            async (message) => {
                captured = { attachments: message.attachments, route: message.route, text: message.text };
                return reply(message);
            },
        );

        expect(response.status).toBe(200);
        expect(captured?.text).toBe("hi");
        expect(captured?.route).toMatchObject({
            channel: Channel.WhatsApp,
            chatId: "15550001",
            chatType: ChatType.Direct,
        });
    });

    test("normalizes Matrix, Signal, Home Assistant, Google Chat, Teams, QQBot, Yuanbao and Zalo", () => {
        expect(
            new HttpPlatformAdapter(Channel.Matrix, {}).normalize({
                event_id: "$evt",
                room_id: "!room",
                sender: "@alice:matrix.test",
                content: { msgtype: "m.text", body: "hello matrix" },
            }),
        ).toMatchObject({
            text: "hello matrix",
            route: { channel: Channel.Matrix, chatId: "!room", chatType: ChatType.Group },
            user: { id: "@alice:matrix.test" },
        });

        expect(
            new HttpPlatformAdapter(Channel.Signal, {}).normalize({
                envelope: {
                    sourceNumber: "+15550002",
                    sourceName: "Bob",
                    timestamp: 1,
                    dataMessage: { message: "hello signal", groupInfo: { groupId: "group-1" } },
                },
            }),
        ).toMatchObject({
            text: "hello signal",
            route: { channel: Channel.Signal, chatId: "group-1", chatType: ChatType.Group },
            user: { id: "+15550002", displayName: "Bob" },
        });

        expect(
            new HttpPlatformAdapter(Channel.HomeAssistant, {}).normalize({
                event: {
                    event_type: "state_changed",
                    data: {
                        entity_id: "light.office",
                        old_state: { state: "off" },
                        new_state: { state: "on", attributes: { friendly_name: "Office light" } },
                    },
                },
            }).text,
        ).toContain("Office light");

        expect(
            new HttpPlatformAdapter(Channel.GoogleChat, {}).normalize({
                message: {
                    name: "spaces/s/messages/m",
                    text: "hello google",
                    sender: { name: "users/1", displayName: "G" },
                    space: { name: "spaces/s", type: "ROOM" },
                    thread: { name: "spaces/s/threads/t" },
                },
            }),
        ).toMatchObject({
            text: "hello google",
            route: { channel: Channel.GoogleChat, chatId: "spaces/s", chatType: ChatType.Group },
        });

        expect(
            new HttpPlatformAdapter(Channel.Teams, {}).normalize({
                id: "activity-1",
                text: "hello teams",
                conversation: { id: "conversation-1", conversationType: "personal" },
                from: { id: "user-1", name: "T" },
            }),
        ).toMatchObject({
            text: "hello teams",
            route: { channel: Channel.Teams, chatId: "conversation-1", chatType: ChatType.Direct },
        });

        expect(
            new HttpPlatformAdapter(Channel.QQBot, {}).normalize({
                event: {
                    id: "qq-msg",
                    content: "hello qq",
                    channel_id: "channel-1",
                    author: { id: "qq-user", username: "QQ" },
                },
            }),
        ).toMatchObject({
            text: "hello qq",
            route: { channel: Channel.QQBot, chatId: "channel-1", chatType: ChatType.Group },
        });

        expect(
            new HttpPlatformAdapter(Channel.Yuanbao, {}).normalize({
                From_Account: "yuanbao-user",
                To_Account: "bot",
                MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { text: "hello yuanbao" } }],
            }),
        ).toMatchObject({
            text: "hello yuanbao",
            route: { channel: Channel.Yuanbao, chatId: "bot", chatType: ChatType.Direct },
        });

        expect(
            new HttpPlatformAdapter(Channel.Zalo, {}).normalize({
                sender: { id: "zalo-user" },
                recipient: { id: "oa-1" },
                message: { msg_id: "zalo-msg", text: "hello zalo" },
            }),
        ).toMatchObject({
            text: "hello zalo",
            route: { channel: Channel.Zalo, chatId: "oa-1" },
        });
    });

    test("SMS form posts return TwiML and MS Graph verification echoes validation token", async () => {
        const sms = new HttpPlatformAdapter(Channel.Sms, {});
        const smsResponse = await sms.handle(
            new Request("https://flyflor.test/sms", {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ From: "+15550003", Body: "hello sms", MessageSid: "sms-1" }),
            }),
            async (message) => {
                expect(message.text).toBe("hello sms");
                return reply(message, "sms ack");
            },
        );
        expect(await smsResponse.text()).toBe("<Response><Message>sms ack</Message></Response>");

        const graph = new HttpPlatformAdapter(Channel.MsGraphWebhook, {});
        const graphResponse = await graph.handle(
            new Request("https://flyflor.test/msgraph?validationToken=graph-token"),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(await graphResponse.text()).toBe("graph-token");
    });

    test("Teams and Google Chat send native webhook replies", async () => {
        const calls: Array<{ body: unknown; url: string }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
            return new Response(JSON.stringify({ ok: true }));
        }) as typeof fetch;

        await new HttpPlatformAdapter(Channel.Teams, { webhookUrl: "https://teams.test/hook" }).handle(
            new Request("https://flyflor.test/teams", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    id: "a1",
                    text: "ping",
                    conversation: { id: "c1" },
                    from: { id: "u1" },
                }),
            }),
            async (message) => reply(message, "teams ack"),
        );

        await new HttpPlatformAdapter(Channel.GoogleChat, { webhookUrl: "https://chat.test/hook" }).handle(
            new Request("https://flyflor.test/google", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    message: {
                        name: "m1",
                        text: "ping",
                        sender: { name: "u1" },
                        space: { name: "s1", type: "ROOM" },
                    },
                }),
            }),
            async (message) => reply(message, "google ack"),
        );

        expect(calls).toEqual([
            { url: "https://teams.test/hook", body: { text: "teams ack" } },
            { url: "https://chat.test/hook", body: { text: "google ack" } },
        ]);
    });

    test("generic HTTP branches preserve lifecycle action, mentions and reactions", () => {
        const message = new HttpPlatformAdapter(Channel.ApiServer, {}).normalize({
            action: "reaction",
            id: "evt-1",
            from: { id: "user-1", name: "Alice" },
            chatId: "thread-1",
            text: "noted",
            mentions: [{ id: "user-2", kind: "user", name: "Bob", text: "@bob" }],
            reactions: [{ key: "eyes", messageId: "msg-1", added: true, count: 2 }],
        });

        expect(message.messageAction).toBe(GatewayMessageAction.Reaction);
        expect(message.mentions).toEqual([{ id: "user-2", kind: "user", displayName: "Bob", text: "@bob" }]);
        expect(message.reactions).toEqual([{ key: "eyes", targetMessageId: "msg-1", added: true, count: 2 }]);
    });
});
