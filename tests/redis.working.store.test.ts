import { describe, expect, test } from "bun:test";
import { RedisMemoryStore, redisKeyPrefixForNamespace } from "../src/neural/memory/redis.ts";
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

    test("uses namespace-aware key prefixes while preserving the default ff prefix", () => {
        expect(redisKeyPrefixForNamespace("flyflor")).toBe("ff");
        expect(redisKeyPrefixForNamespace("team.alpha")).toBe("team.alpha");
        expect(redisKeyPrefixForNamespace("team alpha/dev")).toBe("team%20alpha%2Fdev");

        const custom = new RedisMemoryStore(config({ namespace: "team alpha/dev" }));
        expect((custom as unknown as { episodeKey: (userId: string, episodeId: string) => string }).episodeKey("u1", "ep1")).toBe(
            "team%20alpha%2Fdev:ep:u1:ep1",
        );

        const defaults = new RedisMemoryStore(config());
        expect((defaults as unknown as { contextKey: (userId: string) => string }).contextKey("u1")).toBe("ff:ctx:u1");
    });
});

function config(overrides: Partial<RedisMemoryConfig> = {}): RedisMemoryConfig {
    return {
        contextRingSize: 4,
        defaultTtlSeconds: 3600,
        enabled: true,
        internalUrl: "redis://127.0.0.1:6379",
        maxEpisodesPerUser: 8,
        namespace: "flyflor",
        timeoutMs: 10,
        ...overrides,
    };
}
