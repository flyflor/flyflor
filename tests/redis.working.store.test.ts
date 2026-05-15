import { describe, expect, test } from "bun:test";
import { RedisMemoryStore } from "../src/neural/memory/redis.ts";
import type { RedisMemoryConfig } from "../src/config/index.ts";

describe("RedisMemoryStore circuit breaker", () => {
    test("opens after command failure, fast-fails during cooldown, and closes on probe success", async () => {
        const store = new RedisMemoryStore(config());
        let fail = true;
        const fakeClient = {
            status: "ready",
            connect: async () => {
                fakeClient.status = "ready";
            },
            disconnect: () => {
                fakeClient.status = "end";
            },
            hgetall: async () => {
                if (fail) {
                    throw new Error("redis power loss");
                }
                return {};
            },
            quit: async () => {
                fakeClient.status = "end";
            },
        };
        (store as unknown as { client: typeof fakeClient }).client = fakeClient;

        await expect(store.readEpisode("u1", "ep1")).rejects.toThrow("redis power loss");
        expect(store.getHealthSnapshot().circuitState).toBe("open");

        await expect(store.readEpisode("u1", "ep1")).rejects.toThrow("circuit probe");

        fail = false;
        (store as unknown as { nextRetryAt: number }).nextRetryAt = 0;
        expect(await store.readEpisode("u1", "ep1")).toBeUndefined();
        expect(store.getHealthSnapshot().circuitState).toBe("closed");
    });
});

function config(): RedisMemoryConfig {
    return {
        contextRingSize: 4,
        defaultTtlSeconds: 3600,
        enabled: true,
        internalUrl: "redis://127.0.0.1:6379",
        maxEpisodesPerUser: 8,
        namespace: "flyflor",
        timeoutMs: 10,
    };
}
