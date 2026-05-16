import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../../agent/di/decorators/index.ts";
import { BrainComponent } from "../base.component.ts";
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
} from "../../protocol/contracts/index.ts";
import { BrainCodenameRepo } from "./brain.codename.repo.ts";
import {
    BrainEventRepo,
    type BrainEventInput,
    type BrainEventListInput,
} from "./brain.event.repo.ts";
import { BrainContextForkRepo } from "./brain.context.fork.repo.ts";
import { BrainEqStateRepo } from "./brain.eq.state.repo.ts";
import { BrainLinkRepo } from "./brain.link.repo.ts";
import { BrainProjectRepo } from "./brain.project.repo.ts";
import { BrainSceneRecordRepo } from "./brain.scene.record.repo.ts";
import { BrainStateRepo, type BrainStateMutation } from "./brain.state.repo.ts";
import { BrainSummaryRepo } from "./brain.summary.repo.ts";
import { BrainTaskPlanRepo } from "./brain.task.plan.repo.ts";

export type { BrainEventInput, BrainEventListInput } from "./brain.event.repo.ts";
export type { BrainStateMutation } from "./brain.state.repo.ts";

/**
 * LF-R1 brain.db single-file store.
 *
 * Boundary contract:
 * - `memory_events` is append-only. Any "update" is a new row + a `memory_state` redirect.
 * - `memory_state` is the only mutable layer Dream / sweeper may touch.
 * - Dream is forbidden from `DELETE FROM memory_events` (R7).
 * - Visibility gating (AtomScore) is the caller's responsibility; this store does no scoring.
 *
 * Read / write surface is intentionally narrow: callers consume protocol records,
 * never raw SQLite rows.
 */

export interface BrainStoreOptions {
    dbPath: string;
}

export interface BrainPromptAtomWindowInput {
    days?: number;
    limit?: number;
    minScore: number;
    /** Runtime prompt recall supplies this; diagnostics may omit it to inspect all inbox buckets. */
    userId?: string;
}

export interface BrainVisibleAtom {
    atom: MemoryAtom;
    score: AtomScore;
    sourceEventId: string;
    sourceEventTs: number;
}

/**
 * Shape persisted under `memory_events.content.atoms`.
 * The store owns windowing and visibility; callers own scoring before append.
 */
export interface BrainPromptAtomWrite {
    atom: MemoryAtom;
    score: AtomScore;
}

@Component()
export class BrainStore extends BrainComponent {
    private codenameRepo: BrainCodenameRepo | null = null;
    private db: Database | null = null;
    private eventRepo: BrainEventRepo | null = null;
    private contextForkRepo: BrainContextForkRepo | null = null;
    private eqStateRepo: BrainEqStateRepo | null = null;
    private linkRepo: BrainLinkRepo | null = null;
    private opened = false;
    private projectRepo: BrainProjectRepo | null = null;
    private sceneRecordRepo: BrainSceneRecordRepo | null = null;
    private stateRepo: BrainStateRepo | null = null;
    private summaryRepo: BrainSummaryRepo | null = null;
    private taskPlanRepo: BrainTaskPlanRepo | null = null;

    public constructor(private readonly options: BrainStoreOptions) {
        super();
    }

    public async open(): Promise<void> {
        if (this.opened) return;
        await mkdir(dirname(this.options.dbPath), { recursive: true });
        const db = new Database(this.options.dbPath);
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA synchronous = NORMAL");
        db.exec("PRAGMA foreign_keys = ON");
        createSchema(db);
        this.db = db;
        this.codenameRepo = new BrainCodenameRepo(db);
        this.eventRepo = new BrainEventRepo(db);
        this.contextForkRepo = new BrainContextForkRepo(db);
        this.eqStateRepo = new BrainEqStateRepo(db);
        this.linkRepo = new BrainLinkRepo(db);
        this.projectRepo = new BrainProjectRepo(db);
        this.sceneRecordRepo = new BrainSceneRecordRepo(db);
        this.stateRepo = new BrainStateRepo(db);
        this.summaryRepo = new BrainSummaryRepo(db);
        this.taskPlanRepo = new BrainTaskPlanRepo(db);
        this.opened = true;
    }

