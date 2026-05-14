import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkingMemoryStore } from "../src/neural/memory/local.working.store.ts";

describe("LocalWorkingMemoryStore", () => {
    test("replays WAL after restart and keeps the context ring", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-local-working-"));
        try {
            const first = store(root);
            await first.writeEpisode({
                userId: "u1",
                episodeId: "ep1",
                text: "remember me",
                concepts: ["local"],
                embedding: [1, 0],
                importance: 0.8,
                stability: 0.9,
                sourceKind: "test",
                createdAt: Date.now(),
                ttlSeconds: 3600,
            });

            const second = store(root);
            const episode = await second.readEpisode("u1", "ep1");
            expect(episode?.text).toBe("remember me");
            expect(await second.readContextRing("u1", 4)).toEqual(["ep1"]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("ignores one torn WAL line after a complete mutation", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-local-working-"));
        try {
            const first = store(root);
            await first.writeEpisode({
                userId: "u1",
                episodeId: "ep1",
                text: "safe line",
                concepts: [],
                importance: 0.7,
                stability: 0.8,
                sourceKind: "test",
                ttlSeconds: 3600,
            });
            await appendFile(join(root, "working.wal.jsonl"), "{\"op\":\"write-episode\"", "utf8");

            const second = store(root);
            expect((await second.readEpisode("u1", "ep1"))?.text).toBe("safe line");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

function store(root: string): LocalWorkingMemoryStore {
    return new LocalWorkingMemoryStore(root, {
        contextRingSize: 4,
        defaultTtlSeconds: 3600,
        maxEpisodesPerUser: 8,
        maxWalBytes: 1024 * 1024,
        snapshotEveryWrites: 100,
        snapshotFile: "working.snapshot.json",
        walFile: "working.wal.jsonl",
    });
}
