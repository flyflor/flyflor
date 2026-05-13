import { describe, expect, test } from "bun:test";

import { BrainStore } from "../src/neural/memory/brain.store.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function tempStore(): Promise<{ store: BrainStore; cleanup: () => Promise<void>; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-inbox-recall-"));
    const store = new BrainStore({ dbPath: join(root, "brain.db") });
    await store.open();
    return {
        store,
        root,
        cleanup: async () => {
            store.close();
            await rm(root, { force: true, recursive: true });
        },
    };
}

describe("P2 inbox slice B — recall bias helpers", () => {
    test("getMostRecentTouchedCodename: 仅返回 last_used_at >= sinceTs 且 project_id 为空的最新行", async () => {
        const { store, cleanup } = await tempStore();
        try {
            const userId = "u-recall";
            const now = Date.now();
            // 老的（已超出 sinceTs 窗口）
            store.upsertCodename({
                id: "cn-old",
                name: "old",
                userId,
                createdAt: now - 4 * 3600_000,
                lastUsedAt: now - 4 * 3600_000,
                useCount: 1,
            });
            // 中等（在窗口内）
            store.upsertCodename({
                id: "cn-mid",
                name: "mid",
                userId,
                createdAt: now - 30 * 60_000,
                lastUsedAt: now - 30 * 60_000,
                useCount: 1,
            });
            // 最新（在窗口内）
            store.upsertCodename({
                id: "cn-fresh",
                name: "fresh",
                userId,
                createdAt: now - 5 * 60_000,
                lastUsedAt: now - 5 * 60_000,
                useCount: 1,
            });
            // 已升格（project_id 非空）—— 必须被过滤
            store.upsertCodename({
                id: "cn-promoted",
                name: "promoted",
                userId,
                createdAt: now - 1 * 60_000,
                lastUsedAt: now - 1 * 60_000,
                useCount: 5,
            });
            store.bindCodenameProject("cn-promoted", "project-real");

            const sinceTs = now - 60 * 60_000; // 60 分钟窗口
            const r = store.getMostRecentTouchedCodename(userId, sinceTs);
            expect(r).toBeTruthy();
            expect(r!.id).toBe("cn-fresh");

            // 窗口太窄：1 分钟内无 touch → 空
            const r2 = store.getMostRecentTouchedCodename(userId, now - 30_000);
            expect(r2).toBeNull();

            // 不同用户：无命中
            const r3 = store.getMostRecentTouchedCodename("other-user", sinceTs);
            expect(r3).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test("getMostRecentTouchedCodename: 已升格 codename 不参与召回偏变（project_id IS NULL 过滤）", async () => {
        const { store, cleanup } = await tempStore();
        try {
            const userId = "u-only-promoted";
            const now = Date.now();
            store.upsertCodename({
                id: "cn-onlypromoted",
                name: "x",
                userId,
                createdAt: now - 60_000,
                lastUsedAt: now - 60_000,
                useCount: 9,
            });
            store.bindCodenameProject("cn-onlypromoted", "project-x");
            const r = store.getMostRecentTouchedCodename(userId, now - 60 * 60_000);
            expect(r).toBeNull();
        } finally {
            await cleanup();
        }
    });
});
