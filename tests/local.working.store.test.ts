import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalWorkingMemoryConfig } from "../src/config/index.ts";
import { LocalWorkingMemoryStore } from "../src/fch/hippocampus/memory/working/index.ts";

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

    test("writes a backup snapshot during compaction", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-local-working-"));
        try {
            const first = store(root, { snapshotEveryWrites: 1 });
            await first.writeEpisode({
                userId: "u1",
                episodeId: "ep1",
                text: "backup me",
                concepts: ["local"],
                embedding: [1, 0],
                importance: 0.8,
                stability: 0.9,
                sourceKind: "test",
                createdAt: Date.now(),
                ttlSeconds: 3600,
            });

            expect(await readFile(join(root, "working.snapshot.json"), "utf8")).toContain("backup me");
            expect(await readFile(join(root, "working.snapshot.json.bak"), "utf8")).toContain("backup me");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("recovers from backup snapshot when the primary snapshot is corrupted", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-local-working-"));
        try {
            const first = store(root, { snapshotEveryWrites: 1 });
            await first.writeEpisode({
                userId: "u1",
                episodeId: "ep1",
                text: "backup survivor",
                concepts: ["local"],
                embedding: [1, 0],
                importance: 0.8,
                stability: 0.9,
                sourceKind: "test",
                createdAt: Date.now(),
                ttlSeconds: 3600,
            });
            await writeFile(join(root, "working.snapshot.json"), "{broken", "utf8");

            const second = store(root);

            expect((await second.readEpisode("u1", "ep1"))?.text).toBe("backup survivor");
            expect(second.getHealthSnapshot()).toMatchObject({
                circuitState: "closed",
                loaded: true,
                loadedFrom: "backup",
                recoveredFromBackup: true,
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("opens the circuit breaker when WAL writes fail and keeps loaded reads available", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-local-working-"));
        try {
            const store = new FailingStore(root);
            await store.writeEpisode({
                userId: "u1",
                episodeId: "ep1",
                text: "keep me",
                concepts: [],
                importance: 0.7,
                stability: 0.8,
                sourceKind: "test",
                ttlSeconds: 3600,
            });

            await expect(
                store.writeEpisode({
                    userId: "u1",
                    episodeId: "ep2",
                    text: "break me",
                    concepts: [],
                    importance: 0.7,
                    stability: 0.8,
                    sourceKind: "test",
                    ttlSeconds: 3600,
                }),
            ).rejects.toThrow("simulated disk outage");

            const health = store.getHealthSnapshot();
            expect(health.circuitState).toBe("open");
            expect(await store.readEpisode("u1", "ep1")).toBeDefined();
            await expect(
                store.writeEpisode({
                    userId: "u1",
                    episodeId: "ep3",
                    text: "still broken",
                    concepts: [],
                    importance: 0.7,
                    stability: 0.8,
                    sourceKind: "test",
                    ttlSeconds: 3600,
                }),
            ).rejects.toThrow("temporarily read-only");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

function store(root: string, overrides: Partial<LocalWorkingMemoryConfig> = {}): LocalWorkingMemoryStore {
    return storeWithConfig(root, overrides);
}

function storeWithConfig(
    root: string,
    overrides: Partial<LocalWorkingMemoryConfig> = {},
): LocalWorkingMemoryStore {
    return new LocalWorkingMemoryStore(root, {
        contextRingSize: 4,
        defaultTtlSeconds: 3600,
        maxEpisodesPerUser: 8,
        maxWalBytes: 1024 * 1024,
        snapshotEveryWrites: 100,
        snapshotFile: "working.snapshot.json",
        walFile: "working.wal.jsonl",
        ...overrides,
    });
}

class FailingStore extends LocalWorkingMemoryStore {
    private writes = 0;

    public constructor(root: string) {
        super(root, {
            contextRingSize: 4,
            defaultTtlSeconds: 3600,
            maxEpisodesPerUser: 8,
            maxWalBytes: 1024 * 1024,
            snapshotEveryWrites: 100,
            snapshotFile: "working.snapshot.json",
            walFile: "working.wal.jsonl",
        });
    }

    protected override async appendWal(record: any): Promise<void> {
        this.writes += 1;
        if (this.writes >= 2) {
            throw new Error("simulated disk outage");
        }
        await super.appendWal(record as never);
    }
}
