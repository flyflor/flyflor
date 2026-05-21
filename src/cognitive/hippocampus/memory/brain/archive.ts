import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { brainSchema } from "../../../../entities/memory/index.ts";

export interface BrainArchiveMonthResult {
    archivePath: string;
    bucketMonth: string;
    endTs?: number;
    eventCount: number;
    sealedAt?: string;
    startTs?: number;
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
    vacuumed: boolean;
}

interface ArchiveState {
    lastVacuumAt?: number;
}

interface BrainShardDescriptor {
    archivePath?: string;
    endTs?: number;
    eventCount: number;
    id: string;
    monthKey?: string;
    sealedAt?: string;
    startTs?: number;
    status: "archived" | "live";
}

interface BrainCatalogLocatorRecord {
    entityId: string;
    entityType: BrainCatalogEntityType;
    shardId: string;
    ts?: number;
    updatedAt: string;
}

const BrainCatalogEntityType = {
    ContextFork: "context-fork",
    Event: "event",
    Continuation: "continuation",
    Scope: "scope",
    ReplayRecord: "replay-record",
    TaskPlan: "task-plan",
} as const;

type BrainCatalogEntityType = (typeof BrainCatalogEntityType)[keyof typeof BrainCatalogEntityType];

class BrainCatalogStore {
    private readonly db: Database;

