import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { BrainComponent } from "../../../../components/component.ts";
import {
    brainPromptAtomModel,
    brainSchema,
    BrainCodenameRepo,
    BrainContextForkRepo,
    BrainEqStateRepo,
    BrainEventRepo,
    type BrainEventInput,
    type BrainEventListInput,
    BrainLinkRepo,
    BrainProjectRepo,
    BrainSceneRecordRepo,
    BrainStateRepo,
    type BrainStateMutation,
    BrainSummaryRepo,
    BrainTaskPlanRepo,
} from "../../../../entities/memory/index.ts";
import {
    type AtomScore,
    type MemoryAtom,
    type CodenameRecord,
    type EqState,
    type MemoryEventRecord,
    MemoryEventType,
    MemoryEventStatus,
    type MemoryLinkRecord,
    type MemoryLinkType,
    type MemoryStateRecord,
    type MemorySummaryRecord,
    type ProjectRecord,
    type ContextForkRecord,
    type SceneRecord,
    type TaskPlanRecord,
    type SummaryRange,
} from "../../../../protocol/contracts/index.ts";

export type { BrainEventInput, BrainEventListInput, BrainStateMutation } from "../../../../entities/memory/index.ts";

export interface BrainStoreOptions {
    dbPath: string;
}

export interface BrainPromptAtomWindowInput {
    days?: number;
    limit?: number;
    minScore: number;
    userId?: string;
}

export interface BrainVisibleAtom {
    atom: MemoryAtom;
    score: AtomScore;
    sourceEventId: string;
    sourceEventTs: number;
}

export interface BrainShardDescriptor {
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
    BlackboardTurn: "blackboard-turn",
    ContextFork: "context-fork",
    Event: "event",
    Ghost: "ghost",
    Project: "project",
    SceneRecord: "scene-record",
    TaskPlan: "task-plan",
} as const;

type BrainCatalogEntityType = (typeof BrainCatalogEntityType)[keyof typeof BrainCatalogEntityType];

const LIVE_SHARD_ID = "live";

export interface BrainPromptAtomWrite {
    atom: MemoryAtom;
    score: AtomScore;
}

