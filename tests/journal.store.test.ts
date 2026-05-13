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

    test("window recall keeps AtomScore ordering and threshold under load", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-journal-window-"));
        const store = new JournalStore({ journalRoot: join(root, "journal") });
        const r = rng(0x5150);
        const expected: Array<{ createdAt: string; id: string; score: number }> = [];

        for (let day = 0; day < 9; day += 1) {
            const createdAt = new Date(Date.UTC(2026, 4, 12 - day, 8, 0, 0)).toISOString();
            const writes: JournalAtomWrite[] = [];
            for (let index = 0; index < 30; index += 1) {
                const score = Math.round(r() * 1000) / 1000;
                const id = `d${day}-a${index}`;
                writes.push(atomWrite(id, `ep-${day}`, score, createdAt));
                if (day < 7 && score >= 0.65) {
                    expected.push({ createdAt, id, score });
                }
            }
            await store.appendEpisode(
                {
                    id: `ep-${day}`,
                    userId: "u1",
                    channelId: "stdio",
                    projectId: "p1",
                    role: ModelRole.User,
                    text: `day ${day}`,
                    createdAt,
                },
                writes,
            );
        }

        const visible = await store.listVisibleAtomsWindow("2026-05-12T08:00:00.000Z", {
            days: 7,
            limit: 50,
            minScore: 0.65,
            userId: "u1",
        });
        const expectedIds = expected
            .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
            .slice(0, 50)
            .map((entry) => entry.id);

        expect(visible).toHaveLength(expectedIds.length);
        expect(visible.map((entry) => entry.atom.id)).toEqual(expectedIds);
        for (const entry of visible) {
            expect(entry.score.total).toBeGreaterThanOrEqual(0.65);
            expect(entry.atom.id.startsWith("d7-")).toBe(false);
            expect(entry.atom.id.startsWith("d8-")).toBe(false);
        }
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

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
