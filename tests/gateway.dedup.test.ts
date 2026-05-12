import { describe, expect, test } from "bun:test";
import { buildDedupKey, InMemoryDedupStore } from "../src/agent/gateway/dedup.ts";
import { Channel, ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

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
