import { describe, expect, test } from "bun:test";
import { GatewayModule } from "../src/agent/gateway/module.ts";
import { buildDedupKey, InMemoryDedupStore } from "../src/agent/gateway/dedup.ts";
import type { GatewayConfig } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    RuntimeEventType,
    type EventSink,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeEvent,
} from "../src/protocol/index.ts";

function reply(text: string, messageId = "m1"): GatewayReply {
    return {
        messageId,
        route: { channel: Channel.Stdio, chatId: "cli", chatType: ChatType.Direct },
        text,
    };
}

describe("InMemoryDedupStore", () => {
    test("first tryClaim returns claimed; second returns in-flight; after recordReply returns duplicate", async () => {
        const store = new InMemoryDedupStore(60_000, 16);
        const key = buildDedupKey("stdio", "msg-1");
        const first = await store.tryClaim(key);
        expect(first.state).toBe("claimed");

        const second = await store.tryClaim(key);
        expect(second.state).toBe("in-flight");

        await store.recordReply(key, reply("hello", "msg-1"));
        const third = await store.tryClaim(key);
        expect(third.state).toBe("duplicate");
        if (third.state === "duplicate") {
            expect(third.cachedReply.text).toBe("hello");
        }
    });

    test("release frees the key for subsequent retry", async () => {
        const store = new InMemoryDedupStore();
        const key = buildDedupKey("stdio", "msg-2");
        await store.tryClaim(key);
        await store.release(key);
        const again = await store.tryClaim(key);
        expect(again.state).toBe("claimed");
    });

    test("TTL expiry allows re-claim", async () => {
        const store = new InMemoryDedupStore(10, 16);
        const key = buildDedupKey("stdio", "msg-3");
        await store.tryClaim(key);
        await new Promise((r) => setTimeout(r, 30));
        const again = await store.tryClaim(key);
        expect(again.state).toBe("claimed");
    });

    test("buildDedupKey is stable + collision-safe across channels", () => {
        expect(buildDedupKey("stdio", "abc")).toBe("gw-dedup:stdio:abc");
        expect(buildDedupKey("telegram", "abc")).toBe("gw-dedup:telegram:abc");
        expect(buildDedupKey("stdio", "abc")).not.toBe(buildDedupKey("telegram", "abc"));
    });

    test("capacity enforces LRU eviction", async () => {
        const store = new InMemoryDedupStore(60_000, 2);
        await store.tryClaim("a");
        await store.tryClaim("b");
        await store.tryClaim("c"); // should evict "a"
        const a = await store.tryClaim("a");
        expect(a.state).toBe("claimed");
    });
});

describe("GatewayModule dedup telemetry", () => {
    test("publishes a structured warning when reply dedup persistence fails", async () => {
        const events = new CapturingSink();
        const gateway = new GatewayModule(
            gatewayConfig(),
            new Map(),
            {
                handleMessage: async () => reply("delivered", "msg-record-fail"),
            } as never,
            events,
            new FailingDedupStore({ failRecord: true }),
        );

        const result = await dispatchForTest(gateway, message("msg-record-fail"));

        expect(result.text).toBe("delivered");
        const failures = events.events.filter((event) => event.type === RuntimeEventType.GatewayDedupStoreFailed);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.payload).toMatchObject({
            channel: Channel.Stdio,
            key: buildDedupKey(Channel.Stdio, "msg-record-fail"),
            operation: "recordReply",
        });
        expect(typeof failures[0]?.requestId).toBe("string");
    });

    test("publishes a structured warning when a failed turn cannot release the dedup claim", async () => {
        const events = new CapturingSink();
        const gateway = new GatewayModule(
            gatewayConfig(),
            new Map(),
            {
                handleMessage: async () => {
                    throw new Error("runtime-down");
                },
            } as never,
            events,
            new FailingDedupStore({ failRelease: true }),
        );

        await expect(dispatchForTest(gateway, message("msg-release-fail"))).rejects.toThrow("runtime-down");
        const failures = events.events.filter((event) => event.type === RuntimeEventType.GatewayDedupStoreFailed);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.payload).toMatchObject({
            channel: Channel.Stdio,
            key: buildDedupKey(Channel.Stdio, "msg-release-fail"),
            operation: "release",
        });
    });
});

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

class FailingDedupStore extends InMemoryDedupStore {
    public constructor(private readonly failure: { failRecord?: boolean; failRelease?: boolean }) {
        super();
    }

    public override async recordReply(key: string, value: GatewayReply): Promise<void> {
        if (this.failure.failRecord) {
            throw new Error("dedup-record-down");
        }
        await super.recordReply(key, value);
    }

    public override async release(key: string): Promise<void> {
        if (this.failure.failRelease) {
            throw new Error("dedup-release-down");
        }
        await super.release(key);
    }
}

function gatewayConfig(): GatewayConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        allowedChannels: [Channel.Stdio],
        channelReplyUrls: {},
        channels: {},
        stdio: false,
    } as GatewayConfig;
}

function message(id: string): GatewayMessage {
    return {
        id,
        route: { channel: Channel.Stdio, chatId: "cli", chatType: ChatType.Direct },
        user: { id: "user" },
        text: "hello",
        receivedAt: "2026-05-17T00:00:00.000Z",
    };
}

async function dispatchForTest(gateway: GatewayModule, value: GatewayMessage): Promise<GatewayReply> {
    return (
        gateway as unknown as {
            dispatch(message: GatewayMessage): Promise<GatewayReply>;
        }
    ).dispatch(value);
}
