import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeBackgroundScheduler, describeBrainDb, describeWorkingMemoryHealth } from "../src/command/cli/status.ts";
import type { FlyflorConfig } from "../src/config/index.ts";
import { BrainStore } from "../src/neural/memory/brain.store.ts";
import {
    CrystalMemoryBackend,
    MemoryEventStatus,
    MemoryEventType,
    MemoryLinkType,
    MemoryWorkingBackend,
    SummaryRange,
} from "../src/protocol/contracts/index.ts";

function configForHome(home: string): FlyflorConfig {
    return { paths: { home } } as FlyflorConfig;
}

describe("doctor Brain.db visibility", () => {
    test("reports main size, archive files, and core table counts", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-doctor-brain-"));
        try {
            const brain = new BrainStore({ dbPath: join(root, "brain.db") });
            await brain.open();
            try {
                const ts = Date.UTC(2026, 4, 14);
                brain.appendEvent({ id: "e1", ts, userId: "u1", type: MemoryEventType.Event, content: {} });
                brain.appendEvent({ id: "e2", ts: ts + 1, userId: "u1", type: MemoryEventType.Event, content: {} });
                brain.upsertState("e1", { status: MemoryEventStatus.Live });
                brain.writeSummary({
                    id: "s1",
                    timeRange: SummaryRange.Day,
                    bucketKey: "2026-05-14",
                    content: "{}",
                    createdAt: ts,
                });
                brain.writeLink({
                    id: "l1",
                    fromId: "e1",
                    toId: "e2",
                    strength: 1,
                    type: MemoryLinkType.Derived,
                    createdAt: ts,
                });
                brain.upsertCodename({
                    id: "c1",
                    name: "demo",
                    userId: "u1",
                    createdAt: ts,
                    lastUsedAt: ts,
                    useCount: 1,
                });
            } finally {
                brain.close();
            }

            // Archive files are counted by filename convention; doctor does not ATTACH or scan them.
            await mkdir(join(root, "archive"), { recursive: true });
            await writeFile(join(root, "archive", "brain.2026-04.db"), "");

            const summary = await describeBrainDb(configForHome(root));

            expect(summary.status).toBe("ok");
            expect(summary.detail).toContain("main");
            expect(summary.detail).toContain("1 archive file(s)");
            expect(summary.detail).toContain("events=2");
            expect(summary.detail).toContain("state=1");
            expect(summary.detail).toContain("summaries=1");
            expect(summary.detail).toContain("links=1");
            expect(summary.detail).toContain("codenames=1");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("warns before brain.db is initialized", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-doctor-empty-"));
        try {
            const summary = await describeBrainDb(configForHome(root));

            expect(summary.status).toBe("warn");
            expect(summary.detail).toContain("not initialized yet");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe("doctor background scheduler visibility", () => {
    test("local working memory plus local crystal graph is reported as enabled", () => {
        const summary = describeBackgroundScheduler({
            memory: {
                crystal: {
                    backend: CrystalMemoryBackend.Local,
                    enabled: true,
                    local: { dbFile: "/tmp/crystal.db" },
                    surreal: { enabled: false },
                },
                redis: { enabled: false },
                working: {
                    backend: MemoryWorkingBackend.Local,
                },
            },
        } as FlyflorConfig);

        expect(summary.status).toBe("ok");
        expect(summary.detail).toContain("local working memory");
    });

    test("surreal backend still requires surreal to be enabled", () => {
        const summary = describeBackgroundScheduler({
            memory: {
                crystal: {
                    backend: CrystalMemoryBackend.Surreal,
                    enabled: true,
                    local: {},
                    surreal: { enabled: false },
                },
                redis: { enabled: false },
                working: {
                    backend: MemoryWorkingBackend.Local,
                },
            },
        } as FlyflorConfig);

        expect(summary.status).toBe("warn");
        expect(summary.detail).toContain("crystal graph");
    });
});

describe("doctor working memory health visibility", () => {
    test("reports a local working memory snapshot without treating lazy load as failure", () => {
        const summary = describeWorkingMemoryHealth({
            backend: "local",
            circuitState: "closed",
            loaded: false,
            loadedFrom: "empty",
            recoveredFromBackup: false,
            replayedWalRecords: 0,
            tornWalLines: 0,
        });

        expect(summary.status).toBe("ok");
        expect(summary.detail).toContain("local not loaded");
    });

    test("surfaces backup recovery and WAL replay counters", () => {
        const summary = describeWorkingMemoryHealth({
            backend: "local",
            circuitState: "closed",
            loaded: true,
            loadedFrom: "backup+wal",
            recoveredFromBackup: true,
            replayedWalRecords: 12,
            tornWalLines: 1,
        });

        expect(summary.status).toBe("ok");
        expect(summary.detail).toContain("backup recovered");
        expect(summary.detail).toContain("wal=12");
        expect(summary.detail).toContain("torn=1");
    });

    test("warns when the working memory circuit breaker is open", () => {
        const summary = describeWorkingMemoryHealth({
            backend: "local",
            circuitState: "open",
            lastError: "disk outage",
            loaded: true,
        });

        expect(summary.status).toBe("warn");
        expect(summary.detail).toContain("circuit open");
        expect(summary.detail).toContain("disk outage");
    });
});
