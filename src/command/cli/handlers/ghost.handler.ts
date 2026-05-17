import type { Command } from "commander";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { BrainStore } from "../../../neural/memory/brain/store.ts";
import { loadConfig } from "../../../config/index.ts";
import { MemoryEventStatus, type GhostContextEventContent, type MemoryEventRecord } from "../../../protocol/contracts/index.ts";

interface GhostListOptions {
    user?: string;
    codename?: string;
    limit?: string;
    json?: boolean;
}

interface GhostJsonOptions {
    json?: boolean;
}

export async function runGhost(sub: string | undefined, command: Command): Promise<void> {
    if (sub === "list" || sub === undefined) return runGhostList(command);
    if (sub === "show") return runGhostShow(command);
    if (sub === "resume") return runGhostStateMutation(command, "resume");
    if (sub === "drop") return runGhostStateMutation(command, "drop");
    if (sub === "pin") return runGhostStateMutation(command, "pin");
    console.error(`Unknown ghost subcommand: ${sub}`);
    process.exitCode = 2;
}

async function openBrainOrFail(json: boolean | undefined): Promise<BrainStore | null> {
    const config = await loadConfig();
    const brainPath = join(config.paths.configDir, "brain.db");
    try {
        await stat(brainPath);
    } catch {
        if (json) console.log(JSON.stringify({ ghosts: [], brainPath, present: false }));
        else console.log(`brain.db not found at ${brainPath}`);
        return null;
    }
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    return store;
}

async function runGhostList(command: Command): Promise<void> {
    const opts = command.opts<GhostListOptions>();
    if (!opts.user) {
        console.error("Usage: flyflor ghost list --user <id> [--codename <id>] [--limit <n>] [--json]");
        process.exitCode = 2;
        return;
    }
    const store = await openBrainOrFail(opts.json);
    if (!store) return;
    try {
        const limit = Math.max(1, Math.min(200, Number(opts.limit ?? "20")));
        const rows = store.listActiveGhosts(opts.user, {
            codenameId: opts.codename,
            limit,
        });
        if (opts.json) {
            console.log(JSON.stringify({ ghosts: rows.map(renderGhostJson), present: true }, null, 2));
            return;
        }
        if (rows.length === 0) {
            console.log("No active ghost-context entries.");
            return;
        }
        const header = ["#", "id", "reason", "title", "ts"];
        console.log(header.join("\t"));
        rows.forEach((r, i) => {
            const c = r.content as Partial<GhostContextEventContent>;
            console.log(
                [
                    String(i + 1),
                    r.id,
                    c.reason ?? "-",
                    truncate(c.userFacing?.title ?? "(untitled)", 60),
                    new Date(r.ts).toISOString(),
                ].join("\t"),
            );
        });
    } finally {
        store.close();
    }
}

async function runGhostShow(command: Command): Promise<void> {
    const opts = command.opts<GhostJsonOptions>();
    const args = command.args;
    const id = args[0];
    if (!id) {
        console.error("Usage: flyflor ghost show <ghostEventId> [--json]");
        process.exitCode = 2;
        return;
    }
    const store = await openBrainOrFail(opts.json);
    if (!store) return;
    try {
        const row = store.getEvent(id);
        if (!row || row.type !== "ghost-context") {
            console.error(`Ghost not found: ${id}`);
            process.exitCode = 1;
            return;
        }
        if (opts.json) {
            console.log(JSON.stringify(renderGhostJson(row), null, 2));
            return;
        }
        const c = row.content as Partial<GhostContextEventContent>;
        const state = store.getState(row.id);
        console.log(`ghostEventId : ${row.id}`);
        console.log(`reason       : ${c.reason ?? "-"}`);
        console.log(`ts           : ${new Date(row.ts).toISOString()}`);
        console.log(`status       : ${state?.status ?? MemoryEventStatus.Live}`);
        console.log(`title        : ${c.userFacing?.title ?? "(untitled)"}`);
        if (c.userFacing?.askPrompt) console.log(`askPrompt    : ${c.userFacing.askPrompt}`);
        if (c.userFacing?.contextHint) console.log(`contextHint  : ${c.userFacing.contextHint}`);
        if (c.snapshot?.originalUserMessage) console.log(`originalMsg  : ${c.snapshot.originalUserMessage}`);
    } finally {
        store.close();
    }
}

async function runGhostStateMutation(command: Command, op: "resume" | "drop" | "pin"): Promise<void> {
    const opts = command.opts<GhostJsonOptions>();
    const id = command.args[0];
    if (!id) {
        console.error(`Usage: flyflor ghost ${op} <ghostEventId> [--json]`);
        process.exitCode = 2;
        return;
    }
    const store = await openBrainOrFail(opts.json);
    if (!store) return;
    try {
        const row = store.getEvent(id);
        if (!row || row.type !== "ghost-context") {
            console.error(`Ghost not found: ${id}`);
            process.exitCode = 1;
            return;
        }
        const now = Date.now();
        if (op === "resume") {
            store.upsertState(row.id, {
                status: MemoryEventStatus.Resumed,
                resumedAt: now,
                lastAccessed: now,
            });
        } else if (op === "drop") {
            store.upsertState(row.id, { status: MemoryEventStatus.Abandoned });
        } else {
            const config = await loadConfig();
            const multiplier = Math.max(1, config.memory.tuning.ghost.pinHalflifeMultiplier);
            const baseScore = store.getState(row.id)?.decayScore ?? 1;
            store.upsertState(row.id, { decayScore: baseScore * multiplier });
        }
        const state = store.getState(row.id);
        if (opts.json) {
            console.log(JSON.stringify({ op, ghostEventId: row.id, status: state?.status, decayScore: state?.decayScore }));
        } else {
            console.log(`${op}: ${row.id} (status=${state?.status ?? "-"}, decay=${state?.decayScore?.toFixed(3) ?? "-"})`);
        }
    } finally {
        store.close();
    }
}

function renderGhostJson(row: MemoryEventRecord): Record<string, unknown> {
    const c = row.content as Partial<GhostContextEventContent>;
    return {
        id: row.id,
        ts: row.ts,
        parentId: row.parentId,
        userId: row.userId,
        codenameId: row.codenameId,
        reason: c.reason,
        userFacing: c.userFacing,
        snapshot: c.snapshot,
    };
}

function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
