import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JournalStore, type JournalAtomWrite } from "../src/neural/memory/journal.store.ts";
import { AtomStage, ModelRole, type AtomScore, type MemoryAtom } from "../src/protocol/contracts/index.ts";

describe("JournalStore", () => {
    test("writes day-partitioned journal databases and week files", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-journal-store-"));
        const store = new JournalStore({ journalRoot: join(root, "journal") });
        const createdAt = "2026-05-12T08:00:00.000Z";

        const result = await store.appendEpisode(
            {
                id: "ep1",
                userId: "u1",
                channelId: "stdio",
                projectId: "p1",
                role: ModelRole.User,
                text: "hello",
                createdAt,
            },
            [atomWrite("a1", "ep1", 0.7, createdAt)],
        );

        expect(result.dbPath).toContain(join("journal", "2026", "W20", "day_2026_05_12.db"));
        expect(await Bun.file(join(root, "journal", "2026", "W20", "week.index.surreal")).exists()).toBe(true);
        expect(await Bun.file(join(root, "journal", "2026", "W20", "week.summary.md")).exists()).toBe(true);
        const stats = await store.dayStats(createdAt);
        expect(stats.episodeCount).toBe(1);
        expect(stats.atomCount).toBe(1);
    });

    test("lists only atoms at or above the AtomScore threshold", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-journal-visible-"));
        const store = new JournalStore({ journalRoot: join(root, "journal") });
        const createdAt = "2026-05-12T08:00:00.000Z";

        await store.appendEpisode(
            {
                id: "ep1",
                userId: "u1",
                channelId: "stdio",
                projectId: "p1",
                role: ModelRole.User,
                text: "hello",
                createdAt,
            },
            [atomWrite("low", "ep1", 0.2, createdAt), atomWrite("high", "ep1", 0.9, createdAt)],
        );

        const visible = await store.listVisibleAtoms(createdAt, { minScore: 0.5, userId: "u1" });
        expect(visible.map((entry) => entry.atom.id)).toEqual(["high"]);
        expect(visible[0]?.score.total).toBe(0.9);
    });

    test("rejects atoms that do not reference the written episode", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-journal-reject-"));
        const store = new JournalStore({ journalRoot: join(root, "journal") });
        const createdAt = "2026-05-12T08:00:00.000Z";

        await expect(
            store.appendEpisode(
                {
                    id: "ep1",
                    userId: "u1",
                    channelId: "stdio",
                    projectId: "p1",
                    role: ModelRole.User,
                    text: "hello",
                    createdAt,
                },
                [atomWrite("a1", "other", 0.7, createdAt)],
            ),
        ).rejects.toThrow("does not reference episode");
    });
});

function atomWrite(id: string, episodeId: string, total: number, createdAt: string): JournalAtomWrite {
    const atom: MemoryAtom = {
        id,
        episodeIds: [episodeId],
        userId: "u1",
        channelId: "stdio",
        projectId: "p1",
        role: ModelRole.User,
        task: "test",
        context: "journal store test",
        action: "write",
        outcome: "stored",
        success: true,
        confidence: 0.9,
        priorWeight: 0.8,
        embedding: [1, 2, 3],
        text: id,
        stage: AtomStage.Raw,
        createdAt,
    };
    const score: AtomScore = {
        atomId: id,
        recency: total,
        access: 0.1,
        successPrior: 0.8,
        fanout: 0.1,
        total,
        inboxDecayApplied: false,
    };
    return { atom, score };
}
