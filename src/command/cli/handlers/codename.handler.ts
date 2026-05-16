import type { Command } from "commander";
import { join } from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { BrainStore } from "../../../components/memory/brain.store.ts";
import { loadConfig } from "../../../config/index.ts";
import { ProjectScaffolder } from "../../../agent/project/scaffolder.ts";
import { promoteCodename as promoteCodenameHelper } from "../../../agent/project/codename.promote.ts";
import { event, RuntimeEventType, type EventSink } from "../../../protocol/events/index.ts";

interface CodenameListOptions {
    user?: string;
    limit?: string;
    json?: boolean;
}

interface CodenamePromoteOptions {
    force?: boolean;
    json?: boolean;
}

interface CodenameUseOptions {
    user?: string;
    json?: boolean;
}

export async function runCodename(sub: string | undefined, command: Command): Promise<void> {
    if (sub === "list" || sub === undefined) {
        await runCodenameList(command);
        return;
    }
    if (sub === "promote") {
        await runCodenamePromote(command);
        return;
    }
    if (sub === "use") {
        await runCodenameUse(command);
        return;
    }
    console.error(`Unknown codename subcommand: ${sub}`);
    process.exitCode = 2;
}

async function runCodenameList(command: Command): Promise<void> {
    const opts = command.opts<CodenameListOptions>();
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? "50")));

    const config = await loadConfig();
    const brainPath = join(config.paths.home, "brain.db");
    try {
        await stat(brainPath);
    } catch {
        if (opts.json) {
            console.log(JSON.stringify({ codenames: [], brainPath, present: false }));
        } else {
            console.log(`brain.db not found at ${brainPath}`);
        }
        return;
    }

    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    try {
        const rows = store.listCodenames({ userId: opts.user, limit });
        if (opts.json) {
            console.log(JSON.stringify({ codenames: rows, brainPath, present: true }, null, 2));
            return;
        }
        if (rows.length === 0) {
            console.log("No codenames recorded yet.");
            return;
        }
        const header = ["#", "name", "uses", "lastUsedAt", "workingDir", "projectId"];
        console.log(header.join("\t"));
        rows.forEach((r, i) => {
            console.log(
                [
                    i + 1,
                    r.name,
                    r.useCount,
                    new Date(r.lastUsedAt).toISOString(),
                    r.workingDir ?? "-",
                    r.projectId ?? "-",
                ].join("\t"),
            );
        });
    } finally {
        store.close();
    }
}

class ConsoleEventSink implements EventSink {
    private readonly verbose: boolean;
    constructor(verbose: boolean) {
        this.verbose = verbose;
    }
    publish(evt: ReturnType<typeof event>): void {
        if (this.verbose) console.error(`[event] ${evt.type}`);
    }
}

async function openBrainOrExit(opts: { json?: boolean }): Promise<{ store: BrainStore; brainPath: string } | null> {
    const config = await loadConfig();
    const brainPath = join(config.paths.home, "brain.db");
    try {
        await stat(brainPath);
    } catch {
        if (opts.json) console.log(JSON.stringify({ ok: false, brainPath, present: false }));
        else console.error(`brain.db not found at ${brainPath}`);
        process.exitCode = 1;
        return null;
    }
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    return { store, brainPath };
}

async function runCodenamePromote(command: Command): Promise<void> {
    const opts = command.opts<CodenamePromoteOptions>();
    const name = command.args[0];
    if (!name) {
        console.error("Usage: flyflor codename promote <name> [--force] [--json]");
        process.exitCode = 2;
        return;
    }
    const opened = await openBrainOrExit(opts);
    if (!opened) return;
    const { store } = opened;
    const config = await loadConfig();
    const scaffolder = new ProjectScaffolder(config.paths, new ConsoleEventSink(!opts.json));
    try {
        const all = store.listCodenames({ limit: 200 });
        const matches = all.filter((r) => r.name === name);
        if (matches.length === 0) {
            if (opts.json) console.log(JSON.stringify({ ok: false, reason: "not-found", name }));
            else console.error(`Codename not found: ${name}`);
            process.exitCode = 1;
            return;
        }
        const record = matches[0]!;
        const result = await promoteCodenameHelper(store, scaffolder, record.id, { force: opts.force });
        if (opts.json) {
            console.log(JSON.stringify({ ok: result.promoted, ...result }, null, 2));
        } else if (result.promoted) {
            console.log(`Promoted ${record.name} → projectId=${result.projectId}`);
        } else {
            console.error(`Not promoted: ${result.rationale}`);
            process.exitCode = result.rationale === "scaffold-failed" ? 1 : 0;
        }
    } finally {
        store.close();
    }
}

interface ActiveCodenameHint {
    name: string;
    codenameId: string;
    userId: string;
    activatedAt: number;
    workingDir?: string;
    projectId?: string;
}

async function runCodenameUse(command: Command): Promise<void> {
    const opts = command.opts<CodenameUseOptions>();
    const name = command.args[0];
    if (!name) {
        console.error("Usage: flyflor codename use <name> [--user <id>] [--json]");
        process.exitCode = 2;
        return;
    }
    const opened = await openBrainOrExit(opts);
    if (!opened) return;
    const { store } = opened;
    const config = await loadConfig();
    try {
        const all = store.listCodenames({ userId: opts.user, limit: 200 });
        const record = all.find((r) => r.name === name);
        if (!record) {
            if (opts.json) console.log(JSON.stringify({ ok: false, reason: "not-found", name }));
            else console.error(`Codename not found: ${name}`);
            process.exitCode = 1;
            return;
        }
        const stateDir = join(config.paths.home, "state");
        await mkdir(stateDir, { recursive: true });
        const hint: ActiveCodenameHint = {
            name: record.name,
            codenameId: record.id,
            userId: record.userId,
            activatedAt: Date.now(),
            workingDir: record.workingDir,
            projectId: record.projectId,
        };
        await writeFile(join(stateDir, "active-codename.json"), JSON.stringify(hint, null, 2), "utf8");
        if (opts.json) console.log(JSON.stringify({ ok: true, hint }, null, 2));
        else console.log(`Active codename: ${record.name} (id=${record.id})`);
    } finally {
        store.close();
    }
}
