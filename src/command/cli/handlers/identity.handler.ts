/**
 * LF-R5：`flyflor identity list|revert` CLI 处理器。
 *
 * 与 ghost handler 同模式：直接读 brain.db，不通过 runtime。
 * 命令只暴露查看与回滚；新增 identity 完全由模型自发输出，CLI 不提供 add。
 */

import type { Command } from "commander";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { BrainStore } from "../../../fch/hippocampus/memory/brain/store.ts";
import { loadConfig } from "../../../config/index.ts";
import {
    MemoryEventStatus,
    type IdentityEventContent,
    type MemoryEventRecord,
} from "../../../protocol/contracts/index.ts";

interface IdentityListOptions {
    user?: string;
    limit?: string;
    all?: boolean;
    json?: boolean;
}

interface IdentityRevertOptions {
    json?: boolean;
}

export async function runIdentity(sub: string | undefined, command: Command): Promise<void> {
    if (sub === "list" || sub === undefined) return runIdentityList(command);
    if (sub === "revert") return runIdentityRevert(command);
    console.error(`Unknown identity subcommand: ${sub}`);
    process.exitCode = 2;
}

async function openBrainOrFail(json: boolean | undefined): Promise<BrainStore | null> {
    const config = await loadConfig();
    const brainPath = join(config.paths.configDir, "brain.db");
    try {
        await stat(brainPath);
    } catch {
        if (json) console.log(JSON.stringify({ identity: [], brainPath, present: false }));
        else console.log(`brain.db not found at ${brainPath}`);
        return null;
    }
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    return store;
}

async function runIdentityList(command: Command): Promise<void> {
    const opts = command.opts<IdentityListOptions>();
    if (!opts.user) {
        console.error("Usage: flyflor identity list --user <id> [--limit <n>] [--all] [--json]");
        process.exitCode = 2;
        return;
    }
    const limit = opts.limit ? Math.max(1, Math.min(500, Number.parseInt(opts.limit, 10) || 32)) : 32;
    const store = await openBrainOrFail(opts.json);
    if (!store) return;
    try {
        const rows = opts.all
            ? store.listAllIdentity(opts.user, { limit })
            : store.listActiveIdentity(opts.user, { limit });
        if (opts.json) {
            console.log(
                JSON.stringify(
                    {
                        identity: rows.map((r) => renderIdentityJson(r, store)),
                        present: true,
                    },
                    null,
                    2,
                ),
            );
            return;
        }
        if (rows.length === 0) {
            console.log("(no identity entries)");
            return;
        }
        for (const row of rows) {
            const c = row.content as Partial<IdentityEventContent>;
            const state = store.getState(row.id);
            const status = state?.status ?? MemoryEventStatus.Live;
            const kind = c.kind ?? "other";
            const confidence = typeof c.confidence === "number" ? c.confidence.toFixed(2) : "-";
            const content = typeof c.content === "string" ? truncate(c.content, 120) : "";
            console.log(`${row.id}  [${kind}] (${status}, conf=${confidence})  ${content}`);
        }
    } finally {
        store.close();
    }
}

async function runIdentityRevert(command: Command): Promise<void> {
    const opts = command.opts<IdentityRevertOptions>();
    const args = command.args;
    const eventId = args[0];
    if (!eventId) {
        console.error("Usage: flyflor identity revert <event-id> [--json]");
        process.exitCode = 2;
        return;
    }
    const store = await openBrainOrFail(opts.json);
    if (!store) return;
    try {
        const row = store.getEvent(eventId);
        if (!row || row.type !== "identity-append") {
            const msg = `identity event ${eventId} not found`;
            if (opts.json) console.log(JSON.stringify({ ok: false, message: msg }));
            else console.error(msg);
            process.exitCode = 1;
            return;
        }
        const nowMs = Date.now();
        store.upsertState(eventId, { status: MemoryEventStatus.Abandoned, lastAccessed: nowMs });
        const prev = (row.content as unknown as IdentityEventContent) ?? null;
        if (prev) {
            store.updateEventContent(eventId, {
                ...prev,
                revertedAt: nowMs,
            } as unknown as Record<string, unknown>);
        }
        if (opts.json) {
            console.log(JSON.stringify({ ok: true, eventId, revertedAt: nowMs }));
        } else {
            console.log(`reverted: ${eventId}`);
        }
    } finally {
        store.close();
    }
}

function renderIdentityJson(row: MemoryEventRecord, store: BrainStore): Record<string, unknown> {
    const c = row.content as Partial<IdentityEventContent>;
    const state = store.getState(row.id);
    return {
        id: row.id,
        ts: row.ts,
        userId: row.userId,
        kind: c.kind,
        content: c.content,
        confidence: c.confidence,
        revertedAt: c.revertedAt,
        status: state?.status ?? MemoryEventStatus.Live,
    };
}

function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
