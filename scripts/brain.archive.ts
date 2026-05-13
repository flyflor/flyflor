#!/usr/bin/env bun
/**
 * LF-R1 brain.db monthly cold-archive script.
 *
 * Moves events from a live `brain.db` whose `time_bucket` (YYYY-MM-DD) falls in
 * months older than the cutoff to a per-month archive file:
 *
 *   <brainDir>/archive/brain.YYYY-MM.db
 *
 * Each archive file has the same schema as the live brain.db. Read-side mounts
 * via `ATTACH DATABASE` (caller responsibility — out of scope here).
 *
 * Boundary contract:
 * - This is an ADMIN tool. It IS allowed to `DELETE FROM memory_events` after
 *   copying rows to the archive (R7 forbids Dream from doing so, not admin
 *   scripts).
 * - It only archives events with `status='archived'` in `memory_state` AND
 *   whose `time_bucket` is older than the cutoff month. Live / resumed events
 *   are never moved, regardless of age.
 * - `memory_links` is left untouched (links may cross months; harmless to keep
 *   in live db). `memory_summary` follows events: summary rows whose
 *   `bucket_key` falls in the archived month are moved too. `codenames` stays
 *   live.
 * - Runs in a single transaction per month for atomicity.
 *
 * Usage:
 *   bun run scripts/brain.archive.ts \
 *     --brain ~/.flyflor/brain.db \
 *     --months 3 \
 *     [--dry-run] [--vacuum]
 *
 * No options are read from config or env per repo rules — only CLI flags, and
 * defaults match `flyflor doctor` conventions (cutoff = 3 months).
 */

import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

interface CliOptions {
    brainPath: string;
    cutoffMonths: number;
    dryRun: boolean;
    vacuum: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const opts: CliOptions = {
        brainPath: "",
        cutoffMonths: 3,
        dryRun: false,
        vacuum: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--brain":
                opts.brainPath = argv[++i] ?? "";
                break;
            case "--months":
                opts.cutoffMonths = Math.max(1, Number(argv[++i] ?? "3"));
                break;
            case "--dry-run":
                opts.dryRun = true;
                break;
            case "--vacuum":
                opts.vacuum = true;
                break;
            case "--help":
            case "-h":
                printHelp();
                process.exit(0);
        }
    }
    if (!opts.brainPath) {
        console.error("Error: --brain <path> is required");
        printHelp();
        process.exit(1);
    }
    return opts;
}

function printHelp(): void {
    console.error(
        [
            "Usage: bun run scripts/brain.archive.ts --brain <path> [options]",
            "",
            "Required:",
            "  --brain <path>      Path to live brain.db",
            "",
            "Options:",
            "  --months <n>        Cutoff in months (default 3). Months strictly older",
            "                      than (today - n months) are archived.",
            "  --dry-run           Show plan without writing.",
            "  --vacuum            VACUUM live brain.db after archiving.",
            "  -h, --help          Show this help.",
        ].join("\n"),
    );
}

function cutoffBucketMonth(months: number): string {
    const now = new Date();
    const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1),
    );
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
}

