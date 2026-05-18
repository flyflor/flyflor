import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextForkStore } from "../src/cognitive/hippocampus/memory/fork/index.ts";

describe("ContextForkStore", () => {
    test("writes cold fork replay outside brain.db and cleans expired sidecars", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-fork-store-"));
        try {
            const store = new ContextForkStore(join(root, "forks"));
            await store.writeFork(
                {
                    id: "fork-1",
                    userId: "u1",
                    title: "Fork",
                    summary: "Summary",
                    scopeSummary: "Scope",
                    maxContextTokens: 4096,
                    inheritedEventIds: ["event-1"],
                    createdAt: "2026-05-01T00:00:00.000Z",
                    updatedAt: "2026-05-01T00:00:00.000Z",
                    sourceEventId: "event-1",
                },
                { eventId: "event-1", userText: "u", assistantText: "a" },
            );

            expect((await store.readFork("fork-1"))?.source?.assistantText).toBe("a");
            const cleanup = await store.cleanupExpired({
                nowMs: Date.parse("2026-06-01T00:00:00.000Z"),
                ttlDays: 7,
            });
            expect(cleanup.removed).toBe(1);
            expect(await store.readFork("fork-1")).toBeNull();
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});
