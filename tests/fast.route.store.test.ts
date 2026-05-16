import { describe, expect, test } from "bun:test";
import { InMemoryFastRouteSnapshotStore } from "../src/agent/runtime/routing/fast.route.store.ts";
import { BlackboardMode } from "../src/protocol/contracts/index.ts";
import type { FastRouteSnapshot } from "../src/agent/runtime/routing/fast.route.ts";

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
