import { describe, expect, test } from "bun:test";
import {
    InMemoryFastRouteSnapshotStore,
    RedisFastRouteSnapshotStore,
} from "../src/agent/runtime/fast.route.store.ts";
import { BlackboardMode } from "../src/protocol/contracts/index.ts";
import type { FastRouteSnapshot } from "../src/agent/runtime/fast.route.ts";

const baseSnapshot: FastRouteSnapshot = {
    recordedAt: 1700000000000,
    lastMode: BlackboardMode.Direct,
    nextRouteHint: BlackboardMode.Direct,
    consecutiveWatchTurns: 0,
    consecutiveBlackboardFailures: 0,
    consecutiveToolFailureTurns: 0,
};

describe("InMemoryFastRouteSnapshotStore", () => {
    test("round-trips snapshot", async () => {
        const store = new InMemoryFastRouteSnapshotStore();
        expect(await store.get("k1")).toBeUndefined();
        await store.set("k1", baseSnapshot);
        const got = await store.get("k1");
        expect(got?.lastMode).toBe(BlackboardMode.Direct);
        expect(store.size()).toBe(1);
    });
});

function makeFakeRedis() {
    const map = new Map<string, string>();
    let throwOnGet = false;
    let throwOnSet = false;
    const client = {
        async get(key: string) {
            if (throwOnGet) throw new Error("boom");
            return map.get(key) ?? null;
        },
        async set(key: string, value: string, _mode: string, _ttl: number) {
            if (throwOnSet) throw new Error("boom");
            map.set(key, value);
            return "OK";
        },
    };
    return {
        client,
        map,
        breakGet: () => {
            throwOnGet = true;
        },
        breakSet: () => {
            throwOnSet = true;
        },
    };
}

describe("RedisFastRouteSnapshotStore", () => {
    test("set populates L1 + Redis with TTL prefix", async () => {
        const fake = makeFakeRedis();
        const store = new RedisFastRouteSnapshotStore({
            // biome-ignore lint/suspicious/noExplicitAny: test fake
            redis: fake.client as any,
            prefix: "test:fr",
            ttlSeconds: 60,
        });
        await store.set("u1", baseSnapshot);
        expect(fake.map.has("test:fr:u1")).toBe(true);
        const parsed = JSON.parse(fake.map.get("test:fr:u1") ?? "{}");
        expect(parsed.lastMode).toBe(BlackboardMode.Direct);
    });

    test("get falls back to Redis on L1 miss and hydrates L1", async () => {
        const fake = makeFakeRedis();
        fake.map.set("ff:fastroute:u2", JSON.stringify(baseSnapshot));
        const store = new RedisFastRouteSnapshotStore({
            // biome-ignore lint/suspicious/noExplicitAny: test fake
            redis: fake.client as any,
        });
        const first = await store.get("u2");
        expect(first?.lastMode).toBe(BlackboardMode.Direct);
        // second get is L1 hit even if Redis breaks
        fake.breakGet();
        const second = await store.get("u2");
        expect(second?.lastMode).toBe(BlackboardMode.Direct);
    });

    test("Redis failures degrade to undefined / L1 only", async () => {
        const fake = makeFakeRedis();
        fake.breakGet();
        fake.breakSet();
        const store = new RedisFastRouteSnapshotStore({
            // biome-ignore lint/suspicious/noExplicitAny: test fake
            redis: fake.client as any,
        });
        expect(await store.get("u3")).toBeUndefined();
        await store.set("u3", baseSnapshot); // should not throw
        // L1 still holds it
        const got = await store.get("u3");
        expect(got?.lastMode).toBe(BlackboardMode.Direct);
    });
});