    public close(): void {
        if (!this.opened) return;
        this.db?.close();
        this.codenameRepo = null;
        this.db = null;
        this.eventRepo = null;
        this.contextForkRepo = null;
        this.eqStateRepo = null;
        this.linkRepo = null;
        this.opened = false;
        this.projectRepo = null;
        this.sceneRecordRepo = null;
        this.stateRepo = null;
        this.summaryRepo = null;
        this.taskPlanRepo = null;
    }

    public appendEvent(input: BrainEventInput): MemoryEventRecord {
        return this.requireEventRepo().append(input);
    }

    public getEvent(id: string): MemoryEventRecord | null {
        return this.requireEventRepo().get(id);
    }

    public listEvents(input: BrainEventListInput = {}): MemoryEventRecord[] {
        return this.requireEventRepo().list(input);
    }

    /**
     * prompt recall 的 brain 权威窗口：从 `memory_events` 展开结构化 `content.atoms`。
     * 不做字符匹配，只按时间窗、状态层与 JSON shape 过滤。
     */
    public listPromptAtomsWindow(date: Date | string, input: BrainPromptAtomWindowInput): BrainVisibleAtom[] {
        const days = Math.max(1, Math.min(31, Math.floor(input.days ?? 7)));
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const sinceTs = normalizeTimestamp(date) - days * 86_400_000;
        const events = this.listEvents({
            ...(input.userId ? { userId: input.userId } : {}),
            type: MemoryEventType.Event,
            sinceTs,
            limit,
            statusIn: [MemoryEventStatus.Live, MemoryEventStatus.Resumed],
        });
        const visible: BrainVisibleAtom[] = [];
        for (const event of events) {
            const atoms = readPromptAtomEntries(event);
            for (const entry of atoms) {
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
        return this.requireStateRepo().get(eventId);
    }

    public upsertState(eventId: string, mutation: BrainStateMutation): MemoryStateRecord {
        return this.requireStateRepo().upsert(eventId, mutation);
    }

    public writeSummary(record: MemorySummaryRecord): void {
        this.requireSummaryRepo().write(record);
    }

    public getSummary(id: string): MemorySummaryRecord | null {
        return this.requireSummaryRepo().get(id);
    }

    public listSummaries(input: { timeRange?: SummaryRange; limit?: number } = {}): MemorySummaryRecord[] {
        return this.requireSummaryRepo().list(input);
    }

    /**
     * Runtime planning metadata lives in brain.db but outside `memory_events`.
     * These tables are summary-first views for TUI/history; they never store raw chain-of-thought.
     */
    public writeTaskPlan(record: TaskPlanRecord): TaskPlanRecord {
        return this.requireTaskPlanRepo().write(record);
    }

    public listTaskPlans(input: {
        userId?: string;
        sourceEventId?: string;
        sourceBlackboardTurnId?: string;
        limit?: number;
    } = {}): TaskPlanRecord[] {
        return this.requireTaskPlanRepo().list(input);
    }

    public writeContextFork(record: ContextForkRecord): ContextForkRecord {
        return this.requireContextForkRepo().write(record);
    }

    public getContextFork(id: string): ContextForkRecord | null {
        return this.requireContextForkRepo().get(id);
    }

    public listContextForks(input: {
        userId?: string;
        sourceEventId?: string;
        sourceBlackboardTurnId?: string;
        limit?: number;
    } = {}): ContextForkRecord[] {
        return this.requireContextForkRepo().list(input);
    }

    public writeSceneRecord(record: SceneRecord): SceneRecord {
        return this.requireSceneRecordRepo().write(record);
    }

    public listSceneRecords(input: {
        userId?: string;
        sourceEventId?: string;
        blackboardTurnId?: string;
        limit?: number;
    } = {}): SceneRecord[] {
        return this.requireSceneRecordRepo().list(input);
    }

    public writeLink(record: MemoryLinkRecord): void {
        this.requireLinkRepo().write(record);
    }

    public listLinks(input: { fromId?: string; toId?: string; type?: MemoryLinkType; limit?: number } = {}): MemoryLinkRecord[] {
        return this.requireLinkRepo().list(input);
    }

    public upsertCodename(record: CodenameRecord): CodenameRecord {
        return this.requireCodenameRepo().upsert(record);
    }

    public touchCodename(id: string, ts: number): void {
        this.requireCodenameRepo().touch(id, ts);
    }

    public bindCodenameProject(id: string, projectId: string): void {
        this.requireCodenameRepo().bindProject(id, projectId);
    }

    public getCodename(id: string): CodenameRecord | null {
        return this.requireCodenameRepo().get(id);
    }

    public listCodenames(input: { userId?: string; limit?: number } = {}): CodenameRecord[] {
        return this.requireCodenameRepo().list(input);
    }

    public getCodenameByName(userId: string, name: string): CodenameRecord | null {
        return this.requireCodenameRepo().getByName(userId, name);
    }

    /**
     * Project registry for explicit `/project` scope selection.
     * This table stores only structured paths and counters; runtime context must
     * still pass the active project every turn, so it does not become a session.
     */
    public upsertProject(record: ProjectRecord): ProjectRecord {
        return this.requireProjectRepo().upsert(record);
    }

    public getProject(id: string): ProjectRecord | null {
        return this.requireProjectRepo().get(id);
    }

    public listProjects(input: { userId?: string; limit?: number } = {}): ProjectRecord[] {
        return this.requireProjectRepo().list(input);
    }

    /**
     * P2 inbox 收口：取用户最近被 touch 过且仍未升格（projectId IS NULL）的 codename，
     * 用于召回侧偏变（让 inbox 召回向"用户当前正在用的那个 codename"倾斜）。
     * 零字符匹配——只看 last_used_at >= sinceTs 资源指标 + project_id IS NULL 结构化字段。
     */
    public getMostRecentTouchedCodename(userId: string, sinceTs: number): CodenameRecord | null {
        return this.requireCodenameRepo().getMostRecentTouched(userId, sinceTs);
    }

    /**
     * EQ-01 slice A：写入 / 覆盖某用户最新情绪状态（latest-only UPSERT）。
     * append-only 历史轨迹由 `memory_events` 中模型同轮记录的对话事件携带，
     * 此处只保留"现在的样子"以便快速取读 + 衰减。
     */
    public upsertEqState(state: EqState): void {
        this.requireEqStateRepo().upsert(state);
    }

    /** 取某用户最新 EQ 状态。无记录返回 null。 */
    public getEqState(userId: string): EqState | null {
        return this.requireEqStateRepo().get(userId);
    }

    /**
     * LF-R3：取该用户最近一次未答复的 ask 事件。"未答复"= 既不是 Abandoned/Archived，
     * 也没有任何 ask-answer-pair 子事件（parent_id 指向它）。
     */
    public getLatestPendingAsk(userId: string): MemoryEventRecord | null {
        return this.requireEventRepo().getLatestPendingAsk(userId);
    }

    /**
     * LF-R3：链深度 = 从 pending ask 沿 parent_id 反向追溯，前序 ask 事件个数 + 1。
     * 用于 `memory.tuning.ghost.maxChainDepth` 强制 reply 阈值检查。
     */
    public countAskChainDepth(askEventId: string): number {
        return this.requireEventRepo().countAskChainDepth(askEventId);
    }

    /**
     * LF-R4：列出当前用户的 ghost-context 事件，按 ts 倒序。
     * "active" = status ∈ {live, resumed}（drop = abandoned；archive = archived；不展示）。
     * codenameId 可选，传入则只看该工作目录下的 ghost。
     */
    public listActiveGhosts(
        userId: string,
        options: { codenameId?: string | null; limit?: number } = {},
    ): MemoryEventRecord[] {
        return this.requireEventRepo().listActiveGhosts(userId, options);
    }

    /**
     * LF-R4 fork/fresh hint：合并 patch 到 ghost-context content，并保留其它字段。
     * 仅对 `type='ghost-context'` 生效；其他类型直接抛错避免误用。
     */
    public patchGhostContent(eventId: string, patch: Record<string, unknown>): MemoryEventRecord | null {
        return this.requireEventRepo().patchGhostContent(eventId, patch);
    }

    /**
     * LF-R5 identity revert：通用的事件 content 整体替换（不限 type）。
     * Identity revert 等审计操作只允许写入 content；schema 列（type、parent_id、user_id 等）不可改。
     */
    public updateEventContent(eventId: string, nextContent: Record<string, unknown>): MemoryEventRecord | null {
        return this.requireEventRepo().updateContent(eventId, nextContent);
    }

    /**
     * LF-R4 evidence weight：判断给定 askEventId 是否已有 ask-answer-pair 子事件。
     * 仅消费结构化关系（parent_id + type），不读对话文本。
     */
    public hasAskBeenAnswered(askEventId: string): boolean {
        return this.requireEventRepo().hasAskBeenAnswered(askEventId);
    }

    /**
     * LF-R5 identity 召回：列出指定 user 的 live `identity-append` 事件，按 ts 倒序。
     * 状态层为 `abandoned` 的（revert 过）会被过滤；`archived` 同理（冷归档已外迁）。
     */
    public listActiveIdentity(userId: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        return this.requireEventRepo().listActiveIdentity(userId, options);
    }

    /**
     * LF-R5 identity 历史：列出所有 identity append（含 revert / archived），按 ts 倒序。
     * 仅 CLI / TUI 审计使用，prompt 召回请用 listActiveIdentity。
     */
    public listAllIdentity(userId: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        return this.requireEventRepo().listAllIdentity(userId, options);
    }

    private requireDb(): Database {
        if (!this.db || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.db;
    }

    private requireCodenameRepo(): BrainCodenameRepo {
        if (!this.codenameRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.codenameRepo;
    }

    private requireContextForkRepo(): BrainContextForkRepo {
        if (!this.contextForkRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.contextForkRepo;
    }

    private requireEqStateRepo(): BrainEqStateRepo {
        if (!this.eqStateRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.eqStateRepo;
    }

    private requireEventRepo(): BrainEventRepo {
        if (!this.eventRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.eventRepo;
    }

    private requireLinkRepo(): BrainLinkRepo {
        if (!this.linkRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.linkRepo;
    }

    private requireProjectRepo(): BrainProjectRepo {
        if (!this.projectRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.projectRepo;
    }

    private requireSceneRecordRepo(): BrainSceneRecordRepo {
        if (!this.sceneRecordRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.sceneRecordRepo;
    }

    private requireStateRepo(): BrainStateRepo {
        if (!this.stateRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.stateRepo;
    }

    private requireSummaryRepo(): BrainSummaryRepo {
        if (!this.summaryRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.summaryRepo;
    }

    private requireTaskPlanRepo(): BrainTaskPlanRepo {
        if (!this.taskPlanRepo || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.taskPlanRepo;
    }
}

function createSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_events (
            id TEXT PRIMARY KEY,
            ts INTEGER NOT NULL,
            time_bucket TEXT NOT NULL,
            user_id TEXT NOT NULL,
            channel_id TEXT,
            codename_id TEXT,
            type TEXT NOT NULL,
            role TEXT,
            content TEXT NOT NULL,
            parent_id TEXT,
            embedding_id TEXT,
            importance REAL NOT NULL DEFAULT 0.5,
            FOREIGN KEY (parent_id) REFERENCES memory_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_time     ON memory_events(ts);
        CREATE INDEX IF NOT EXISTS idx_events_bucket   ON memory_events(time_bucket);
        CREATE INDEX IF NOT EXISTS idx_events_codename ON memory_events(codename_id, ts);
        CREATE INDEX IF NOT EXISTS idx_events_type     ON memory_events(type, ts);
        CREATE INDEX IF NOT EXISTS idx_events_user     ON memory_events(user_id, ts);
        -- Hot prompt / identity / ghost recall always starts from one user's typed time window.
        -- Keep this as a composite index so a large single brain.db does not degrade into broad scans.
        CREATE INDEX IF NOT EXISTS idx_events_user_type_ts ON memory_events(user_id, type, ts DESC);
        -- Ask pending checks and ghost evidence checks are relationship lookups, not semantic text reads.
        -- Index parent_id + type together because these checks sit on the interactive turn path.
        CREATE INDEX IF NOT EXISTS idx_events_parent_type ON memory_events(parent_id, type);

        CREATE TABLE IF NOT EXISTS memory_state (
            event_id TEXT PRIMARY KEY,
            activation REAL NOT NULL DEFAULT 0,
            decay_score REAL NOT NULL DEFAULT 0,
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed INTEGER,
            resumed_at INTEGER,
            status TEXT NOT NULL DEFAULT 'live',
            FOREIGN KEY (event_id) REFERENCES memory_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_state_status ON memory_state(status);

        CREATE TABLE IF NOT EXISTS memory_summary (
            id TEXT PRIMARY KEY,
            time_range TEXT NOT NULL,
            bucket_key TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding_id TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_summary_range_bucket ON memory_summary(time_range, bucket_key);

        CREATE TABLE IF NOT EXISTS memory_links (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            strength REAL NOT NULL,
            type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (from_id) REFERENCES memory_events(id),
            FOREIGN KEY (to_id) REFERENCES memory_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_id);
        CREATE INDEX IF NOT EXISTS idx_links_to   ON memory_links(to_id);
        CREATE INDEX IF NOT EXISTS idx_links_type ON memory_links(type);

        CREATE TABLE IF NOT EXISTS codenames (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            working_dir TEXT,
            description TEXT,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 0,
            project_id TEXT,
            UNIQUE (user_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_codename_user_used ON codenames(user_id, last_used_at DESC);

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            goal TEXT,
            project_dir TEXT NOT NULL,
            project_memory_dir TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_projects_user_used ON projects(user_id, last_used_at DESC);

        CREATE TABLE IF NOT EXISTS memory_eq_state (
            user_id     TEXT PRIMARY KEY,
            valence     REAL NOT NULL,
            arousal     REAL NOT NULL,
            dominance   REAL NOT NULL,
            label       TEXT NOT NULL,
            confidence  REAL NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_plans (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            status TEXT NOT NULL,
            progress REAL NOT NULL,
            step_count INTEGER NOT NULL,
            completed_step_count INTEGER NOT NULL,
            steps_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            source_event_id TEXT,
            source_ask_id TEXT,
            source_blackboard_turn_id TEXT,
            source_scene_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_task_plans_user_updated ON task_plans(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_task_plans_source_event ON task_plans(source_event_id);
        CREATE INDEX IF NOT EXISTS idx_task_plans_blackboard ON task_plans(source_blackboard_turn_id);

        CREATE TABLE IF NOT EXISTS context_forks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            parent_id TEXT,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            scope_summary TEXT NOT NULL,
            max_context_tokens INTEGER NOT NULL,
            inherited_event_ids_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            source_event_id TEXT,
            source_ask_id TEXT,
            source_blackboard_turn_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_context_forks_user_updated ON context_forks(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_context_forks_source_event ON context_forks(source_event_id);
        CREATE INDEX IF NOT EXISTS idx_context_forks_blackboard ON context_forks(source_blackboard_turn_id);

        CREATE TABLE IF NOT EXISTS scene_records (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            detail TEXT,
            visible_facts_json TEXT NOT NULL,
            open_questions_json TEXT NOT NULL,
            task_plan_id TEXT,
            context_fork_id TEXT,
            blackboard_turn_id TEXT,
            source_event_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scene_records_user_updated ON scene_records(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scene_records_source_event ON scene_records(source_event_id);
        CREATE INDEX IF NOT EXISTS idx_scene_records_blackboard ON scene_records(blackboard_turn_id);
    `);
}

function readPromptAtomEntries(event: MemoryEventRecord): BrainVisibleAtom[] {
    const content = isRecord(event.content) ? event.content : null;
    const rawAtoms = content && Array.isArray(content.atoms) ? content.atoms : [];
    const visible: BrainVisibleAtom[] = [];
    for (const raw of rawAtoms) {
        const entry = parsePromptAtomEntry(raw, event);
        if (entry) visible.push(entry);
    }
    return visible;
}

function parsePromptAtomEntry(raw: unknown, event: MemoryEventRecord): BrainVisibleAtom | null {
    if (!isRecord(raw)) return null;
    const atom = parseMemoryAtom(raw.atom, event);
    const score = parseAtomScore(raw.score, atom?.id ?? event.id);
    if (!atom || !score) return null;
    return {
        atom,
        score,
        sourceEventId: event.id,
        sourceEventTs: event.ts,
    };
}

function parseMemoryAtom(raw: unknown, event: MemoryEventRecord): MemoryAtom | null {
    if (!isRecord(raw)) return null;
    const id = readString(raw.id);
    const episodeIds = readStringArray(raw.episodeIds);
    const userId = readString(raw.userId) ?? event.userId;
    const channelId = readString(raw.channelId) ?? event.channelId ?? null;
    const projectId = readString(raw.projectId);
    const role = readString(raw.role);
    const task = readString(raw.task);
    const context = readString(raw.context);
    const action = readString(raw.action);
    const outcome = readString(raw.outcome);
    const confidence = readNumber(raw.confidence);
    const priorWeight = readNumber(raw.priorWeight);
    const embedding = readNumberArray(raw.embedding);
    const text = readString(raw.text);
    const stage = readString(raw.stage);
    const createdAt = readString(raw.createdAt) ?? new Date(event.ts).toISOString();
    if (
        !id ||
        episodeIds.length === 0 ||
        !userId ||
        !channelId ||
        !projectId ||
        !role ||
        !task ||
        !context ||
        !action ||
        !outcome ||
        confidence === null ||
        priorWeight === null ||
        !text ||
        !stage
    ) {
        return null;
    }
    return {
        id,
        episodeIds,
        userId,
        channelId,
        projectId,
        role: role as MemoryAtom["role"],
        task,
        context,
        problem: readString(raw.problem) ?? undefined,
        action,
        outcome,
        success: readBoolean(raw.success) ?? undefined,
        confidence,
        priorWeight,
        embedding,
        text,
        stage: stage as MemoryAtom["stage"],
        createdAt,
        refinedAt: readString(raw.refinedAt) ?? undefined,
    };
}

function parseAtomScore(raw: unknown, atomId: string): AtomScore | null {
    if (!isRecord(raw)) return null;
    const recency = readNumber(raw.recency);
    const access = readNumber(raw.access);
    const successPrior = readNumber(raw.successPrior);
    const fanout = readNumber(raw.fanout);
    const total = readNumber(raw.total);
    const inboxDecayApplied = readBoolean(raw.inboxDecayApplied);
    if (
        recency === null ||
        access === null ||
        successPrior === null ||
        fanout === null ||
        total === null ||
        inboxDecayApplied === null
    ) {
        return null;
    }
    return {
        atomId: readString(raw.atomId) ?? atomId,
        recency,
        access,
        successPrior,
        fanout,
        total,
        inboxDecayApplied,
        explain: readString(raw.explain) ?? undefined,
    };
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return null;
}

function readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(date: Date | string): number {
    const parsed = date instanceof Date ? date.getTime() : Date.parse(date);
    return Number.isFinite(parsed) ? parsed : Date.now();
}
