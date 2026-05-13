#!/usr/bin/env bun
/**
 * LF-P1 journal smoke test.
 *
 * Verifies Bun SQLite can create, open, write, close, and readonly-reopen
 * multiple day-partitioned journal databases under:
 *
 *   journal/<yyyy>/W<ww>/day_YYYY_MM_DD.db
 *
 * This script does not touch runtime storage and does not change application
 * behavior. It is an implementation probe before LF-P1 introduces a real
 * journal writer.
 *
 * Usage:
 *   bun run scripts/journal.smoke.ts [--days 14] [--events 20] [--root /tmp/flyflor-journal-smoke] [--keep]
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JournalStore } from "../src/neural/memory/journal.store.ts";
import { AtomStage, ModelRole, type AtomScore, type MemoryAtom } from "../src/protocol/contracts/index.ts";

interface CliOptions {
    days: number;
    eventsPerDay: number;
    keep: boolean;
    root: string;
}

interface DayReport {
    atomCount: number;
    date: string;
    dbPath: string;
    episodeCount: number;
    week: string;
}

interface SmokeReport {
    days: number;
    elapsedMs: number;
    eventsPerDay: number;
    journalRoot: string;
    ok: boolean;
    totalAtoms: number;
    totalEpisodes: number;
    weeks: string[];
    written: DayReport[];
}

function parseArgs(argv: string[]): CliOptions {
    const fallbackRoot = join(tmpdir(), `flyflor-journal-smoke-${Date.now()}`);
    const options: CliOptions = {
        days: 14,
        eventsPerDay: 20,
        keep: false,
        root: fallbackRoot,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--days" && argv[i + 1]) {
            options.days = positiveInt(argv[i + 1]!, options.days);
            i += 1;
        } else if (arg === "--events" && argv[i + 1]) {
            options.eventsPerDay = positiveInt(argv[i + 1]!, options.eventsPerDay);
            i += 1;
        } else if (arg === "--root" && argv[i + 1]) {
            options.root = argv[i + 1]!;
            i += 1;
        } else if (arg === "--keep") {
            options.keep = true;
        }
    }
    return options;
}

function positiveInt(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dateAtOffset(offsetDays: number): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays));
}

function formatDate(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}_${mm}_${dd}`;
}

async function writeDay(root: string, date: Date, eventsPerDay: number): Promise<DayReport> {
    const store = new JournalStore({ journalRoot: join(root, "journal") });
    const createdAt = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
    ).toISOString();
    const dateKey = formatDate(date);
    for (let i = 0; i < eventsPerDay; i += 1) {
        const episodeId = `${dateKey}-ep-${i}`;
        await store.appendEpisode(
            {
                id: episodeId,
                userId: "user-smoke",
                channelId: "stdio",
                projectId: i % 3 === 0 ? "inbox" : "project-smoke",
                role: i % 2 === 0 ? ModelRole.User : ModelRole.Assistant,
                text: `episode ${i} on ${dateKey}`,
                createdAt,
            },
            [buildAtom(dateKey, episodeId, i, eventsPerDay, createdAt)],
        );
    }
    const stats = await store.dayStats(date);
    return {
        atomCount: stats.atomCount,
        date: stats.dateKey,
        dbPath: stats.dbPath,
        episodeCount: stats.episodeCount,
        week: stats.week,
    };
}

function buildAtom(
    dateKey: string,
    episodeId: string,
    index: number,
    eventsPerDay: number,
    createdAt: string,
): { atom: MemoryAtom; score: AtomScore } {
    const atomId = `${dateKey}-atom-${index}`;
    const scoreTotal = Number((0.25 + index / Math.max(1, eventsPerDay)).toFixed(4));
    return {
        atom: {
            id: atomId,
            episodeIds: [episodeId],
            userId: "user-smoke",
            channelId: "stdio",
            projectId: index % 3 === 0 ? "inbox" : "project-smoke",
            role: index % 2 === 0 ? ModelRole.User : ModelRole.Assistant,
            task: "smoke",
            context: "journal smoke",
            action: "write",
            outcome: "written",
            success: true,
            confidence: 0.9,
            priorWeight: 0.8,
            embedding: [index, index + 1, index + 2],
            text: `atom ${index} on ${dateKey}`,
            stage: AtomStage.Raw,
            createdAt,
        },
        score: {
            atomId,
            recency: scoreTotal,
            access: 0.1,
            successPrior: 0.9,
            fanout: 0.1,
            total: scoreTotal,
            inboxDecayApplied: index % 3 === 0,
        },
    };
}

async function main(): Promise<void> {
    const options = parseArgs(Bun.argv.slice(2));
    const start = performance.now();
    await rm(options.root, { force: true, recursive: true });
    await mkdir(options.root, { recursive: true });

    const written: DayReport[] = [];
    for (let offset = 0; offset < options.days; offset += 1) {
        written.push(await writeDay(options.root, dateAtOffset(offset), options.eventsPerDay));
    }

    const totalEpisodes = written.reduce((sum, item) => sum + item.episodeCount, 0);
    const totalAtoms = written.reduce((sum, item) => sum + item.atomCount, 0);
    const weeks = [...new Set(written.map((item) => item.week))].sort();
    const report: SmokeReport = {
        days: options.days,
        elapsedMs: Number((performance.now() - start).toFixed(2)),
        eventsPerDay: options.eventsPerDay,
        journalRoot: options.root,
        ok: totalEpisodes === options.days * options.eventsPerDay && totalAtoms === totalEpisodes,
        totalAtoms,
        totalEpisodes,
        weeks,
        written,
    };

    console.log(JSON.stringify(report, null, 2));
    if (!options.keep) {
        await rm(options.root, { force: true, recursive: true });
    }
    if (!report.ok) {
        process.exitCode = 1;
    }
}

await main();
