import { describe, expect, test } from "bun:test";
import { GatewayModule } from "../src/agent/gateway/gateway.module.ts";
import { buildDeliveryMetadata } from "../src/agent/gateway/channels/delivery.protocol.ts";
import { dispatchWithDelivery } from "../src/agent/gateway/channels/helpers.ts";
import {
    Channel,
    ChatType,
    GatewayOutboundOperation,
    type GatewayMessage,
    type GatewayOutboundEnvelope,
    type GatewayReply,
    type RuntimeEvent,
} from "../src/protocol/contracts/index.ts";
import type { GatewayConfig } from "../src/config/index.ts";
import type { ChannelAdapter } from "../src/agent/gateway/channels/types.ts";
import type { EventSink } from "../src/protocol/events/index.ts";

const message: GatewayMessage = {
    id: "m-1",
    route: { channel: Channel.Webhook, chatId: "chat-1", chatType: ChatType.Direct },
    user: { id: "u-1" },
    text: "hello",
    receivedAt: "2026-05-15T00:00:00.000Z",
};

describe("channel delivery", () => {
    test("dispatchWithDelivery sends one final platform reply and ignores deltas", async () => {
        const delivered: string[] = [];
        let typingCount = 0;
        let dispatcherReceivedOptions = false;

        const reply = await dispatchWithDelivery({
            message,
            typing: async () => {
                typingCount += 1;
            },
            deliver: async (text) => {
                delivered.push(text);
            },
            dispatch: async (_message, options) => {
                dispatcherReceivedOptions = options !== undefined;
                await options?.onTextDelta?.("partial");
                return { messageId: "m-1", route: message.route, text: "final" };
            },
        });

        expect(reply.text).toBe("final");
        expect(typingCount).toBe(1);
        expect(dispatcherReceivedOptions).toBe(false);
        expect(delivered).toEqual(["final"]);
    });

    test("dispatchWithDelivery emits typed lifecycle operations without streaming deltas", async () => {
        const operations: GatewayOutboundEnvelope[] = [];

        await dispatchWithDelivery({
            message,
            metadata: { replyToMessageId: "source-1", threadId: "thread-1" },
            operation: async (operation) => {
                operations.push(operation);
            },
            deliver: async () => {
                throw new Error("operation sender should own delivery");
            },
            dispatch: async (_message, options) => {
                expect(options).toBeUndefined();
                return { messageId: "m-1", route: message.route, text: "final" };
            },
        });

        expect(operations.map((operation) => operation.operation)).toEqual([
            GatewayOutboundOperation.TypingStart,
            GatewayOutboundOperation.MessageSend,
            GatewayOutboundOperation.TypingStop,
        ]);
        expect(operations[1]).toMatchObject({
            metadata: { replyToMessageId: "source-1", threadId: "thread-1" },
            text: "final",
        });
    });

    test("LINE delivery metadata prefers quoteToken over inbound message id", () => {
        const metadata = buildDeliveryMetadata({
            ...message,
            route: { channel: Channel.Line, chatId: "line-user", chatType: ChatType.Direct },
            source: { messageId: "line-message-id" },
            replyTo: { messageId: "line-quote-token" },
        });

        expect(metadata?.replyToMessageId).toBe("line-quote-token");
    });

    test("legacy gateway stream URL returns final text without channel deltas", async () => {
        const adapter: ChannelAdapter & { normalize: (input: unknown) => GatewayMessage } = {
            name: Channel.Webhook,
            handle: async () => new Response("unused"),
            normalize: () => message,
        };
        const runtime = {
            handleMessage: async (
                incoming: GatewayMessage,
                _context: unknown,
                options?: { onTextDelta?: (text: string) => void | Promise<void> },
            ): Promise<GatewayReply> => {
                await options?.onTextDelta?.("partial");
                return { messageId: incoming.id, route: incoming.route, text: "final" };
            },
        };
        const gateway = new GatewayModule(fakeConfig(), new Map([[Channel.Webhook, adapter]]), runtime as never, new NoopSink());
        const response = await (
            gateway as unknown as {
                dispatchHttpStream: (channel: string, request: Request) => Promise<Response>;
            }
        ).dispatchHttpStream(
            Channel.Webhook,
            new Request("https://flyflor.test/chat/stream", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: "hello" }),
            }),
        );

        expect(response.headers.get("content-type")).toContain("text/plain");
        expect(await response.text()).toBe("final");
    });
});

function fakeConfig(): GatewayConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        allowedChannels: [Channel.Webhook],
        stdio: false,
    } as unknown as GatewayConfig;
}

class NoopSink implements EventSink {
    publish(_event: RuntimeEvent): void {
        // Test sink deliberately drops gateway lifecycle events.
    }
}