const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS memory_events (
        id           TEXT PRIMARY KEY,
        ts           INTEGER NOT NULL,
        time_bucket  TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        channel_id   TEXT,
        codename_id  TEXT,
        type         TEXT NOT NULL,
        role         TEXT,
        content      TEXT NOT NULL,
        parent_id    TEXT,
        embedding_id TEXT,
        importance   REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_events_time     ON memory_events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_bucket   ON memory_events(time_bucket);
    CREATE INDEX IF NOT EXISTS idx_events_codename ON memory_events(codename_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_type     ON memory_events(type, ts);
    CREATE INDEX IF NOT EXISTS idx_events_user     ON memory_events(user_id, ts);

    CREATE TABLE IF NOT EXISTS memory_state (
        event_id      TEXT PRIMARY KEY,
        status        TEXT NOT NULL,
        activation    REAL NOT NULL DEFAULT 1,
        decay_score   REAL NOT NULL DEFAULT 1,
        access_count  INTEGER NOT NULL DEFAULT 0,
        last_accessed INTEGER,
        resumed_at    INTEGER,
        archived_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_state_status ON memory_state(status);

    CREATE TABLE IF NOT EXISTS memory_summary (
        id           TEXT PRIMARY KEY,
        time_range   TEXT NOT NULL,
        bucket_key   TEXT NOT NULL,
        content      TEXT NOT NULL,
        embedding_id TEXT,
        created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summary_range_bucket ON memory_summary(time_range, bucket_key);
`;

interface MonthPlan {
    bucketMonth: string;
    eventCount: number;
}

async function findArchivableMonths(
    db: Database,
    cutoff: string,
): Promise<MonthPlan[]> {
    const rows = db
        .query<{ bucket_month: string; n: number }, [string]>(
            `SELECT substr(e.time_bucket, 1, 7) AS bucket_month, COUNT(*) AS n
               FROM memory_events e
               JOIN memory_state  s ON s.event_id = e.id
              WHERE s.status = 'archived'
                AND substr(e.time_bucket, 1, 7) < ?1
              GROUP BY bucket_month
              ORDER BY bucket_month ASC`,
        )
        .all(cutoff);
    return rows.map((r) => ({ bucketMonth: r.bucket_month, eventCount: r.n }));
}

interface ArchiveResult {
    eventsCopied: number;
    statesCopied: number;
    summariesCopied: number;
}

function archiveMonth(
    liveDb: Database,
    archivePath: string,
    bucketMonth: string,
): ArchiveResult {
    const archiveDb = new Database(archivePath, { create: true });
    try {
        archiveDb.exec("PRAGMA journal_mode = WAL;");
        archiveDb.exec(SCHEMA_SQL);

        const events = liveDb
            .query<Record<string, unknown>, [string]>(
                `SELECT e.* FROM memory_events e
                   JOIN memory_state s ON s.event_id = e.id
                  WHERE s.status = 'archived'
                    AND substr(e.time_bucket, 1, 7) = ?1`,
            )
            .all(bucketMonth);

        const states = liveDb
            .query<Record<string, unknown>, [string]>(
                `SELECT s.* FROM memory_state s
                   JOIN memory_events e ON s.event_id = e.id
                  WHERE s.status = 'archived'
                    AND substr(e.time_bucket, 1, 7) = ?1`,
            )
            .all(bucketMonth);

        const summaries = liveDb
            .query<Record<string, unknown>, [string]>(
                `SELECT * FROM memory_summary WHERE substr(bucket_key, 1, 7) = ?1`,
            )
            .all(bucketMonth);

        archiveDb.transaction(() => {
            const insertEvent = archiveDb.prepare(
                `INSERT OR REPLACE INTO memory_events
                 (id, ts, time_bucket, user_id, channel_id, codename_id, type,
                  role, content, parent_id, embedding_id, importance)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const e of events) {
                insertEvent.run(
                    e.id as string,
                    e.ts as number,
                    e.time_bucket as string,
                    e.user_id as string,
                    (e.channel_id ?? null) as string | null,
                    (e.codename_id ?? null) as string | null,
                    e.type as string,
                    (e.role ?? null) as string | null,
                    e.content as string,
                    (e.parent_id ?? null) as string | null,
                    (e.embedding_id ?? null) as string | null,
                    e.importance as number,
                );
            }

            const insertState = archiveDb.prepare(
                `INSERT OR REPLACE INTO memory_state
                 (event_id, status, activation, decay_score, access_count,
                  last_accessed, resumed_at, archived_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const s of states) {
                insertState.run(
                    s.event_id as string,
                    s.status as string,
                    s.activation as number,
                    s.decay_score as number,
                    s.access_count as number,
                    (s.last_accessed ?? null) as number | null,
                    (s.resumed_at ?? null) as number | null,
                    (s.archived_at ?? null) as number | null,
                );
            }

            const insertSummary = archiveDb.prepare(
                `INSERT OR REPLACE INTO memory_summary
                 (id, time_range, bucket_key, content, embedding_id,
                  created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
            );
            for (const s of summaries) {
                insertSummary.run(
                    s.id as string,
                    s.time_range as string,
                    s.bucket_key as string,
                    s.content as string,
                    (s.embedding_id ?? null) as string | null,
                    s.created_at as number,
                );
            }
        })();

        liveDb.transaction(() => {
            const eventIds = events.map((e) => e.id as string);
            if (eventIds.length > 0) {
                const placeholders = eventIds.map(() => "?").join(",");
                liveDb
                    .prepare(
                        `DELETE FROM memory_state WHERE event_id IN (${placeholders})`,
                    )
                    .run(...eventIds);
                liveDb
                    .prepare(
                        `DELETE FROM memory_events WHERE id IN (${placeholders})`,
                    )
                    .run(...eventIds);
            }
            liveDb
                .prepare(
                    `DELETE FROM memory_summary
                      WHERE substr(bucket_key, 1, 7) = ?1`,
                )
                .run(bucketMonth);
        })();

        return {
            eventsCopied: events.length,
            statesCopied: states.length,
            summariesCopied: summaries.length,
        };
    } finally {
        archiveDb.close();
    }
}

async function ensureExists(path: string): Promise<void> {
    try {
        await stat(path);
    } catch {
        console.error(`Error: brain.db not found at ${path}`);
        process.exit(2);
    }
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    await ensureExists(opts.brainPath);

    const archiveDir = join(dirname(opts.brainPath), "archive");
    await mkdir(archiveDir, { recursive: true });

    const cutoff = cutoffBucketMonth(opts.cutoffMonths);
    console.error(`Cutoff month (exclusive): ${cutoff}`);
    console.error(`Archive dir: ${archiveDir}`);

    const liveDb = new Database(opts.brainPath);
    liveDb.exec("PRAGMA journal_mode = WAL;");
    liveDb.exec("PRAGMA foreign_keys = ON;");

    try {
        const plans = await findArchivableMonths(liveDb, cutoff);
        if (plans.length === 0) {
            console.error("No archivable months found.");
            return;
        }

        for (const plan of plans) {
            const archivePath = join(
                archiveDir,
                `brain.${plan.bucketMonth}.db`,
            );
            if (opts.dryRun) {
                console.error(
                    `[dry-run] would archive ${plan.eventCount} events ` +
                        `from ${plan.bucketMonth} → ${archivePath}`,
                );
                continue;
            }
            const result = archiveMonth(liveDb, archivePath, plan.bucketMonth);
            console.error(
                `archived ${plan.bucketMonth}: events=${result.eventsCopied} ` +
                    `states=${result.statesCopied} ` +
                    `summaries=${result.summariesCopied} → ${archivePath}`,
            );
        }

        if (opts.vacuum && !opts.dryRun) {
            console.error("VACUUM live brain.db ...");
            liveDb.exec("VACUUM;");
        }
    } finally {
        liveDb.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
