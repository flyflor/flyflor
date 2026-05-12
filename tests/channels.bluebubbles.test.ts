/**
 * BlueBubbles / iMessage 适配器测试（G-01 子项）。
 */

import { describe, expect, test } from "bun:test";
import { BlueBubblesAdapter } from "../src/agent/gateway/channels/bluebubbles.ts";
import { Channel, ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

const PASSWORD = "swordfish";

function adapter(name: typeof Channel.BlueBubbles | typeof Channel.IMessage = Channel.BlueBubbles): BlueBubblesAdapter {
    return new BlueBubblesAdapter(name, { apiBaseUrl: undefined, password: PASSWORD });
}

function request(body: unknown, opts: { password?: string; useHeader?: boolean } = {}): Request {
    const url = new URL("https://flyflor.test/gateway/bluebubbles");
    if (!opts.useHeader && opts.password !== undefined) {
        url.searchParams.set("password", opts.password);
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.useHeader && opts.password !== undefined) {
        headers["x-bluebubbles-password"] = opts.password;
    }
    return new Request(url.toString(), { method: "POST", headers, body: JSON.stringify(body) });
}

const noop = async (): Promise<GatewayReply> => ({
    messageId: "test",
    route: { channel: Channel.BlueBubbles, chatId: "x", chatType: ChatType.Direct },
    text: "",
    metadata: { engine: "test" },
});

describe("BlueBubblesAdapter", () => {
    test("rejects missing password", async () => {
        const response = await adapter().handle(request({ data: { text: "hi" } }), noop);
        expect(response.status).toBe(401);
    });

    test("rejects wrong password", async () => {
        const response = await adapter().handle(request({ data: { text: "hi" } }, { password: "nope" }), noop);
        expect(response.status).toBe(401);
    });

    test("accepts password via query and recognizes direct chat", async () => {
        let captured: { route: unknown; user: unknown } | undefined;
        const dispatch = async (m: { route: unknown; user: unknown }) => {
            captured = { route: m.route, user: m.user };
            return { messageId: "test", route: { channel: "telegram", chatId: "x", chatType: "group" }, text: "", metadata: { engine: "test" } } as unknown as GatewayReply;
        };
        const payload = {
            data: {
                guid: "msg-1",
                text: "yo",
                chat: { guid: "iMessage;-;+15551234567", style: "private" },
                handle: { address: "+15551234567", firstName: "Friend" },
            },
        };
        const response = await adapter().handle(request(payload, { password: PASSWORD }), dispatch);
        expect(response.status).toBe(200);
        const route = captured!.route as { channel: string; chatType: string; chatId: string };
        expect(route.channel).toBe(Channel.BlueBubbles);
        expect(route.chatType).toBe(ChatType.Direct);
        expect(route.chatId).toBe("iMessage;-;+15551234567");
    });

    test("group chat recognized via chats[].style=group plus attachment", async () => {
        let attachmentsCaptured: Array<{ kind: string; mimeType?: string; name?: string }> | undefined;
        let chatTypeCaptured: string | undefined;
        const dispatch = async (m: {
            route: { chatType: string };
            attachments?: Array<{ kind: string; mimeType?: string; name?: string }>;
        }) => {
            chatTypeCaptured = m.route.chatType;
            attachmentsCaptured = m.attachments;
            return { messageId: "test", route: { channel: "telegram", chatId: "x", chatType: "group" }, text: "", metadata: { engine: "test" } } as unknown as GatewayReply;
        };
        const payload = {
            data: {
                guid: "msg-2",
                text: "look",
                chats: [{ guid: "iMessage;+;abc", style: "group" }],
                attachments: [
                    {
                        guid: "att-1",
                        transferName: "pic.png",
                        mimeType: "image/png",
                        totalBytes: 2048,
                    },
                ],
            },
        };
        const response = await adapter(Channel.IMessage).handle(
            request(payload, { password: PASSWORD, useHeader: true }),
            dispatch,
        );
        expect(response.status).toBe(200);
        expect(chatTypeCaptured).toBe(ChatType.Group);
        expect(attachmentsCaptured).toHaveLength(1);
        expect(attachmentsCaptured![0]!.kind).toBe("image");
        expect(attachmentsCaptured![0]!.name).toBe("pic.png");
    });
});
