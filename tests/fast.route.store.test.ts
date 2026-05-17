import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    FileBackedFastRouteSnapshotStore,
    InMemoryFastRouteSnapshotStore,
} from "../src/agent/runtime/routing/fast.route.store.ts";
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

describe("FileBackedFastRouteSnapshotStore", () => {
    test("persists snapshots across store instances", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-fast-route-"));
        try {
            const now = 1700000000000;
            const first = new FileBackedFastRouteSnapshotStore(dir, { now: () => now });
            await first.set("channel:chat:user", { ...baseSnapshot, recordedAt: now });

            const second = new FileBackedFastRouteSnapshotStore(dir, { now: () => now });
            const got = await second.get("channel:chat:user");

            expect(got?.lastMode).toBe(BlackboardMode.Direct);
            expect(got?.recordedAt).toBe(now);
            expect(second.size()).toBe(1);
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("treats corrupt cache files as miss", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-fast-route-"));
        try {
            await Bun.write(join(dir, "runtime.fast.route.snapshots.json"), "{not-json");
            const store = new FileBackedFastRouteSnapshotStore(dir);

            expect(await store.get("k1")).toBeUndefined();
            expect(store.size()).toBe(0);
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("prunes stale and overflow records before persisting", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-fast-route-"));
        try {
            const now = 1700000000000;
            const store = new FileBackedFastRouteSnapshotStore(dir, {
                maxAgeMs: 1_000,
                maxEntries: 2,
                now: () => now,
            });

            await store.set("stale", { ...baseSnapshot, recordedAt: now - 2_000 });
            await store.set("old", { ...baseSnapshot, recordedAt: now - 100 });
            await store.set("newer", { ...baseSnapshot, recordedAt: now });
            await store.set("newest", { ...baseSnapshot, recordedAt: now + 1 });

            const reloaded = new FileBackedFastRouteSnapshotStore(dir, {
                maxAgeMs: 1_000,
                maxEntries: 2,
                now: () => now,
            });

            expect(await reloaded.get("stale")).toBeUndefined();
            expect(await reloaded.get("old")).toBeUndefined();
            expect(await reloaded.get("newer")).toBeDefined();
            expect(await reloaded.get("newest")).toBeDefined();
            expect(reloaded.size()).toBe(2);
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("surfaces persistence failures while keeping the in-memory snapshot hot", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-fast-route-"));
        try {
            const store = new FileBackedFastRouteSnapshotStore(dir, {
                filePath: dir,
                now: () => baseSnapshot.recordedAt,
            });

            await expect(store.set("hot", baseSnapshot)).rejects.toThrow();
            expect(await store.get("hot")).toMatchObject({ lastMode: BlackboardMode.Direct });
            expect(store.size()).toBe(1);
        } finally {
            await rm(dir, { force: true, recursive: true });
        }
    });
});
