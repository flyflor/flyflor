import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeBrainDb } from "../src/command/cli/status.ts";
import type { FlyflorConfig } from "../src/config/index.ts";
import { BrainStore } from "../src/neural/memory/brain.store.ts";
import { MemoryEventStatus, MemoryEventType, MemoryLinkType, SummaryRange } from "../src/protocol/contracts/index.ts";

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