interface BrainShardRepos {
    codenameRepo: BrainCodenameRepo;
    contextForkRepo: BrainContextForkRepo;
    db: Database;
    eqStateRepo: BrainEqStateRepo;
    eventRepo: BrainEventRepo;
    linkRepo: BrainLinkRepo;
    projectRepo: BrainProjectRepo;
    sceneRecordRepo: BrainSceneRecordRepo;
    stateRepo: BrainStateRepo;
    summaryRepo: BrainSummaryRepo;
    taskPlanRepo: BrainTaskPlanRepo;
}

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

    public listShards(): BrainShardDescriptor[] {
        return this.db
            .query<
                {
                    archive_path: string | null;
                    end_ts: number | null;
                    event_count: number;
                    id: string;
                    month_key: string | null;
                    sealed_at: string | null;
                    start_ts: number | null;
                    status: "archived" | "live";
                },
                []
            >(
                `SELECT id, status, archive_path, start_ts, end_ts, event_count, sealed_at, month_key
                   FROM brain_shards
                  ORDER BY CASE status WHEN 'live' THEN 1 ELSE 0 END DESC, id DESC`,
            )
            .all()
            .map((row) => ({
                id: row.id,
                status: row.status,
                archivePath: row.archive_path ?? undefined,
                startTs: row.start_ts ?? undefined,
                endTs: row.end_ts ?? undefined,
                eventCount: row.event_count,
                monthKey: row.month_key ?? undefined,
                sealedAt: row.sealed_at ?? undefined,
            }));
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

    public getShardId(entityType: BrainCatalogEntityType, entityId: string): string | null {
        const row = this.db
            .query<{ shard_id: string }, [BrainCatalogEntityType, string]>(
                `SELECT shard_id
                   FROM brain_entity_locator
                  WHERE entity_type = ?1 AND entity_id = ?2`,
            )
            .get(entityType, entityId);
        return row?.shard_id ?? null;
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

@Component()
export class BrainStore extends BrainComponent {
    private readonly archiveShards = new Map<string, BrainShardRepos>();
    private readonly archiveDir: string;
    private readonly brainDir: string;
    private readonly catalogPath: string;
    private catalog: BrainCatalogStore | null = null;
    private currentLiveMonth = utcMonthKey(Date.now());
    private live: BrainShardRepos | null = null;
    private opened = false;

    public constructor(private readonly options: BrainStoreOptions) {
        super();
        this.brainDir = join(dirname(this.options.dbPath), "brain");
        this.archiveDir = join(this.brainDir, "archive");
        this.catalogPath = join(this.brainDir, "catalog", "brain.catalog.db");
    }

    public async open(): Promise<void> {
        if (this.opened) return;
        await mkdir(dirname(this.options.dbPath), { recursive: true });
        await mkdir(this.brainDir, { recursive: true });
        await mkdir(this.archiveDir, { recursive: true });
        this.catalog = new BrainCatalogStore(this.catalogPath);
        this.rotateLiveShardIfNeeded();
        this.live = this.openShard(this.options.dbPath);
        this.currentLiveMonth = ensureLiveShardMonth(this.live.db);
        this.opened = true;
        this.catalog.upsertShard(this.describeLiveShard());
    }

    public close(): void {
        if (!this.opened) return;
        this.live?.db.close();
        this.live = null;
        for (const shard of this.archiveShards.values()) {
            shard.db.close();
        }
        this.archiveShards.clear();
        this.catalog?.close();
        this.catalog = null;
        this.opened = false;
    }

    public appendEvent(input: BrainEventInput): MemoryEventRecord {
        this.rotateLiveShardForTs(input.ts);
        const written = this.requireLive().eventRepo.append(input);
        this.catalog?.upsertLocator({
            entityId: written.id,
            entityType: written.type === MemoryEventType.GhostContext ? BrainCatalogEntityType.Ghost : BrainCatalogEntityType.Event,
            shardId: LIVE_SHARD_ID,
            ts: written.ts,
            updatedAt: new Date(written.ts).toISOString(),
        });
        this.catalog?.upsertShard(this.describeLiveShard());
        return written;
    }

    public getEvent(id: string): MemoryEventRecord | null {
        const shard = this.openLocatedShard(BrainCatalogEntityType.Event, id) ?? this.openLocatedShard(BrainCatalogEntityType.Ghost, id);
        if (shard) {
            return shard.eventRepo.get(id);
        }
        for (const repos of this.iterReadableShards()) {
            const row = repos.eventRepo.get(id);
            if (row) return row;
        }
        return null;
    }

    public listEvents(input: BrainEventListInput = {}): MemoryEventRecord[] {
        const rows: MemoryEventRecord[] = [];
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        for (const repos of this.iterReadableShards()) {
            for (const row of repos.eventRepo.list({ ...input, limit })) {
                rows.push(row);
            }
            if (rows.length >= limit * 3) {
                break;
            }
        }
        rows.sort((left, right) => right.ts - left.ts);
        return rows.slice(0, limit);
    }

    public listPromptAtomsWindow(date: Date | string, input: BrainPromptAtomWindowInput): BrainVisibleAtom[] {
        const days = Math.max(1, Math.min(31, Math.floor(input.days ?? 7)));
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const sinceTs = brainPromptAtomModel.normalizeTimestamp(date) - days * 86_400_000;
        const visible: BrainVisibleAtom[] = [];
        for (const event of this.listEvents({
            ...(input.userId ? { userId: input.userId } : {}),
            type: MemoryEventType.Event,
            sinceTs,
            limit: limit * 4,
            statusIn: [MemoryEventStatus.Live, MemoryEventStatus.Resumed],
        })) {
            for (const entry of brainPromptAtomModel.entriesFromEvent(event)) {
                if (entry.score.total < input.minScore) continue;
                visible.push(entry);
            }
        }
        visible.sort((a, b) => {
            const byScore = b.score.total - a.score.total;
            if (byScore !== 0) return byScore;
            const byTime = b.sourceEventTs - a.sourceEventTs;
            if (byTime !== 0) return byTime;
            return b.atom.createdAt.localeCompare(a.atom.createdAt);
        });
        return visible.slice(0, limit);
    }

    public getState(eventId: string): MemoryStateRecord | null {
        const shard = this.shardForEvent(eventId);
        return shard?.stateRepo.get(eventId) ?? null;
    }

    public upsertState(eventId: string, mutation: BrainStateMutation): MemoryStateRecord {
        this.rotateLiveShardForTs(Date.now());
        return this.requireLive().stateRepo.upsert(eventId, mutation);
    }

    public writeSummary(record: MemorySummaryRecord): void {
        this.rotateLiveShardForTs(record.createdAt);
        this.requireLive().summaryRepo.write(record);
    }

    public getSummary(id: string): MemorySummaryRecord | null {
        for (const repos of this.iterReadableShards()) {
            const row = repos.summaryRepo.get(id);
            if (row) return row;
        }
        return null;
    }

    public listSummaries(input: { timeRange?: SummaryRange; limit?: number } = {}): MemorySummaryRecord[] {
        const rows: MemorySummaryRecord[] = [];
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        for (const repos of this.iterReadableShards()) {
            rows.push(...repos.summaryRepo.list(input));
            if (rows.length >= limit * 2) break;
        }
        rows.sort((left, right) => right.createdAt - left.createdAt);
        return rows.slice(0, limit);
    }

    public writeTaskPlan(record: TaskPlanRecord): TaskPlanRecord {
        this.rotateLiveShardForTs(Date.parse(record.updatedAt));
        const written = this.requireLive().taskPlanRepo.write(record);
        this.catalog?.upsertLocator({
            entityId: written.id,
            entityType: BrainCatalogEntityType.TaskPlan,
            shardId: LIVE_SHARD_ID,
            updatedAt: written.updatedAt,
        });
        return written;
    }

    public listTaskPlans(input: {
        userId?: string;
        sourceEventId?: string;
        sourceBlackboardTurnId?: string;
        limit?: number;
    } = {}): TaskPlanRecord[] {
        return this.mergeAcrossShards((repos) => repos.taskPlanRepo.list(input), input.limit ?? 100, (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
        );
    }

    public writeContextFork(record: ContextForkRecord): ContextForkRecord {
        this.rotateLiveShardForTs(Date.parse(record.updatedAt));
        const written = this.requireLive().contextForkRepo.write(record);
        this.catalog?.upsertLocator({
            entityId: written.id,
            entityType: BrainCatalogEntityType.ContextFork,
            shardId: LIVE_SHARD_ID,
            updatedAt: written.updatedAt,
        });
        return written;
    }

    public getContextFork(id: string): ContextForkRecord | null {
        const shard = this.openLocatedShard(BrainCatalogEntityType.ContextFork, id);
        if (shard) {
            return shard.contextForkRepo.get(id);
        }
        for (const repos of this.iterReadableShards()) {
            const row = repos.contextForkRepo.get(id);
            if (row) return row;
        }
        return null;
    }

    public listContextForks(input: {
        userId?: string;
        sourceEventId?: string;
        sourceBlackboardTurnId?: string;
        limit?: number;
    } = {}): ContextForkRecord[] {
        return this.mergeAcrossShards((repos) => repos.contextForkRepo.list(input), input.limit ?? 100, (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
        );
    }

    public writeSceneRecord(record: SceneRecord): SceneRecord {
        this.rotateLiveShardForTs(Date.parse(record.updatedAt));
        const written = this.requireLive().sceneRecordRepo.write(record);
        this.catalog?.upsertLocator({
            entityId: written.id,
            entityType: BrainCatalogEntityType.SceneRecord,
            shardId: LIVE_SHARD_ID,
            updatedAt: written.updatedAt,
        });
        return written;
    }

    public listSceneRecords(input: {
        userId?: string;
        sourceEventId?: string;
        blackboardTurnId?: string;
        limit?: number;
    } = {}): SceneRecord[] {
        return this.mergeAcrossShards((repos) => repos.sceneRecordRepo.list(input), input.limit ?? 100, (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
        );
    }

    public writeLink(record: MemoryLinkRecord): void {
        this.rotateLiveShardForTs(record.createdAt);
        this.requireLive().linkRepo.write(record);
    }

    public listLinks(input: { fromId?: string; toId?: string; type?: MemoryLinkType; limit?: number } = {}): MemoryLinkRecord[] {
        return this.mergeAcrossShards((repos) => repos.linkRepo.list(input), input.limit ?? 100, (left, right) =>
            right.createdAt - left.createdAt,
        );
    }

    public upsertCodename(record: CodenameRecord): CodenameRecord {
        this.rotateLiveShardForTs(record.lastUsedAt);
        return this.requireLive().codenameRepo.upsert(record);
    }

    public touchCodename(id: string, ts: number): void {
        this.rotateLiveShardForTs(ts);
        this.requireLive().codenameRepo.touch(id, ts);
    }

    public bindCodenameProject(id: string, projectId: string): void {
        this.rotateLiveShardForTs(Date.now());
        this.requireLive().codenameRepo.bindProject(id, projectId);
    }

    public getCodename(id: string): CodenameRecord | null {
        for (const repos of this.iterReadableShards()) {
            const row = repos.codenameRepo.get(id);
            if (row) return row;
        }
        return null;
    }

    public listCodenames(input: { userId?: string; limit?: number } = {}): CodenameRecord[] {
        return this.mergeAcrossShards((repos) => repos.codenameRepo.list(input), input.limit ?? 100, (left, right) =>
            right.lastUsedAt - left.lastUsedAt,
        );
    }

    public getCodenameByName(userId: string, name: string): CodenameRecord | null {
        for (const repos of this.iterReadableShards()) {
            const row = repos.codenameRepo.getByName(userId, name);
            if (row) return row;
        }
        return null;
    }

    public upsertProject(record: ProjectRecord): ProjectRecord {
        this.rotateLiveShardForTs(record.updatedAt);
        const written = this.requireLive().projectRepo.upsert(record);
        this.catalog?.upsertLocator({
            entityId: written.id,
            entityType: BrainCatalogEntityType.Project,
            shardId: LIVE_SHARD_ID,
            updatedAt: new Date(written.updatedAt).toISOString(),
        });
        return written;
    }

    public getProject(id: string): ProjectRecord | null {
        const shard = this.openLocatedShard(BrainCatalogEntityType.Project, id);
        if (shard) return shard.projectRepo.get(id);
        for (const repos of this.iterReadableShards()) {
            const row = repos.projectRepo.get(id);
            if (row) return row;
        }
        return null;
    }

    public listProjects(input: { userId?: string; limit?: number } = {}): ProjectRecord[] {
        return this.mergeAcrossShards((repos) => repos.projectRepo.list(input), input.limit ?? 100, (left, right) =>
            right.lastUsedAt - left.lastUsedAt,
        );
    }

    public getMostRecentTouchedCodename(userId: string, sinceTs: number): CodenameRecord | null {
        const rows = this.listCodenames({ userId, limit: 100 }).filter((row) => row.lastUsedAt >= sinceTs && !row.projectId);
        rows.sort((left, right) => right.lastUsedAt - left.lastUsedAt);
        return rows[0] ?? null;
    }

    public upsertEqState(state: EqState): void {
        this.rotateLiveShardForTs(state.updatedAt);
        this.requireLive().eqStateRepo.upsert(state);
    }

    public getEqState(userId: string): EqState | null {
        for (const repos of this.iterReadableShards()) {
            const row = repos.eqStateRepo.get(userId);
            if (row) return row;
        }
        return null;
    }

    public getLatestPendingAsk(_userId: string): MemoryEventRecord | null {
        const asks = this.listEvents({
            type: MemoryEventType.Ask,
            limit: 64,
            statusIn: [MemoryEventStatus.Live, MemoryEventStatus.Resumed],
        }).filter((row) => !this.hasAskBeenAnswered(row.id));
        asks.sort((left, right) => right.ts - left.ts);
        return asks[0] ?? null;
    }

    public countAskChainDepth(askEventId: string): number {
        let depth = 1;
        let cursor = this.getEvent(askEventId);
        for (let index = 0; index < 32 && cursor?.parentId; index += 1) {
            const parent = this.getEvent(cursor.parentId);
            if (!parent || parent.type !== MemoryEventType.Ask) break;
            depth += 1;
            cursor = parent;
        }
        return depth;
    }

    public listActiveGhosts(_userId: string, options: { codenameId?: string | null; limit?: number } = {}): MemoryEventRecord[] {
        const rows = this.listEvents({
            ...(options.codenameId !== undefined ? { codenameId: options.codenameId ?? undefined } : {}),
            type: MemoryEventType.GhostContext,
            statusIn: [MemoryEventStatus.Live, MemoryEventStatus.Resumed],
            limit: options.limit ?? 50,
        });
        return rows.filter((row) => {
            if (options.codenameId === null) return row.codenameId == null;
            if (typeof options.codenameId === "string") return row.codenameId === options.codenameId;
            return true;
        });
    }

    public patchGhostContent(eventId: string, patch: Record<string, unknown>): MemoryEventRecord | null {
        this.rotateLiveShardForTs(Date.now());
        return this.requireLive().eventRepo.patchGhostContent(eventId, patch);
    }

    public updateEventContent(eventId: string, nextContent: Record<string, unknown>): MemoryEventRecord | null {
        this.rotateLiveShardForTs(Date.now());
        return this.requireLive().eventRepo.updateContent(eventId, nextContent);
    }

    public hasAskBeenAnswered(askEventId: string): boolean {
        for (const repos of this.iterReadableShards()) {
            if (repos.eventRepo.hasAskBeenAnswered(askEventId)) return true;
        }
        return false;
    }

    public listActiveIdentity(_userId: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        return this.listEvents({
            type: MemoryEventType.IdentityAppend,
            statusIn: [MemoryEventStatus.Live],
            limit: options.limit ?? 32,
        });
    }

    public listAllIdentity(_userId: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        return this.listEvents({
            type: MemoryEventType.IdentityAppend,
            limit: options.limit ?? 64,
        });
    }

    public listShards(): BrainShardDescriptor[] {
        return this.catalog?.listShards() ?? [];
    }

    public sealLiveShardIfStale(nowMs = Date.now()): BrainShardDescriptor | null {
        if (!this.opened || !this.live) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        const currentMonth = utcMonthKey(nowMs);
        if (this.currentLiveMonth === currentMonth) {
            this.catalog?.upsertShard(this.describeLiveShard());
            return null;
        }
        return this.sealCurrentLiveShard();
    }

    private describeLiveShard(): BrainShardDescriptor {
        const db = this.requireLive().db;
        const row = db
            .query<{ minTs: number | null; maxTs: number | null; count: number }, []>(
                "SELECT MIN(ts) AS minTs, MAX(ts) AS maxTs, COUNT(*) AS count FROM memory_events",
            )
            .get() ?? { minTs: null, maxTs: null, count: 0 };
        return {
            id: LIVE_SHARD_ID,
            status: "live",
            eventCount: row.count,
            monthKey: this.currentLiveMonth,
            startTs: row.minTs ?? undefined,
            endTs: row.maxTs ?? undefined,
        };
    }

    private mergeAcrossShards<T>(reader: (repos: BrainShardRepos) => T[], limit: number, sorter: (left: T, right: T) => number): T[] {
        const rows: T[] = [];
        for (const repos of this.iterReadableShards()) {
            rows.push(...reader(repos));
            if (rows.length >= limit * 3) break;
        }
        rows.sort(sorter);
        return rows.slice(0, Math.max(1, Math.min(500, Math.floor(limit))));
    }

    private shardForEvent(eventId: string): BrainShardRepos | null {
        const located = this.openLocatedShard(BrainCatalogEntityType.Event, eventId) ?? this.openLocatedShard(BrainCatalogEntityType.Ghost, eventId);
        if (located) return located;
        for (const repos of this.iterReadableShards()) {
            if (repos.eventRepo.get(eventId)) return repos;
        }
        return null;
    }

    private iterReadableShards(): BrainShardRepos[] {
        const shards: BrainShardRepos[] = [];
        if (this.live) shards.push(this.live);
        for (const shard of this.catalog?.listShards() ?? []) {
            if (shard.status !== "archived" || !shard.archivePath) continue;
            shards.push(this.getArchiveShard(shard.id, shard.archivePath));
        }
        return shards;
    }

    private openLocatedShard(entityType: BrainCatalogEntityType, entityId: string): BrainShardRepos | null {
        const shardId = this.catalog?.getShardId(entityType, entityId);
        if (!shardId) return null;
        if (shardId === LIVE_SHARD_ID) return this.live;
        const descriptor = this.catalog?.listShards().find((item) => item.id === shardId);
        if (!descriptor?.archivePath) return null;
        return this.getArchiveShard(descriptor.id, descriptor.archivePath);
    }

    private requireLive(): BrainShardRepos {
        if (!this.live || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.live;
    }

    private openShard(path: string, readonly = false): BrainShardRepos {
        const db = new Database(path, readonly ? { readonly: true } : undefined);
        if (!readonly) {
            db.exec("PRAGMA journal_mode = WAL");
            db.exec("PRAGMA synchronous = NORMAL");
            db.exec("PRAGMA foreign_keys = ON");
            brainSchema.install(db);
        }
        return {
            db,
            codenameRepo: new BrainCodenameRepo(db),
            contextForkRepo: new BrainContextForkRepo(db),
            eqStateRepo: new BrainEqStateRepo(db),
            eventRepo: new BrainEventRepo(db),
            linkRepo: new BrainLinkRepo(db),
            projectRepo: new BrainProjectRepo(db),
            sceneRecordRepo: new BrainSceneRecordRepo(db),
            stateRepo: new BrainStateRepo(db),
            summaryRepo: new BrainSummaryRepo(db),
            taskPlanRepo: new BrainTaskPlanRepo(db),
        };
    }

    private getArchiveShard(shardId: string, path: string): BrainShardRepos {
        const existing = this.archiveShards.get(shardId);
        if (existing) return existing;
        const opened = this.openShard(path, true);
        this.archiveShards.set(shardId, opened);
        return opened;
    }

    private rotateLiveShardIfNeeded(): void {
        const currentMonth = utcMonthKey(Date.now());
        const liveShardMonth = existsSync(this.options.dbPath) ? detectLiveShardMonth(this.options.dbPath) : currentMonth;
        if (!existsSync(this.options.dbPath) || liveShardMonth === currentMonth) return;
        this.archiveDetachedLiveShard(liveShardMonth);
    }

    private rotateLiveShardForTs(ts: number): void {
        if (!this.live) return;
        const currentMonth = utcMonthKey(Date.now());
        if (this.currentLiveMonth !== currentMonth) {
            this.sealCurrentLiveShard();
        }
        if (utcMonthKey(ts) !== this.currentLiveMonth) {
            this.catalog?.upsertShard(this.describeLiveShard());
        }
    }

    private sealCurrentLiveShard(): BrainShardDescriptor | null {
        if (!this.live) return null;
        const monthKey = this.currentLiveMonth;
        const descriptor = this.archiveAttachedLiveShard(monthKey);
        this.live = this.openShard(this.options.dbPath);
        this.currentLiveMonth = ensureLiveShardMonth(this.live.db);
        this.catalog?.upsertShard(this.describeLiveShard());
        return descriptor;
    }

    private archiveDetachedLiveShard(monthKey: string): BrainShardDescriptor {
        const archivePath = join(this.archiveDir, `brain.${monthKey}.db`);
        mkdirSync(dirname(archivePath), { recursive: true });
        if (existsSync(archivePath)) {
            copyFileSync(this.options.dbPath, archivePath);
        } else {
            renameSync(this.options.dbPath, archivePath);
        }
        const descriptor = describeArchiveShard(archivePath, monthKey);
        this.catalog?.upsertShard(descriptor);
        if (this.catalog) {
            importShardLocators(this.catalog, archivePath, monthKey);
        }
        return descriptor;
    }

    private archiveAttachedLiveShard(monthKey: string): BrainShardDescriptor | null {
        const liveEventCount = this.describeLiveShard().eventCount;
        this.live?.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        this.live?.db.close();
        this.live = null;
        if (liveEventCount === 0) {
            if (existsSync(this.options.dbPath)) {
                unlinkSync(this.options.dbPath);
            }
            return null;
        }
        return this.archiveDetachedLiveShard(monthKey);
    }
}

function utcMonthKey(nowMs: number): string {
    const now = new Date(nowMs);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function detectLiveShardMonth(path: string): string {
    const db = new Database(path, { readonly: true });
    try {
        try {
            const stored = db
                .query<{ value: string | null }, [string]>("SELECT value FROM brain_meta WHERE key = ?1")
                .get("live_month_key")?.value;
            if (stored && stored.length > 0) {
                return stored;
            }
        } catch {
            // Pre-meta live brains are still valid; fall back to the latest event month.
        }
        const row = db
            .query<{ month: string | null }, []>("SELECT substr(MAX(time_bucket), 1, 7) AS month FROM memory_events")
            .get();
        return row?.month ?? utcMonthKey(Date.now());
    } finally {
        db.close();
    }
}

function ensureLiveShardMonth(db: Database): string {
    brainSchema.install(db);
    const stored = db.query<{ value: string | null }, [string]>("SELECT value FROM brain_meta WHERE key = ?1").get("live_month_key")
        ?.value;
    if (stored && stored.length > 0) {
        return stored;
    }
    const month = utcMonthKey(Date.now());
    db.prepare("INSERT OR REPLACE INTO brain_meta(key, value) VALUES (?1, ?2)").run("live_month_key", month);
    return month;
}

function describeArchiveShard(path: string, monthKey: string): BrainShardDescriptor {
    return {
        id: monthKey,
        status: "archived",
        archivePath: path,
        eventCount: countEvents(path),
        monthKey,
        startTs: detectShardMinTs(path) ?? undefined,
        endTs: detectShardMaxTs(path) ?? undefined,
        sealedAt: new Date().toISOString(),
    };
}

function countEvents(path: string): number {
    const db = new Database(path, { readonly: true });
    try {
        const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM memory_events").get();
        return row?.count ?? 0;
    } finally {
        db.close();
    }
}

function detectShardMinTs(path: string): number | null {
    const db = new Database(path, { readonly: true });
    try {
        const row = db.query<{ ts: number | null }, []>("SELECT MIN(ts) AS ts FROM memory_events").get();
        return row?.ts ?? null;
    } finally {
        db.close();
    }
}

function detectShardMaxTs(path: string): number | null {
    const db = new Database(path, { readonly: true });
    try {
        const row = db.query<{ ts: number | null }, []>("SELECT MAX(ts) AS ts FROM memory_events").get();
        return row?.ts ?? null;
    } finally {
        db.close();
    }
}

function importShardLocators(catalog: BrainCatalogStore, archivePath: string, shardId: string): void {
    const db = new Database(archivePath, { readonly: true });
    try {
        const events = db
            .query<{ id: string; ts: number; type: string }, []>("SELECT id, ts, type FROM memory_events")
            .all();
        for (const row of events) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: row.type === MemoryEventType.GhostContext ? BrainCatalogEntityType.Ghost : BrainCatalogEntityType.Event,
                shardId,
                ts: row.ts,
                updatedAt: new Date(row.ts).toISOString(),
            });
        }

        for (const row of db.query<{ id: string; updated_at: string }, []>("SELECT id, updated_at FROM context_forks").all()) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.ContextFork,
                shardId,
                updatedAt: row.updated_at,
            });
        }
        for (const row of db.query<{ id: string; updated_at: string }, []>("SELECT id, updated_at FROM task_plans").all()) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.TaskPlan,
                shardId,
                updatedAt: row.updated_at,
            });
        }
        for (const row of db.query<{ id: string; updated_at: string }, []>("SELECT id, updated_at FROM scene_records").all()) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.SceneRecord,
                shardId,
                updatedAt: row.updated_at,
            });
        }
        for (const row of db.query<{ id: string; updated_at: number }, []>("SELECT id, updated_at FROM projects").all()) {
            catalog.upsertLocator({
                entityId: row.id,
                entityType: BrainCatalogEntityType.Project,
                shardId,
                updatedAt: new Date(row.updated_at).toISOString(),
            });
        }
    } finally {
        db.close();
    }
}
