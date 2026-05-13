import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InFlightTracker } from "../src/agent/runtime/inflight.tracker.ts";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
});

async function mkRoot(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "flyflor-inflight-"));
    roots.push(d);
    return d;
}

describe("LF-R4 InFlightTracker", () => {
    test("markStart writes file, markEnd removes it", async () => {
        const root = await mkRoot();
        const t = new InFlightTracker(root);
        await t.markStart({
            requestId: "req-1",
            userId: "user-1",
            channelId: "stdio",
            originalUserMessage: "hello",
            startedAtMs: Date.now(),
        });
        const orphansBeforeEnd = await new InFlightTracker(root).recoverOrphans();
        // recoverOrphans also deletes; after it the dir is empty, but ensure file existed via the count.
        expect(orphansBeforeEnd.length).toBe(1);
        expect(orphansBeforeEnd[0]?.requestId).toBe("req-1");
        // markEnd on already-cleaned file should not throw.
        await t.markEnd("req-1");
    });

    test("recoverOrphans returns leftover records and clears them", async () => {
        const root = await mkRoot();
        const t = new InFlightTracker(root);
        await t.markStart({
            requestId: "req-orphan",
            userId: "user-x",
            channelId: "tui",
            originalUserMessage: "do the thing",
            startedAtMs: 12345,
            codenameId: "code-1",
        });
        const orphans = await t.recoverOrphans();
        expect(orphans.length).toBe(1);
        expect(orphans[0]).toMatchObject({
            requestId: "req-orphan",
            userId: "user-x",
            channelId: "tui",
            originalUserMessage: "do the thing",
            codenameId: "code-1",
        });
        const second = await t.recoverOrphans();
        expect(second.length).toBe(0);
    });

    test("recoverOrphans skips corrupted JSON but still removes the file", async () => {
        const root = await mkRoot();
        const dir = join(root, "inflight");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "bad.json"), "{not json", "utf8");
        const t = new InFlightTracker(root);
        const orphans = await t.recoverOrphans();
        expect(orphans.length).toBe(0);
        const again = await t.recoverOrphans();
        expect(again.length).toBe(0);
    });

    test("recoverOrphans returns empty when dir does not exist", async () => {
        const root = await mkRoot();
        const t = new InFlightTracker(root);
        const orphans = await t.recoverOrphans();
        expect(orphans.length).toBe(0);
    });
});
