import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    JournalStore,
    JournalWriteRejectedError,
} from "../src/neural/memory/journal.store.ts";
import { AtomStage, ModelRole } from "../src/protocol/contracts/index.ts";

const dirs: string[] = [];

afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-journal-grace-"));
    dirs.push(dir);
    return dir;
}

function makeAtomScore() {
    return {
        recency: 1,
        access: 0,
        successPrior: 0,
        fanout: 0,
        total: 1,
        inboxDecayApplied: 0,
        explain: null,
    };
}

describe("JournalStore LF-R1 legacy grace", () => {
    test("rejects writes whose createdAt is older than legacyGraceDays", async () => {
        const root = await makeRoot();
        const store = new JournalStore({ journalRoot: root, legacyGraceDays: 60 });
        const oldDate = new Date(Date.now() - 90 * 86_400_000).toISOString();
        await expect(
            store.appendEpisode({
                id: "ep-old",
                userId: "u1",
                channelId: "stdio",
                projectId: "default",
                role: ModelRole.User,
                text: "old turn",
                createdAt: oldDate,
            }),
        ).rejects.toBeInstanceOf(JournalWriteRejectedError);
    });

    test("accepts writes within grace window", async () => {
        const root = await makeRoot();
        const store = new JournalStore({ journalRoot: root, legacyGraceDays: 60 });
        const recent = new Date().toISOString();
        const result = await store.appendEpisode({
            id: "ep-now",
            userId: "u1",
            channelId: "stdio",
            projectId: "default",
            role: ModelRole.User,
            text: "fresh turn",
            createdAt: recent,
        });
        expect(result.episodeId).toBe("ep-now");
    });

    test("legacyGraceDays<=0 disables guard", async () => {
        const root = await makeRoot();
        const store = new JournalStore({ journalRoot: root, legacyGraceDays: 0 });
        const ancient = new Date(Date.now() - 365 * 86_400_000).toISOString();
        const result = await store.appendEpisode({
            id: "ep-ancient",
            userId: "u1",
            channelId: "stdio",
            projectId: "default",
            role: ModelRole.User,
            text: "very old",
            createdAt: ancient,
        });
        expect(result.episodeId).toBe("ep-ancient");
    });
});
