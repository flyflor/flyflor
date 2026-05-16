import { describe, expect, test } from "bun:test";
import { WeixinIlinkAdapter } from "../src/agent/gateway/channels/weixin.ilink.ts";
import { Channel, ChatType, GatewayOutboundOperation, type GatewayReply } from "../src/protocol/contracts/index.ts";

function adapter(): WeixinIlinkAdapter {
    return new WeixinIlinkAdapter({
        apiBaseUrl: "https://ilinkai.weixin.qq.com",
        baseInfo: { channel_version: "2.2.0" },
        pollIntervalMs: 1500,
        token: "ilink-token",
    });
}

describe("WeixinIlinkAdapter", () => {
    test("normalizes direct messages and keeps context token as reply reference", () => {
        const message = adapter().normalize({
            context_token: "ctx-1",
            from_user_id: "wxid-user",
            msg_id: "msg-1",
            msg_type: 1,
            text: "hello",
        });

        expect(message.route).toMatchObject({
            channel: Channel.WeixinIlink,
            chatId: "wxid-user",
            chatType: ChatType.Direct,
        });
        expect(message.replyTo).toEqual({ messageId: "ctx-1" });
    });

    test("sendOperation uses cached official typing ticket for start and stop", async () => {
        const instance = adapter();
        const originalFetch = globalThis.fetch;
        const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
        globalThis.fetch = (async (input, init) => {
            calls.push({
                url: String(input instanceof Request ? input.url : input),
                body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            });
            return new Response(JSON.stringify({ ret: 0, typing_ticket: "ticket-1" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
        try {
            await (
                instance as unknown as {
                    maybeFetchTypingTicket(update: {
                        context_token: string;
                        from_user_id: string;
                    }): Promise<void>;
                }
            ).maybeFetchTypingTicket({ context_token: "ctx-1", from_user_id: "wxid-user" });
            await instance.sendOperation({
                operation: GatewayOutboundOperation.TypingStart,
                route: { channel: Channel.WeixinIlink, chatId: "wxid-user", chatType: ChatType.Direct },
            });
            await instance.sendOperation({
                operation: GatewayOutboundOperation.TypingStop,
                route: { channel: Channel.WeixinIlink, chatId: "wxid-user", chatType: ChatType.Direct },
            });

            expect(calls.map((call) => call.url)).toEqual([
                "https://ilinkai.weixin.qq.com/ilink/bot/getconfig",
                "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping",
                "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping",
            ]);
            expect(calls[1]?.body).toMatchObject({
                ilink_user_id: "wxid-user",
                status: 1,
                typing_ticket: "ticket-1",
            });
            expect(calls[2]?.body).toMatchObject({
                ilink_user_id: "wxid-user",
                status: 2,
                typing_ticket: "ticket-1",
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test("poll delivery sends one final reply through official sendmessage after typing lifecycle", async () => {
        const instance = adapter();
        const originalFetch = globalThis.fetch;
        const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
        globalThis.fetch = (async (input, init) => {
            calls.push({
                url: String(input instanceof Request ? input.url : input),
                body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            });
            return new Response(JSON.stringify({ ret: 0, typing_ticket: "ticket-1" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
        try {
            await (
                instance as unknown as {
                    dispatchUpdate(
                        update: {
                            context_token: string;
                            from_user_id: string;
                            msg_id: string;
                            msg_type: number;
                            text: string;
                        },
                        dispatch: () => Promise<GatewayReply>,
                    ): Promise<void>;
                }
            ).dispatchUpdate(
                {
                    context_token: "ctx-1",
                    from_user_id: "wxid-user",
                    msg_id: "msg-1",
                    msg_type: 1,
                    text: "hello",
                },
                async () => ({
                    messageId: "reply-1",
                    route: { channel: Channel.WeixinIlink, chatId: "wxid-user", chatType: ChatType.Direct },
                    text: "final reply",
                }),
            );

            expect(calls.map((call) => call.url)).toEqual([
                "https://ilinkai.weixin.qq.com/ilink/bot/getconfig",
                "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping",
                "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage",
                "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping",
            ]);
            expect(calls[2]?.body).toMatchObject({
                msg: {
                    context_token: "ctx-1",
                    item_list: [{ type: 1, text_item: { text: "final reply" } }],
                    to_user_id: "wxid-user",
                },
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
