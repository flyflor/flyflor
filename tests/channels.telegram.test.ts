/**
 * Telegram 适配器富媒体 + 群组 thread 增强测试（G-01 子项）。
 */

import { describe, expect, test } from "bun:test";
import { TelegramAdapter } from "../src/agent/gateway/channels/telegram.ts";
import { ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

function adapter(): TelegramAdapter {
    return new TelegramAdapter("test-token");
}

function request(update: unknown): Request {
    return new Request("https://flyflor.test/gateway/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
    });
}

const noop = async (): Promise<GatewayReply> => ({
    messageId: "test",
    route: { channel: "telegram", chatId: "x", chatType: "group" },
    text: "",
    metadata: { engine: "test" },
});

describe("TelegramAdapter rich media", () => {
    test("photo update surfaces attachment + caption text", async () => {
        let captured: { text: string; attachments: unknown } | undefined;
        const dispatch = async (m: { text: string; attachments?: unknown }) => {
            captured = { text: m.text, attachments: m.attachments };
            return { messageId: "test", route: { channel: "telegram", chatId: "x", chatType: "group" }, text: "", metadata: { engine: "test" } } as unknown as GatewayReply;
        };
        const update = {
            update_id: 100,
            message: {
                message_id: 1,
                chat: { id: -100, type: "supergroup" },
                from: { id: 7, username: "alice" },
                caption: "look at this",
                photo: [
                    { file_id: "small", file_unique_id: "sus", file_size: 100 },
                    { file_id: "big", file_unique_id: "bus", file_size: 4096 },
                ],
                message_thread_id: 42,
            },
        };
        const response = await adapter().handle(request(update), dispatch);
        expect(response.status).toBe(200);
        expect(captured!.text).toBe("look at this");
        const attachments = captured!.attachments as Array<{ kind: string; id: string }>;
        expect(attachments).toHaveLength(1);
        expect(attachments[0]!.kind).toBe("image");
        expect(attachments[0]!.id).toBe("bus");
    });

    test("document update kind=file with mimeType + thread persisted", async () => {
        let captured: { attachments: unknown; route: unknown } | undefined;
        const dispatch = async (m: { attachments?: unknown; route: unknown }) => {
            captured = { attachments: m.attachments, route: m.route };
            return { messageId: "test", route: { channel: "telegram", chatId: "x", chatType: "group" }, text: "", metadata: { engine: "test" } } as unknown as GatewayReply;
        };
        const update = {
            update_id: 101,
            message: {
                message_id: 2,
                chat: { id: -200, type: "supergroup" },
                from: { id: 9, username: "bob" },
                text: "spec",
                document: {
                    file_id: "doc",
                    file_unique_id: "du",
                    file_name: "spec.pdf",
                    mime_type: "application/pdf",
                    file_size: 12345,
                },
                message_thread_id: 7,
            },
        };
        await adapter().handle(request(update), dispatch);
        const attachments = captured!.attachments as Array<{ kind: string; mimeType: string }>;
        expect(attachments[0]!.kind).toBe("file");
        expect(attachments[0]!.mimeType).toBe("application/pdf");
        const route = captured!.route as { chatType: string; threadId?: string };
        expect(route.chatType).toBe(ChatType.Group);
        expect(route.threadId).toBe("7");
    });
});
