import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

export interface BrainArchiveMonthPlan {
    bucketMonth: string;
    eventCount: number;
}

export interface BrainArchiveMonthResult {
    bucketMonth: string;
    archivePath: string;
    eventsCopied: number;
    statesCopied: number;
    summariesCopied: number;
}

export interface BrainArchiveRunInput {
    archiveAfterMonths: number;
    brainPath: string;
    dryRun?: boolean;
    nowMs?: number;
    statePath?: string;
    vacuumIntervalDays?: number;
    vacuumMode?: "always" | "auto" | "never";
}

export interface BrainArchiveRunResult {
    archiveDir: string;
    cutoffMonth: string;
    dryRun: boolean;
    eventsCopied: number;
    months: BrainArchiveMonthResult[];
    statesCopied: number;
    summariesCopied: number;
    vacuumed: boolean;
}

interface ArchiveState {
    lastVacuumAt?: number;
}

export function cutoffBucketMonth(months: number, nowMs = Date.now()): string {
    const safeMonths = Math.max(1, Math.floor(months));
    const now = new Date(nowMs);
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - safeMonths, 1));
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
}

export const BRAIN_ARCHIVE_SCHEMA_SQL = `
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

export async function ensureBrainDbExists(path: string): Promise<void> {
    await stat(path);
}

export function findArchivableMonths(db: Database, cutoff: string): BrainArchiveMonthPlan[] {
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

export function archiveBrainMonth(liveDb: Database, archivePath: string, bucketMonth: string): BrainArchiveMonthResult {
    const archiveDb = new Database(archivePath, { create: true });
    try {
        archiveDb.exec("PRAGMA journal_mode = WAL;");
        archiveDb.exec(BRAIN_ARCHIVE_SCHEMA_SQL);

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
                 (id, time_range, bucket_key, content, embedding_id, created_at)
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
                liveDb.prepare(`DELETE FROM memory_state WHERE event_id IN (${placeholders})`).run(...eventIds);
                liveDb.prepare(`DELETE FROM memory_events WHERE id IN (${placeholders})`).run(...eventIds);
            }
            liveDb.prepare(`DELETE FROM memory_summary WHERE substr(bucket_key, 1, 7) = ?1`).run(bucketMonth);
        })();

        return {
            bucketMonth,
            archivePath,
            eventsCopied: events.length,
            statesCopied: states.length,
            summariesCopied: summaries.length,
        };
    } finally {
        archiveDb.close();
    }
}

export async function runBrainArchive(input: BrainArchiveRunInput): Promise<BrainArchiveRunResult> {
    await ensureBrainDbExists(input.brainPath);
    const archiveDir = join(dirname(input.brainPath), "archive");
    await mkdir(archiveDir, { recursive: true });

    const nowMs = input.nowMs ?? Date.now();
    const cutoffMonth = cutoffBucketMonth(input.archiveAfterMonths, nowMs);
    const dryRun = input.dryRun === true;

    const liveDb = new Database(input.brainPath);
    liveDb.exec("PRAGMA journal_mode = WAL;");
    liveDb.exec("PRAGMA foreign_keys = ON;");
    try {
        const plans = findArchivableMonths(liveDb, cutoffMonth);
        const months: BrainArchiveMonthResult[] = [];
        for (const plan of plans) {
            const archivePath = join(archiveDir, `brain.${plan.bucketMonth}.db`);
            if (dryRun) {
                months.push({
                    bucketMonth: plan.bucketMonth,
                    archivePath,
                    eventsCopied: plan.eventCount,
                    statesCopied: 0,
                    summariesCopied: 0,
                });
                continue;
            }
            months.push(archiveBrainMonth(liveDb, archivePath, plan.bucketMonth));
        }

        const eventsCopied = months.reduce((sum, item) => sum + item.eventsCopied, 0);
        const statesCopied = months.reduce((sum, item) => sum + item.statesCopied, 0);
        const summariesCopied = months.reduce((sum, item) => sum + item.summariesCopied, 0);
        const vacuumed = !dryRun && eventsCopied > 0 && (await shouldVacuum(input, nowMs));
        if (vacuumed) {
            liveDb.exec("VACUUM;");
            await writeArchiveState(input.statePath, { lastVacuumAt: nowMs });
        }

        return {
            archiveDir,
            cutoffMonth,
            dryRun,
            eventsCopied,
            months,
            statesCopied,
            summariesCopied,
            vacuumed,
        };
    } finally {
        liveDb.close();
    }
}

async function shouldVacuum(input: BrainArchiveRunInput, nowMs: number): Promise<boolean> {
    const mode = input.vacuumMode ?? "auto";
    if (mode === "always") return true;
    if (mode === "never") return false;
    const intervalDays = Math.max(0, input.vacuumIntervalDays ?? 0);
    if (intervalDays <= 0 || !input.statePath) return false;
    const state = await readArchiveState(input.statePath);
    const last = state.lastVacuumAt ?? 0;
    return last <= 0 || nowMs - last >= intervalDays * 24 * 60 * 60_000;
}

async function readArchiveState(path: string): Promise<ArchiveState> {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as ArchiveState;
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

async function writeArchiveState(path: string | undefined, state: ArchiveState): Promise<void> {
    if (!path) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}