    public constructor(private readonly dbPath: string) {
        mkdirSync(dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.install();
    }

    public close(): void {
        this.db.close();
    }

    public upsertShard(record: BrainShardDescriptor): void {
        this.db
            .prepare(
                `INSERT INTO brain_shards (
                    id, status, archive_path, start_ts, end_ts, event_count, sealed_at, month_key, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    archive_path = excluded.archive_path,
                    start_ts = excluded.start_ts,
                    end_ts = excluded.end_ts,
                    event_count = excluded.event_count,
                    sealed_at = excluded.sealed_at,
                    month_key = excluded.month_key,
                    updated_at = excluded.updated_at`,
            )
            .run(
                record.id,
                record.status,
                record.archivePath ?? null,
                record.startTs ?? null,
                record.endTs ?? null,
                record.eventCount,
                record.sealedAt ?? null,
                record.monthKey ?? null,
                new Date().toISOString(),
            );
    }

    public upsertLocator(record: BrainCatalogLocatorRecord): void {
        this.db
            .prepare(
                `INSERT INTO brain_entity_locator (
                    entity_type, entity_id, shard_id, ts, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                    shard_id = excluded.shard_id,
                    ts = excluded.ts,
                    updated_at = excluded.updated_at`,
            )
            .run(record.entityType, record.entityId, record.shardId, record.ts ?? null, record.updatedAt);
    }

    private install(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS brain_shards (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                archive_path TEXT,
                start_ts INTEGER,
                end_ts INTEGER,
                event_count INTEGER NOT NULL DEFAULT 0,
                sealed_at TEXT,
                month_key TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS brain_entity_locator (
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                shard_id TEXT NOT NULL,
                ts INTEGER,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (entity_type, entity_id)
            );
            CREATE INDEX IF NOT EXISTS idx_brain_locator_shard ON brain_entity_locator(shard_id, ts DESC);
        `);
    }
}

export function cutoffBucketMonth(months: number, nowMs = Date.now()): string {
    const safeMonths = Math.max(1, Math.floor(months));
    const now = new Date(nowMs);
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - safeMonths, 1));
    return formatMonthKey(date);
}

export async function runBrainArchive(input: BrainArchiveRunInput): Promise<BrainArchiveRunResult> {
    const nowMs = input.nowMs ?? Date.now();
    const archiveDir = join(dirname(input.brainPath), "brain", "archive");
    const cutoffMonth = cutoffBucketMonth(input.archiveAfterMonths, nowMs);
    const dryRun = input.dryRun === true;
    const currentMonth = formatMonthKey(new Date(nowMs));
    const liveMonth = existsSync(input.brainPath) ? detectLiveMonth(input.brainPath) : currentMonth;
    const shouldSeal = existsSync(input.brainPath) && liveMonth < currentMonth;

    if (dryRun) {
        const months = shouldSeal ? [describeLiveDb(input.brainPath, liveMonth)] : [];
        return {
            archiveDir,
            cutoffMonth,
            dryRun: true,
            eventsCopied: months.reduce((sum, item) => sum + item.eventCount, 0),
            months,
            vacuumed: false,
        };
    }

    if (!shouldSeal) {
        return {
            archiveDir,
            cutoffMonth,
            dryRun: false,
            eventsCopied: 0,
            months: [],
            vacuumed: false,
        };
    }

        await mkdir(archiveDir, { recursive: true });
        const catalog = new BrainCatalogStore(join(dirname(input.brainPath), "brain", "catalog", "brain.catalog.db"));
        try {
        const archivePath = join(archiveDir, `brain.${liveMonth}.db`);
        exportLiveDb(input.brainPath, archivePath);
        const descriptor = describeArchiveDb(archivePath, liveMonth);
        catalog.upsertShard(descriptor);
        importShardLocators(catalog, archivePath, liveMonth);
        replaceLiveDbWithFresh(input.brainPath, currentMonth);
        const vacuumed = descriptor.eventCount > 0 && (await shouldVacuum(input, nowMs));
        if (vacuumed) {
            const liveDb = new Database(input.brainPath);
            try {
                liveDb.exec("VACUUM;");
            } finally {
                liveDb.close();
            }
            await writeArchiveState(input.statePath, { lastVacuumAt: nowMs });
        }
        return {
            archiveDir,
            cutoffMonth,
            dryRun: false,
            eventsCopied: descriptor.eventCount,
            months: [fromDescriptor(descriptor)],
            vacuumed,
        };
    } finally {
        catalog.close();
    }
}

function checkpointLiveDb(brainPath: string): void {
    const db = new Database(brainPath);
    try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } finally {
        db.close();
    }
}

function exportLiveDb(brainPath: string, archivePath: string): void {
    if (existsSync(archivePath)) {
        unlinkSync(archivePath);
    }
    const db = new Database(brainPath);
    try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        db.prepare("VACUUM INTO ?1").run(archivePath);
    } finally {
        db.close();
    }
}

function createFreshLiveDb(brainPath: string, monthKey: string): void {
    const db = new Database(brainPath);
    try {
        db.exec("PRAGMA journal_mode = WAL;");
        brainSchema.install(db);
        db.prepare("INSERT OR REPLACE INTO brain_meta(key, value) VALUES (?1, ?2)").run("live_month_key", monthKey);
    } finally {
        db.close();
    }
}

function describeLiveDb(brainPath: string, monthKey: string): BrainArchiveMonthResult {
    const db = new Database(brainPath, { readonly: true });
    try {
        const row = db
            .query<{ count: number; minTs: number | null; maxTs: number | null }, []>(
                "SELECT COUNT(*) AS count, MIN(ts) AS minTs, MAX(ts) AS maxTs FROM memory_events",
            )
            .get() ?? { count: 0, minTs: null, maxTs: null };
        return {
            archivePath: join(dirname(brainPath), "brain", "archive", `brain.${monthKey}.db`),
            bucketMonth: monthKey,
            eventCount: row.count,
            startTs: row.minTs ?? undefined,
            endTs: row.maxTs ?? undefined,
        };
    } finally {
        db.close();
    }
}

function describeArchiveDb(archivePath: string, monthKey: string): BrainShardDescriptor {
    const db = new Database(archivePath, { readonly: true });
    try {
        const row = db
            .query<{ count: number; minTs: number | null; maxTs: number | null }, []>(
                "SELECT COUNT(*) AS count, MIN(ts) AS minTs, MAX(ts) AS maxTs FROM memory_events",
            )
            .get() ?? { count: 0, minTs: null, maxTs: null };
        return {
            id: monthKey,
            status: "archived",
            archivePath,
            eventCount: row.count,
            monthKey,
            startTs: row.minTs ?? undefined,
            endTs: row.maxTs ?? undefined,
            sealedAt: new Date().toISOString(),
        };
    } finally {
        db.close();
    }
}

function fromDescriptor(descriptor: BrainShardDescriptor): BrainArchiveMonthResult {
    if (!descriptor.archivePath) {
        throw new Error(`Archived shard ${descriptor.id} is missing archivePath.`);
    }
    return {
        archivePath: descriptor.archivePath,
        bucketMonth: descriptor.monthKey ?? descriptor.id,
        endTs: descriptor.endTs,
        eventCount: descriptor.eventCount,
        sealedAt: descriptor.sealedAt,
        startTs: descriptor.startTs,
    };
}

function detectLiveMonth(brainPath: string): string {
    const db = new Database(brainPath, { readonly: true });
    try {
        const stored = db
            .query<{ value: string | null }, [string]>("SELECT value FROM brain_meta WHERE key = ?1")
            .get("live_month_key")?.value;
        if (stored && stored.length > 0) {
            return stored;
        }
        const row = db
            .query<{ month: string | null }, []>("SELECT substr(MAX(time_bucket), 1, 7) AS month FROM memory_events")
            .get();
        return row?.month ?? formatMonthKey(new Date());
    } finally {
        db.close();
    }
}

function removeLiveFiles(brainPath: string): void {
    for (const path of [brainPath, `${brainPath}-wal`, `${brainPath}-shm`]) {
        if (existsSync(path)) {
            unlinkSync(path);
        }
    }
}

function replaceLiveDbWithFresh(brainPath: string, monthKey: string): void {
    removeLiveFiles(brainPath);
    createFreshLiveDb(brainPath, monthKey);
}

function importShardLocators(catalog: BrainCatalogStore, archivePath: string, shardId: string): void {
    const db = new Database(archivePath, { readonly: true });
    try {
        for (const row of db.query<{ id: string; ts: number; type: string }, []>("SELECT id, ts, type FROM memory_events").all()) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: row.type === "continuation-context" ? BrainCatalogEntityType.Continuation : BrainCatalogEntityType.Event,
                shardId,
                ts: row.ts,
                updatedAt: new Date(row.ts).toISOString(),
            });
        }
        for (const row of safeQuery<{ id: string; updated_at: string }>(db, "SELECT id, updated_at FROM context_forks")) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.ContextFork,
                shardId,
                updatedAt: row.updated_at,
            });
        }
        for (const row of safeQuery<{ id: string; updated_at: string }>(db, "SELECT id, updated_at FROM task_plans")) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.TaskPlan,
                shardId,
                updatedAt: row.updated_at,
            });
        }
        for (const row of safeReplayLocatorQuery(db)) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.ReplayRecord,
                shardId,
                updatedAt: row.updated_at,
            });
        }
        for (const row of safeQuery<{ id: string; updated_at: number }>(db, "SELECT id, updated_at FROM scopes")) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.Scope,
                shardId,
                updatedAt: new Date(row.updated_at).toISOString(),
            });
        }
    } finally {
        db.close();
    }
}

function safeQuery<T extends object>(db: Database, sql: string): T[] {
    try {
        return db.query<T, []>(sql).all();
    } catch {
        return [];
    }
}

function safeReplayLocatorQuery(db: Database): Array<{ id: string; updated_at: string }> {
    const replayRows = safeQuery<{ id: string; updated_at: string }>(db, "SELECT id, updated_at FROM replay_records");
    if (replayRows.length > 0) return replayRows;
    return safeQuery<{ id: string; updated_at: string }>(db, "SELECT id, updated_at FROM scene_records");
}

function formatMonthKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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
