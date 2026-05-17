import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../../../agent/di/decorators/index.ts";
import { BrainComponent } from "../../../components/component.ts";
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
} from "../../../protocol/contracts/index.ts";
import { brainPromptAtomModel } from "../../../entities/memory/index.ts";
import { brainSchema } from "../../../entities/memory/brain.schema.ts";
import { BrainCodenameRepo } from "../../../entities/memory/brain.codename.repo.ts";
import {
    BrainEventRepo,
    type BrainEventInput,
    type BrainEventListInput,
} from "../../../entities/memory/brain.event.repo.ts";
import { BrainContextForkRepo } from "../../../entities/memory/brain.context.fork.repo.ts";
import { BrainEqStateRepo } from "../../../entities/memory/brain.eq.state.repo.ts";
import { BrainLinkRepo } from "../../../entities/memory/brain.link.repo.ts";
import { BrainProjectRepo } from "../../../entities/memory/brain.project.repo.ts";
import { BrainSceneRecordRepo } from "../../../entities/memory/brain.scene.record.repo.ts";
import { BrainStateRepo, type BrainStateMutation } from "../../../entities/memory/brain.state.repo.ts";
import { BrainSummaryRepo } from "../../../entities/memory/brain.summary.repo.ts";
import { BrainTaskPlanRepo } from "../../../entities/memory/brain.task.plan.repo.ts";

export type { BrainEventInput, BrainEventListInput } from "../../../entities/memory/brain.event.repo.ts";
export type { BrainStateMutation } from "../../../entities/memory/brain.state.repo.ts";

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
        brainSchema.install(db);
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
        const sinceTs = brainPromptAtomModel.normalizeTimestamp(date) - days * 86_400_000;
        const events = this.listEvents({
            ...(input.userId ? { userId: input.userId } : {}),
            type: MemoryEventType.Event,
            sinceTs,
            limit,
            statusIn: [MemoryEventStatus.Live, MemoryEventStatus.Resumed],
        });
        const visible: BrainVisibleAtom[] = [];
        for (const event of events) {
            const atoms = brainPromptAtomModel.entriesFromEvent(event);
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

