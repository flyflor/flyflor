import { createDefaultMemoryConfig, type FlyflorConfig } from "../../../config/index.ts";
import type { WorkingMemoryConfig } from "../../../config/index.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CrystalCandidateInput } from "../../crystal/reflection/index.ts";
import {
    ArchitectureLayer,
    AtomStage,
    ComponentKind,
    CrystalMemoryBackend,
    MarkdownMemoryFile,
    MemoryCandidateStatus,
    MemoryKind,
    MemoryLayer,
    MemorySourceKind,
    MemoryWorkingBackend,
    ModelRole,
    RuntimeMode,
} from "../../../protocol/contracts/index.ts";
import type {
    AtomScore,
    GatewayMessage,
    GatewayReply,
    MemoryAtom,
    ModelClient,
    RuntimeContext,
} from "../../../protocol/contracts/index.ts";
import { Memory } from "../../../components/index.ts";
import { Module } from "../../../agent/di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import {
    loadPromptTemplates,
    renderMemoryContextPrompt,
    renderScopeOfferPrompt,
    renderRuntimeAskContinuationPrompt,
    renderRuntimeIdleResumePrompt,
    renderRuntimeEqContextPrompt,
    renderRuntimeContinuationHintPrompt,
    renderRuntimeIdentityContextPrompt,
    renderSkillOfferPrompt,
} from "../../../agent/prompts/index.ts";
import { FeedbackCategory, classifyFeedback } from "./feedback/index.ts";
import {
    ScopeTriggerDetector,
    ScopeTriggerKind,
} from "../scope/index.ts";
import { CodenamePromotionComponent } from "../scope/codename.promote.ts";
import { ScopeScaffolder } from "../scope/scaffolder.ts";
import { SpreadingActivationEngine, type ActivationCandidate } from "./recall/index.ts";
import { kindForMemoryAction, targetFileForMemoryAction } from "./actions/index.ts";
import { LocalHashEmbeddingProvider, type EmbeddingProvider } from "../embedding/index.ts";
import { MarkdownMemoryStore } from "./markdown/index.ts";
import { ScopeMemoryStore } from "./scope/index.ts";
import { ContextForkStore, type ContextForkStoreSource } from "./fork/index.ts";
import { BrainStore, type BrainPromptAtomWrite, type BrainVisibleAtom } from "./brain/index.ts";
import { SummaryWorker, type SummaryRunResult } from "./summary/index.ts";
import { AskReason, MemoryEventStatus, MemoryEventType, ReplayRecordKind, decayEq, deriveEqDirective, normalizeEqClassification, type AgentAsk, type AskEventContent, type AskAnswerPairContent, type BehaviorCorrectionContent, type BehaviorSnapshotContent, type CodenameRecord, type ContextForkRecord, type EqClassification, type EqState, type ContinuationContextEventContent, ContinuationContextReason, ContinuationDecisionKind, type ContinuationDecision, type ContinuationSnapshot, type IdentityAppendCandidate, type IdentityEventContent, type MemoryEventRecord, type ScopeRecord, type ReplayRecord, type TaskPlanRecord } from "../../../protocol/contracts/index.ts";
import { MemoryMatrixAggregator } from "./recall/index.ts";
import { CrystalMemoryComponent } from "../../crystal/memory/index.ts";
import { SQLiteMemoryStore, type PendingScopeOffer, type PendingSkillOffer } from "./sqlite/index.ts";
import { LocalWorkingMemoryStore, type EpisodeRecord, type WorkingMemoryStore } from "./working/index.ts";
import { SQLiteGraphStore, type MemoryGraphStore } from "./graph/index.ts";
import { ConsolidationWorker, RetrospectiveLog } from "./consolidation/index.ts";
import { HotMemoryCompressionWorker } from "./hot/index.ts";
import { runBrainArchive, type BrainArchiveRunResult } from "./brain/index.ts";
import { BackgroundScheduler } from "./lifecycle/index.ts";
import { IdleSupervisor } from "../idle/index.ts";
import { continuityOwnerKey, sourceKeyForMessage, sourceSurfaceForMessage, type ContextScopeComponent, useContextScope } from "../../../agent/context/index.ts";
import { DreamWorkerImpl } from "./dream/index.ts";
import { historyTurnFromEvent, type ChatHistoryPlanning, type ChatHistoryTurn } from "./history/index.ts";
import type { MemoryAction } from "./actions/index.ts";
import type {
    MemoryCandidate,
    MemoryEpisodeProvenance,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "./types.ts";
import type { WorkingMemoryHealthSnapshot } from "./working/index.ts";

export { parseMemoryActions, targetFileForMemoryAction } from "./actions/index.ts";
export { MarkdownMemoryStore } from "./markdown/index.ts";
export { ScopeMemoryStore } from "./scope/index.ts";
export { RetrospectiveLog, type RetrospectiveEntry } from "./consolidation/index.ts";
export { HotMemoryCompressionWorker, parseHotMemoryCompressionDecision } from "./hot/index.ts";
export { SQLiteMemoryStore } from "./sqlite/index.ts";
export { SQLiteGraphStore } from "./graph/index.ts";
export type { MemoryAction } from "./actions/index.ts";
export type {
    MemoryCandidate,
    MemoryEpisodeProvenance,
    MemoryMatrixResult,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "./types.ts";

export interface BehaviorSnapshotRecord {
    corrections: MemoryEventRecord[];
    snapshot: MemoryEventRecord;
}

export type { ChatHistoryTurn } from "./history/index.ts";

export interface TurnPlanningInput {
    contextForks?: ContextForkRecord[];
    replayRecords?: ReplayRecord[];
    taskPlans?: TaskPlanRecord[];
}

export interface BehaviorSnapshotInput {
    ask?: AgentAsk;
    blackboard?: {
        mode: string;
        reason: string;
        status?: string;
        turnId?: string;
    };
    codenameId?: string;
    context: RuntimeContext;
    mcpCalls?: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
    memoryActions: number;
    message: GatewayMessage;
    reply: GatewayReply;
    sandboxMode?: string;
    snapshotId?: string;
    skills?: string[];
    visibleText?: string;
}

export interface MemoryModuleOverrides {
    embeddings?: EmbeddingProvider;
    graph?: MemoryGraphStore | null;
}

@Module()
export class MemoryModule extends Memory {
    /** LF-R10 brain.db 权威源。warmup 时 open；旧 journal 不再参与热路径写入。 */
    private readonly brain: BrainStore;
    private brainOpened = false;
    private readonly markdown: MarkdownMemoryStore;
    private readonly scopeMemory: ScopeMemoryStore;
    private readonly contextForkStore: ContextForkStore;
    private readonly contextScope: ContextScopeComponent;
    private readonly matrix: MemoryMatrixAggregator;
    /** Hippocampus 热记忆召回的扩散激活 owner，只消费向量/概念/recency 资源指标。 */
    private readonly activation: SpreadingActivationEngine;
    private readonly sqlite: SQLiteMemoryStore;
    private readonly crystal: CrystalMemoryComponent;
    /** 工作记忆 Component；主线实现是本地 WAL/snapshot。 */
    private readonly workingMemory: WorkingMemoryStore | null;
    private readonly workingMemoryBackend: MemoryWorkingBackend;
    private readonly workingMemoryDefaultTtlSeconds: number;
    /** 长期晶体图 Component；主线实现是本地 crystal graph。 */
    private readonly graph: MemoryGraphStore | null;
    private readonly hotMemoryCompression: HotMemoryCompressionWorker | null;
    private readonly scheduler: BackgroundScheduler | null;
    private brainArchiveTimer: ReturnType<typeof setInterval> | undefined;
    private hotMemoryCompressionTimer: ReturnType<typeof setInterval> | undefined;
    private brainMaintenanceBusy = false;
    private readonly activeMemoryOwners = new Set<string>();
    private readonly idle: IdleSupervisor;
    private readonly model: ModelClient | undefined;
    private readonly scopeScaffolder: ScopeScaffolder;
    /** Scope/fork/skill 固化触发只读结构化信号和资源指标，不解析自然语言。 */
    private readonly scopeTriggerDetector: ScopeTriggerDetector;
    /** Codename → scope 升格副作用 owner，避免 runtime 直接调用兼容 helper。 */
    private readonly codenamePromotion: CodenamePromotionComponent;
    /** 单例 embedding provider；用于 context.embedding 缺省时降级计算。 */
    private readonly embeddings: EmbeddingProvider;
    private readonly assistantMemoryByFocus = new Map<string, { current?: string; previous?: string }>();
    private readonly sourceKeyByOwnerKey = new Map<string, string>();

    public constructor(
        private readonly config: FlyflorConfig,
        private readonly events: EventSink,
        model?: ModelClient,
        overrides: MemoryModuleOverrides = {},
    ) {
        super();
        this.model = model;
        this.embeddings = overrides.embeddings ?? new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
        const working = resolveWorkingMemoryConfig(config);
        this.workingMemoryBackend = working.backend;
        this.workingMemoryDefaultTtlSeconds = working.local.defaultTtlSeconds;
        this.brain = new BrainStore({ dbPath: join(config.paths.configDir, "brain.db") });
        this.markdown = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        this.scopeMemory = new ScopeMemoryStore(config.paths, this.events);
        this.contextForkStore = new ContextForkStore(join(config.paths.storageDir, "forks"));
        this.contextScope = useContextScope(config.paths);
        this.matrix = new MemoryMatrixAggregator(config.memory.matrix);
        this.activation = new SpreadingActivationEngine();
        this.sqlite = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        this.crystal = new CrystalMemoryComponent(
            config.memory.crystal,
            undefined,
            config.memory.embedding.dimensions,
        );
        this.workingMemory =
            working.backend === MemoryWorkingBackend.Local
                ? new LocalWorkingMemoryStore(config.paths.memoryDir, working.local)
                : null;
        this.graph =
            overrides.graph !== undefined
                ? overrides.graph
                : config.memory.crystal.enabled && config.memory.crystal.backend === CrystalMemoryBackend.Local
                  ? new SQLiteGraphStore(config.memory.crystal.local)
                  : null;
        this.hotMemoryCompression =
            this.workingMemory && model && config.memory.tuning.hotMemoryCompression.enabled
                ? new HotMemoryCompressionWorker(this.workingMemory, this.brain, model, this.events, {
                      batchSize: config.memory.tuning.hotMemoryCompression.batchSize,
                      workingMemoryHealthSnapshot: () => this.getWorkingMemoryHealthSnapshot(),
                  })
                : null;
        this.scopeScaffolder = new ScopeScaffolder(config.paths, this.events);
        this.scopeTriggerDetector = new ScopeTriggerDetector();
        this.codenamePromotion = new CodenamePromotionComponent();
        // 后台调度器仅在三件依赖（工作记忆 Component + 长期图 Component + 模型）齐备时启用；
        // 任一缺失时不启动 scheduler，并通过 warmup 事件显式暴露缺口。
        this.scheduler =
            this.workingMemory && this.graph && model
                ? new BackgroundScheduler(
                      new ConsolidationWorker(this.workingMemory, this.graph, model, this.events, {
                          retrospective: new RetrospectiveLog({ projectMemoryDir: config.paths.projectMemoryDir }),
                          workingMemoryHealthSnapshot: () => this.getWorkingMemoryHealthSnapshot(),
                      }),
                      this.graph,
                      this.events,
                      {
                          dream: new DreamWorkerImpl(this.graph, model, this.events),
                          scopeSweeper: (ownerKey: string) => this.sweepScopeClusters(ownerKey),
                          skillSweeper: (ownerKey: string) => this.sweepSkillCandidates(ownerKey),
                          summarySweeper: async (ownerKey: string) => {
                              const r = await this.runSummaryOnce(ownerKey);
                              return { written: r?.written ?? 0 };
                          },
                          hotMemoryCompression: this.hotMemoryCompression ?? undefined,
                          hotMemoryCompressionIntervalMs:
                              Math.max(0, config.memory.tuning.hotMemoryCompression.intervalMinutes) * 60_000,
                          idleSweeper: () => this.idle.sweepOnce(),
                          brainArchiveSweeper: async () => {
                              const r = await this.runBrainArchiveOnce();
                              return {
                                  eventsCopied: r?.eventsCopied ?? 0,
                                  months: r?.months.length ?? 0,
                                  vacuumed: r?.vacuumed ?? false,
                              };
                          },
                          brainArchiveIntervalMs:
                              Math.max(0, config.memory.tuning.brainDb.archiveIntervalHours) * 60 * 60_000,
                          workingMemoryHealthSnapshot: () => this.getWorkingMemoryHealthSnapshot(),
                      },
                  )
                : null;
        this.idle = new IdleSupervisor(this.events, {
            idleMinutes: config.memory.tuning.idle.idleMinutes,
        });
    }

    public getWorkingMemoryHealthSnapshot(): WorkingMemoryHealthSnapshot | undefined {
        return (this.workingMemory as { getHealthSnapshot?: () => WorkingMemoryHealthSnapshot } | null)?.getHealthSnapshot?.();
    }

    /**
     * Scope memory store is normally bound to config.paths.projectDir. Active
     * scope commands create a per-turn scoped store so scope memory can move
     * without mutating global config or creating a hidden continuity owner.
     */
    private scopeMemoryForScope(scope: RuntimeContext["activeScope"] | undefined): ScopeMemoryStore {
        if (!scope) return this.scopeMemory;
        return new ScopeMemoryStore(this.contextScope.scopeStorePaths(scope), this.events);
    }

    public async warmup(): Promise<void> {
        await this.ensureBrainOpen("warmup-open");
        if (this.scheduler) {
            this.scheduler.start();
        } else {
            const missing: string[] = [];
            if (!this.workingMemory) missing.push("working-memory");
            if (!this.graph) missing.push("crystal-graph");
            if (!this.model) missing.push("model");
            this.events.publish(
                event(RuntimeEventType.MemoryBackgroundSchedulerSkipped, {
                    missing,
                    workingMemoryBackend: this.workingMemoryBackend,
                    crystalGraphEnabled: Boolean(this.graph),
                    modelProvider: this.config.model.provider,
                    impact: "consolidation/decay/dream 跳过缺失依赖；工作记忆仍按 configured backend 写入，长期晶体层需要 graph component",
                }),
            );
        }
        if (!this.scheduler) {
            this.startBrainArchiveTimer();
            this.startHotMemoryCompressionTimer();
        }
        await this.cleanupContextForkSidecars({
            ttlDays: this.config.memory.tuning.contextFork.sidecarTtlDays,
        });
        if (!this.workingMemory) return;
        try {
            const latencyMs = await this.workingMemory.ping();
            this.events.publish(
                event(RuntimeEventType.MemoryWarmupComplete, {
                    backend: this.workingMemoryBackend,
                    latencyMs,
                    // ping() has already loaded/probed the backend, so exposing
                    // this snapshot adds observability without extra recovery IO.
                    workingMemoryHealth: this.getWorkingMemoryHealthSnapshot(),
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryWarmupComplete, {
                    backend: this.workingMemoryBackend,
                    latencyMs: -1,
                    error: String(err),
                    workingMemoryHealth: this.getWorkingMemoryHealthSnapshot(),
                }),
            );
            throw err;
        }
    }

    /**
     * brain.db 是事件写入和 prompt recall 的权威源，不能只依赖 runtime/gateway 先调用 warmup。
     * MemoryModule 的直接调用者（测试、CLI、后台 worker）进入写路径前也必须能安全打开 brain.db。
     */
    private async ensureBrainOpen(stage: string): Promise<void> {
        if (this.brainOpened) return;
        try {
            await this.brain.open();
            this.brainOpened = true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, { stage, error: String(err) }),
            );
            throw err;
        }
    }

    /** 关停：停止后台调度器，让 bun --compile 二进制可以干净退出。 */
    public dispose(): void {
        this.scheduler?.stop();
        if (this.brainArchiveTimer !== undefined) {
            clearInterval(this.brainArchiveTimer);
            this.brainArchiveTimer = undefined;
        }
        if (this.hotMemoryCompressionTimer !== undefined) {
            clearInterval(this.hotMemoryCompressionTimer);
            this.hotMemoryCompressionTimer = undefined;
        }
        this.workingMemory?.dispose();
        if (this.brainOpened) {
            this.brain.close();
            this.brainOpened = false;
        }
    }

    private startBrainArchiveTimer(): void {
        if (this.brainArchiveTimer !== undefined) {
            clearInterval(this.brainArchiveTimer);
            this.brainArchiveTimer = undefined;
        }
        const intervalMs = Math.max(0, this.config.memory.tuning.brainDb.archiveIntervalHours) * 60 * 60_000;
        if (!this.brainOpened || intervalMs <= 0) return;
        this.brainArchiveTimer = setInterval(() => {
            void this.runBrainArchiveOnce().catch((err) => {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "brain.archive.timer",
                        message: err instanceof Error ? err.message : String(err),
                    }),
                );
                throw err;
            });
        }, intervalMs);
        if (typeof (this.brainArchiveTimer as { unref?: () => void })?.unref === "function") {
            (this.brainArchiveTimer as { unref: () => void }).unref();
        }
    }

    private startHotMemoryCompressionTimer(): void {
        if (this.hotMemoryCompressionTimer !== undefined) {
            clearInterval(this.hotMemoryCompressionTimer);
            this.hotMemoryCompressionTimer = undefined;
        }
        const intervalMs = Math.max(0, this.config.memory.tuning.hotMemoryCompression.intervalMinutes) * 60_000;
        if (!this.brainOpened || !this.hotMemoryCompression || intervalMs <= 0) return;
        this.hotMemoryCompressionTimer = setInterval(() => {
            void this.runHotMemoryCompressionRootOnce().catch((err) => {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "hot.memory.compression.timer",
                        message: err instanceof Error ? err.message : String(err),
                    }),
                );
                throw err;
            });
        }, intervalMs);
        if (typeof (this.hotMemoryCompressionTimer as { unref?: () => void })?.unref === "function") {
            (this.hotMemoryCompressionTimer as { unref: () => void }).unref();
        }
    }

    private async runHotMemoryCompressionRootOnce(): Promise<void> {
        if (!this.brainOpened || !this.hotMemoryCompression || this.brainMaintenanceBusy) return;
        this.brainMaintenanceBusy = true;
        try {
            for (const ownerKey of [...this.activeMemoryOwners]) {
                await this.hotMemoryCompression.drain(ownerKey);
            }
        } finally {
            this.brainMaintenanceBusy = false;
        }
    }

    /** CLI / 诊断接口：dream 后台状态。无 scheduler 时返回禁用快照。 */
    public dreamSnapshot(): { dreamEnabled: boolean; dreamBusy: boolean; users: number } {
        if (!this.scheduler) {
            return { dreamEnabled: false, dreamBusy: false, users: 0 };
        }
        const s = this.scheduler.snapshot();
        return { dreamEnabled: s.dreamEnabled, dreamBusy: s.dreamBusy, users: s.owners };
    }

    /** CLI 手动触发一轮 dream pass；scheduler 未启用时返回零值。 */
    public async runDreamOnce(
        limit?: number,
        ownerKey?: string,
    ): Promise<{
        users: number;
        driftRepaired: number;
        recallReinforced: number;
        contradictionsFlagged: number;
        reconsolidated: number;
        skipped: number;
    }> {
        if (!this.scheduler)
            return { users: 0, driftRepaired: 0, recallReinforced: 0, contradictionsFlagged: 0, reconsolidated: 0, skipped: 0 };
        return this.scheduler.runDreamOnce(limit, ownerKey);
    }

    /**
     * LF-R11 Behavior Snapshot：每轮完成后写一条 append-only brain event。
     * 只记录结构化触发面 + 短文本预览，用于事后回放"为什么这么答"。
     * 不做任何业务语义判断，不保存完整 prompt / 工具输出 / 日志。
     */
    public recordBehaviorSnapshot(input: BehaviorSnapshotInput): string | null {
        if (!this.brainOpened) return null;
        const ts = Date.parse(input.context.now);
        const nowMs = Number.isFinite(ts) ? ts : Date.now();
        const snapshotId = input.snapshotId ?? `behavior-${crypto.randomUUID()}`;
        const mcpCalls = input.mcpCalls ?? [];
        const outputKind = input.ask ? "ask" : "reply";
        const content: BehaviorSnapshotContent = {
            snapshotId,
            requestId: input.context.requestId,
            input: {
                messageId: input.message.id,
                textPreview: compactText(input.message.text, 500),
                sourceSurface: sourceSurfaceForMessage(input.message),
                chatType: input.message.route.chatType,
                receivedAt: input.message.receivedAt,
            },
            triggers: {
                memoryActions: input.memoryActions,
                ...(input.ask
                    ? {
                          ask: {
                              reason: input.ask.reason,
                              choices: input.ask.choices?.length ?? 0,
                              questions: input.ask.questions?.length ?? 0,
                          },
                      }
                    : {}),
                ...(input.blackboard
                    ? {
                          blackboard: {
                              mode: input.blackboard.mode,
                              reason: input.blackboard.reason,
                              status: input.blackboard.status,
                              turnId: input.blackboard.turnId,
                          },
                      }
                    : {}),
                mcpToolCalls: mcpCalls.length,
                mcpToolFailures: mcpCalls.filter((call) => !call.ok).length,
                skills: uniqueStrings(input.skills ?? []).slice(0, 16),
                sandboxMode: input.sandboxMode,
            },
            output: {
                kind: outputKind,
                textPreview: compactText(input.reply.text, 500),
                ...(input.visibleText ? { visibleTextPreview: compactText(input.visibleText, 500) } : {}),
            },
        };
        try {
            this.brain.appendEvent({
                id: snapshotId,
                ts: nowMs,
                ownerKey: continuityOwnerKey(input.message, input.context),
                sourceKey: sourceKeyForMessage(input.message, input.context),
                sourceSurface: sourceSurfaceForMessage(input.message),
                codenameId: input.codenameId,
                type: MemoryEventType.BehaviorSnapshot,
                role: ModelRole.Assistant,
                content: content as unknown as Record<string, unknown>,
                importance: 0.35,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryBehaviorSnapshotRecorded, {
                    snapshotId,
                    sourceKey: sourceKeyForMessage(input.message, input.context),
                    requestId: input.context.requestId,
                    outputKind,
                    memoryActions: input.memoryActions,
                    mcpToolCalls: mcpCalls.length,
                    mcpToolFailures: content.triggers.mcpToolFailures,
                }),
            );
            return snapshotId;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "behavior.snapshot",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** LF-R11 诊断入口：列出行为快照及其后续纠正证据。 */
    public listBehaviorSnapshots(ownerKey: string, options: { limit?: number } = {}): BehaviorSnapshotRecord[] {
        if (!this.brainOpened) return [];
        try {
            const snapshots = this.brain.listEvents({
                ownerKey,
                type: MemoryEventType.BehaviorSnapshot,
                limit: options.limit ?? 20,
            });
            if (snapshots.length === 0) return [];
            const corrections = this.brain.listEvents({
                ownerKey,
                type: MemoryEventType.BehaviorCorrection,
                limit: 500,
            });
            return snapshots.map((snapshot) => ({
                snapshot,
                corrections: corrections.filter((correction) => correction.parentId === snapshot.id),
            }));
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "behavior.list",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    public async buildPrompt(message: GatewayMessage, context?: RuntimeContext): Promise<string> {
        if (!this.config.memory.enabled) {
            return "Memory is disabled.";
        }
        await loadPromptTemplates(this.config.paths);
        const activeScope = context?.activeScope;
        const scopeConstraintId = activeScope?.id;

        const request: MemorySearchRequest = {
            query: message.text,
            scope: scopeConstraintId ?? "global",
            subjectId: sourceKeyForMessage(message, context),
            limit: this.config.memory.retrieval.maxResults,
        };

        const [hippocampus, scopeMemory, brainResults, markdown] = await Promise.all([
            this.assembleHippocampusContext(message, context),
            activeScope
                ? this.scopeMemoryForScope(activeScope).snapshot({
                      maxChars: this.config.memory.retrieval.maxPromptChars,
                      query: message.text,
                      requestId: context?.requestId,
                      scope: scopeConstraintId,
                  })
                : Promise.resolve(this.scopeMemory.emptySnapshot()),
            this.recallVisibleBrainMemory(message, context),
            this.markdown.snapshot(),
        ]);
        const results = dedupeResults(brainResults);
        const memoryBody = renderMemoryPrompt(
            markdown.prompt,
            scopeMemory.prompt,
            hippocampus,
            results,
            this.config.memory.retrieval.maxPromptChars,
        );

        // Scope 候选 nudge 注入：若该 ownerKey 有待确认 offer，把 nudge 拼到 memoryBody 顶部。
        // 复用 Path A：用户下一轮回复若给出明确意图，model 自然在 memory action 的 signals 中
        // 抬高 scopeIntent，commitTurn 的 detectExplicitIntent 即触发 scaffolder。
        const continuityOwner = continuityOwnerKey(message, context);
        const [offer, skillOffer] = await Promise.all([
            this.sqlite.getScopeOffer(continuityOwner),
            this.sqlite.getSkillOffer(continuityOwner),
        ]);
        const nudges: string[] = [];
        if (offer) nudges.push(this.renderScopeOfferNudge(offer));
        if (skillOffer) nudges.push(this.renderSkillOfferNudge(skillOffer));

        // LF-R3 Ask 一等公民：若 brain 中存在 pending ask，把 [continuation] 块拼到顶部，
        // 让模型把用户下一条消息当作对该 ask 的答复处理。零字符匹配——是否注入只看
        // brain 是否有未答复的 ask 事件，runtime 不解析任何对话文本。
        const ownerKey = continuityOwnerKey(message, context);
        const continuation = this.renderPendingAskContinuation(ownerKey);
        if (continuation) nudges.unshift(continuation);

        // LF-R4 Continuation Context：把活跃的高分 continuation-context 拼成 [continuation-hint] 块注入
        // prompt。零字符匹配——是否注入只看 brain 的 status + decayScore 资源指标，
        // 不解析任何对话文本。用户可在回复里显式 resume / fork / fresh。
        const continuationHint = this.renderContinuationHint(ownerKey);
        if (continuationHint) nudges.push(continuationHint);

        // ContextFork：无隐式会话设计下的显式分叉上下文。只有调用方传入
        // context.contextForkId 时才注入范围边界；runtime 不从文本推断 fork。
        const forkBlock = this.renderContextForkBlock(context?.contextForkId);
        if (forkBlock) nudges.push(forkBlock);

        // LF-R5 Identity：把当前 live identity append 拼成 [identity] 块注入 prompt 顶部。
        // 零字符匹配——是否注入只看 brain 行的 status，runtime 不解析 content 语义。
        const identityBlock = this.renderIdentityBlock(ownerKey);
        if (identityBlock) nudges.unshift(identityBlock);

        // LF-R8 Idle 行为联动：若上一轮该 owner 被 sweep 进 Idle，
        // 本轮 user 输入会触发 awaken，但此时 touch() 还未发生（在 persistTurn
        // 阶段才执行），所以 peekResumeHint 仍能返回旧 mode 的 idleMs。
        // 仅注入资源指标 idleMinutes，让模型对长时间未互动的 scope/fork/turn 更 graceful。
        // 零字符匹配——不读消息文本，只用 (now - lastInputAt) 资源指标。
        const resumeBlock = this.renderIdleResumeBlock(ownerKey);
        if (resumeBlock) nudges.unshift(resumeBlock);

        // EQ-01 slice B：把当前 EQ state 渲染为 `[eq-context]` 块注入 prompt 顶部。
        // 零字符匹配——只读 brain.memory_eq_state 结构化字段 + 资源指标 decay；
        // 不解析消息文本，不基于文本派生 label。
        const eqBlock = this.renderEqContextBlock(ownerKey);
        if (eqBlock) nudges.unshift(eqBlock);

        const body = nudges.length > 0 ? `${nudges.join("\n\n")}\n\n${memoryBody}` : memoryBody;

        this.events.publish(
            event(RuntimeEventType.MemoryPromptBuilt, {
                recallResults: results.length,
                atomScoreThreshold: this.config.memory.tuning.atomScore.visibilityThreshold,
                hippocampusActivated: hippocampus ? true : false,
                brainPromptRecallResults: brainResults.length,
                scopeConstraintId: scopeConstraintId ?? "global",
                scopeMemoryActivated: Boolean(scopeConstraintId) && scopeMemory.prompt ? true : false,
                scopeMemoryManifestPath: scopeMemory.manifest.paths.manifest,
                scopeMemoryRecallReceiptId: scopeMemory.receipt?.id,
                scopeMemoryRecallResults: scopeMemory.results.length,
            }),
        );

        return body;
    }

    /**
     * Hippocampus 上下文装配（working-memory ring + spreading activation）。
     * 仅在工作记忆 Component 可用且 ring 非空时有效；异常必须向上传递，禁止静默吞掉记忆层错误。
     * 性能：限制 candidate ≤ ringSize，激活计算 O(N·D) 在 1ms 量级。
     */
    private async assembleHippocampusContext(
        message: GatewayMessage,
        context?: RuntimeContext,
    ): Promise<string | undefined> {
        if (!this.workingMemory) return undefined;
        const ownerKey = continuityOwnerKey(message, context);
        const ringSize = this.config.memory.retrieval.maxResults;
        const [episodeIds, hotConcepts] = await Promise.all([
            this.workingMemory.readContextRing(ownerKey, ringSize),
            this.workingMemory.hotConcepts(ownerKey, 16),
        ]);
        if (episodeIds.length === 0) return undefined;
        const records = await Promise.all(episodeIds.map((id) => this.workingMemory!.readEpisode(ownerKey, id)));
        const visibleByEpisode = this.visibleAtomsForEpisodes(ownerKey, records);
        const candidates: ActivationCandidate[] = [];
        const visibleAtoms = new Map<string, BrainVisibleAtom>();
        for (const rec of records) {
            if (!rec) continue;
            const entries = visibleByEpisode.get(rec.episodeId) ?? [];
            for (const entry of entries) {
                visibleAtoms.set(entry.atom.id, entry);
                candidates.push({
                    id: entry.atom.id,
                    embedding: entry.atom.embedding.length > 0 ? entry.atom.embedding : rec.embedding,
                    concepts: rec.concepts,
                    importance: entry.score.total,
                    createdAt: Date.parse(entry.atom.createdAt),
                });
            }
        }
        if (candidates.length === 0) return undefined;
        const queryEmbedding =
            context?.embedding && context.embedding.length > 0
                ? context.embedding
                : await this.embeddings.embed(message.text);
        const topK = Math.min(8, ringSize);
        const activated = this.activation.spread({
            queryEmbedding,
            hotConcepts,
            candidates,
            nowMs: Date.now(),
            topK,
        });
        if (activated.length === 0) return undefined;
        const lines = activated
            .map((a) => {
                const entry = visibleAtoms.get(a.id);
                if (!entry) return "";
                const text = entry.atom.text.replace(/\s+/g, " ").trim().slice(0, 240);
                return `- [${a.score.toFixed(2)}] ${text}`;
            })
            .filter((l) => l.length > 0);
        if (lines.length === 0) return undefined;
        // reconstruction-mode：当激活节点 >= 3 时，注入提示让 LLM 重建关系而非死读片段。
        const reconstructionHint =
            activated.length >= 3
                ? "\n\nReconstruction hint: synthesise these episodes into an updated mental model — do not quote them verbatim."
                : "";
        return `Hippocampus context (top ${lines.length} activated episodes):\n${lines.join("\n")}${reconstructionHint}`;
    }

    public async rememberTurn(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        actions: MemoryAction[] = [],
        provenance: MemoryEpisodeProvenance = {},
        ask?: AgentAsk,
        planning: TurnPlanningInput = {},
    ): Promise<TurnMemoryResult> {
        if (!this.config.memory.enabled) {
            return {
                candidates: [],
                promoted: [],
            };
        }

        // Direct MemoryModule callers bypass RuntimeModule.handleMessage(); open brain.db here so
        // rememberTurn keeps the same lifecycle guarantee as runtime-managed turns.
        await this.ensureBrainOpen("remember-turn");

        const scopeTrigger = this.scopeTriggerDetector.detectExplicitIntent(actions);
        const createdAt = new Date(context.now).toISOString();
        // Codename must be persisted before atom scoring so the no-scope inbox
        // bucket can receive a namespaced codename boost without opening a scope.
        const codenameId = this.persistCodenamesFromActions(actions, createdAt);
        const activeScope = context.activeScope;
        const scopeConstraintId = this.contextScope.scopeConstraintId({
            codenameId,
            context,
        });
        const ownerKey = continuityOwnerKey(message, context, codenameId);
        this.sourceKeyByOwnerKey.set(ownerKey, sourceKeyForMessage(message, context));
        const memoryScopeId = scopeConstraintId ?? ownerKey;

        // LF-R3 Ask 一等公民：先把"用户对上一轮 ask 的答复"落到 brain（ask-answer-pair 事件），
        // 再处理本轮可能新发起的 ask。两个写入顺序固定，避免 chain 被错误跨轮接续。
        const pendingAskBefore = this.findPendingAsk(ownerKey);
        if (pendingAskBefore) {
            this.events.publish(
                event(
                    RuntimeEventType.ExecutiveLoopResumed,
                    {
                        askId: pendingAskBefore.id,
                    },
                    context.requestId,
                ),
            );
            this.recordAskAnswerPair(pendingAskBefore.id, pendingAskBefore.snapshotId, message, context, ownerKey);
        }

        // brain.db 是生命事件事实层：每轮先写权威事件，再从同轮结构化 memory action
        // 派生 atom。失败直接抛出，避免半状态继续运行。
        const sourceEventId = await this.writeTurnToBrain(
            message,
            reply,
            context,
            actions,
            provenance,
            memoryScopeId,
            codenameId,
        );

        // 模型本轮如果发起新的 ask（kind='ask'），落 brain.memory_events.type='ask'。
        // chainDepth 由前序 ask 是否存在 + countAskChainDepth 决定；超过 maxChainDepth
        // 时仅记审计事件，runtime 由调用方决定是否强制 reply（见 RuntimeModule）。
        let askEventId: string | undefined;
        if (ask) {
            askEventId = this.recordAskEvent(message, context, ask, pendingAskBefore?.id, provenance.behaviorSnapshotId);
        }

        this.recordTurnPlanning({
            ...planning,
            blackboardTurnId: provenance.blackboardTurnId,
            ownerKey,
            sourceKey: sourceKeyForMessage(message, context),
            requestId: context.requestId,
            sourceAskId: askEventId,
            sourceEventId,
        });

        await this.writeEpisodeToWorkingMemory(message, reply, context, ownerKey, importanceFromActions(actions), provenance);
        // 把当前 owner 登记进后台调度器，确保 ConsolidationWorker / decay sweep 会按节拍 drain。
        // 不扫描外部后端，只信任活跃 turn 触发，避免把后端存储变成全局枚举入口。
        this.activeMemoryOwners.add(ownerKey);
        this.scheduler?.noteOwnerTurn(ownerKey);
        this.idle.touch(ownerKey);

        // EQ-01 slice A：若本轮模型同轮在 memoryAction.eq 给出情绪分类，
        // 落 brain.memory_eq_state（latest-only UPSERT）。零字符匹配——
        // runtime 不读消息文本派生 label，只读已规范化的结构化字段。
        this.persistEqFromActions(ownerKey, sourceKeyForMessage(message, context), actions);

        // Scope scaffolding trigger: only model-structured explicit intent can
        // create/update this path; cluster offers stay in the background sweep.
        if (scopeTrigger.kind !== ScopeTriggerKind.None && activeScope) {
            await this.scopeScaffolder.scaffold({
                scopeId: activeScope.id,
                projectDir: activeScope?.projectDir,
                title: deriveProjectTitle(message),
                goal: message.text.slice(0, 500),
                sourceKey: sourceKeyForMessage(message, context),
                trigger: scopeTrigger,
                createdAt: new Date(context.now).toISOString(),
            });
        }
        // Scope 候选 offer 生命周期：显式触发即消费，否则 ttl-1。
        await this.noteScopeOfferTurn(ownerKey, scopeTrigger.kind !== ScopeTriggerKind.None);

        // 技能候选 offer 生命周期：用户在本轮回复中明确同意（skillPromotionIntent ≥ 0.7）即
        // 立即从 pending_skill_offer 生成 SKILL.md；否则 ttl-1。完全与 scope offer 解耦。
        const skillTrigger = this.scopeTriggerDetector.detectExplicitSkillIntent(actions);
        if (skillTrigger.kind !== ScopeTriggerKind.None) {
            await this.consumeSkillOffer(ownerKey);
        } else {
            await this.noteSkillOfferTurn(ownerKey, false);
        }

        this.rememberAssistantForFocus(message, reply.text, context);
        const candidates = actions
            .map((action) =>
                candidateFromAction(
                    action,
                    message,
                    reply,
                    context,
                    memoryScopeId,
                    turnEpisodeId(message, context),
                    this.config.memory.weights,
                    this.matrix,
                ),
            )
            .slice(0, this.config.memory.candidates.maxCandidatesPerTurn);

        // 三路并行：candidate 写入 / scope-local memory / crystal 记录，任一失败都向上抛出。
        const scopeMemoryPipeline =
            activeScope
                ? this.scopeMemoryForScope(activeScope).recordTurn({
                      message,
                      reply,
                      context,
                      trigger:
                          scopeTrigger.kind !== ScopeTriggerKind.None
                              ? scopeTrigger
                              : {
                                    kind: ScopeTriggerKind.ExplicitScope,
                                    score: 1,
                                    relatedIds: scopeConstraintId ? [scopeConstraintId] : [],
                                    rationale: "active-scope",
                                },
                      candidates,
                      scopeId: memoryScopeId,
                  })
                : Promise.resolve([]);
        const candidatePipeline = Promise.all(
            candidates.map(async (candidate) => {
                await this.sqlite.addCandidate(candidate);
                if (!this.config.memory.candidates.autoPromoteExplicit) {
                    return undefined;
                }
                const promotedAt = context.now;
                const record = await this.markdown.promoteCandidate(candidate, promotedAt);
                await Promise.all([
                    this.sqlite.markCandidatePromoted(candidate.id, promotedAt),
                    this.sqlite.addSearchRecord(record),
                ]);
                return record;
            }),
        );

        const [candidateResults, scopeRecords] = await Promise.all([candidatePipeline, scopeMemoryPipeline]);
        const promoted: MemoryRecord[] = candidateResults.filter((r): r is MemoryRecord => r !== undefined);
        const promotedRecords = [...promoted, ...scopeRecords];

        await this.crystal.recordTurn({
            requestId: context.requestId,
            now: context.now,
            candidates,
            promoted: promotedRecords,
            historyEntries: [],
            reflectionCandidates: [],
        });

        this.events.publish(
            event(
                RuntimeEventType.MemoryTurnRecorded,
                {
                    candidates: candidates.length,
                    brain: true,
                    scopeConstraintId: memoryScopeId,
                    scopePromoted: scopeRecords.length,
                    promoted: promotedRecords.length,
                },
                context.requestId,
            ),
        );

        return {
            candidates,
            promoted: promotedRecords,
        };
    }

    /**
     * 反思入口：由 RuntimeModule 调用。
     * 失败发布 MemoryReflectionFailed 事件后继续抛出。
     */
    public async applyReflection(candidates: CrystalCandidateInput[], context: RuntimeContext): Promise<void> {
        if (!this.config.memory.enabled || candidates.length === 0) return;
        try {
            await this.crystal.recordTurn({
                requestId: context.requestId,
                now: context.now,
                candidates: [],
                promoted: [],
                historyEntries: [],
                reflectionCandidates: candidates,
            });
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryReflectionFailed, { error: String(err) }, context.requestId),
            );
            throw err;
        }
    }

    /**
     * 黑板辩论收敛后由 RuntimeModule 调用，将整轮辩论沉淀为工作记忆 episode；
     * sourceKind=blackboard-converged，weight 0.8（高于普通对话）。
     * 失败发布事件后继续抛出。
     */
    public async recordDebateEpisode(input: {
        ownerKey?: string;
        sourceKey: string;
        text: string;
        embedding?: number[];
        requestId?: string;
    }): Promise<void> {
        if (!this.workingMemory) return;
        try {
            const importance = 0.8;
            const stability = 0.9;
            const ttlSeconds = Math.max(
                300,
                Math.floor(this.workingMemoryDefaultTtlSeconds * (0.5 + importance)),
            );
            const embedding =
                input.embedding && input.embedding.length > 0
                    ? input.embedding
                    : await this.embeddings.embed(input.text);
            const episodeId = crypto.randomUUID();
            const ownerKey = input.ownerKey ?? `source:${input.sourceKey}`;
            await this.workingMemory.writeEpisode({
                ownerKey,
                episodeId,
                text: input.text.slice(0, 2048),
                concepts: [],
                embedding,
                importance,
                stability,
                sourceKind: MemorySourceKind.BlackboardConverged,
                createdAt: Date.now(),
                ttlSeconds,
            });
            this.events.publish(
                event(
                    RuntimeEventType.MemoryEpisodeWritten,
                    { episodeId, importance, ttlSeconds, sourceKind: MemorySourceKind.BlackboardConverged },
                    input.requestId,
                ),
            );
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryReflectionFailed,
                    { stage: "debate-episode", error: String(err) },
                    input.requestId,
                ),
            );
            throw err;
        }
    }

    /**
     * Apply a feedback classification produced by feedback.interpreter.
     * Routes (零字符串匹配；仅在 enum 上分发)：
     *   - LocalCorrection → 高重要度 episode（带 correction 标记）写入工作记忆 Component；
     *   - Preference      → user.md 追加 (managed block)；
     *   - GlobalStrategy  → self.md 追加 (managed block)；
     *   - Confirmation    → 仅发事件，由 reinforce 通道（ConsolidationWorker）拾取；
     *   - None            → no-op。
     * 失败发事件后继续抛出。
     */
    public async applyFeedback(input: {
        ownerKey?: string;
        sourceKey: string;
        category: FeedbackCategory;
        extractedFact?: string;
        previousAssistantText: string;
        currentUserText: string;
        recordedAt: string;
        requestId?: string;
    }): Promise<void> {
        if (!this.config.memory.enabled) return;
        if (input.category === FeedbackCategory.None) return;
        const fact = (input.extractedFact ?? input.currentUserText).slice(0, 500);
        try {
            const ownerKey = input.ownerKey ?? `source:${input.sourceKey}`;
            if (input.category === FeedbackCategory.LocalCorrection && this.workingMemory) {
                const embedding = await this.embeddings.embed(input.currentUserText);
                await this.workingMemory.writeEpisode({
                    ownerKey,
                    episodeId: crypto.randomUUID(),
                    text: `correction: ${fact} (was: ${input.previousAssistantText.slice(0, 256)})`,
                    concepts: ["correction"],
                    embedding,
                    importance: 0.9,
                    stability: 0.95,
                    sourceKind: MemorySourceKind.UserFeedback,
                    createdAt: Date.now(),
                    ttlSeconds: this.workingMemoryDefaultTtlSeconds,
                });
            } else if (input.category === FeedbackCategory.Preference) {
                await this.markdown.appendFeedback(MarkdownMemoryFile.User, fact, input.recordedAt);
            } else if (input.category === FeedbackCategory.GlobalStrategy) {
                await this.markdown.appendFeedback(MarkdownMemoryFile.Self, fact, input.recordedAt);
            } else if (input.category === FeedbackCategory.Confirmation) {
                // Confirmation：用户明确确认上一轮答案有效。
                // 1) 工作记忆 Component 写一条高稳定性 episode（concept=confirmation，便于召回时识别正反馈）；
                // 2) 若晶体图 Component 装配了，用 previousAssistantText 的 embedding 做 ANN top-1
                //    召回最相关的 gem/memory_node，调用 applyMemoryReinforce 提升 importance + 刷 lastVerifiedAt。
                if (this.workingMemory) {
                    const embedding = await this.embeddings.embed(input.previousAssistantText);
                    await this.workingMemory.writeEpisode({
                        ownerKey,
                        episodeId: crypto.randomUUID(),
                        text: `confirmation: ${fact} (about: ${input.previousAssistantText.slice(0, 256)})`,
                        concepts: ["confirmation"],
                        embedding,
                        importance: 0.85,
                        stability: 0.9,
                        sourceKind: MemorySourceKind.UserFeedback,
                        createdAt: Date.now(),
                        ttlSeconds: this.workingMemoryDefaultTtlSeconds,
                    });
                    if (this.graph) {
                        const top = await this.graph.recallMemoryNodes({ ownerKey, embedding, limit: 1 });
                        const candidate = top[0];
                        const score = (candidate as { score?: number } | undefined)?.score ?? 0;
                        if (candidate && score >= 0.75) {
                            await this.graph.applyMemoryReinforce({
                                table: "memory_node",
                                id: candidate.id,
                                importanceMultiplier: 1.2,
                                nowMs: Date.now(),
                            });
                        }
                    }
                }
            }
            this.recordBehaviorCorrection({
                ownerKey,
                sourceKey: input.sourceKey,
                category: input.category,
                extractedFact: input.extractedFact,
                currentUserText: input.currentUserText,
                previousAssistantText: input.previousAssistantText,
                requestId: input.requestId,
            });
            this.events.publish(
                event(
                    RuntimeEventType.MemoryFeedbackClassified,
                    { sourceKey: input.sourceKey, ownerKey, category: input.category, hasFact: Boolean(input.extractedFact) },
                    input.requestId,
                ),
            );
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryFeedbackFailed,
                    { sourceKey: input.sourceKey, category: input.category, error: String(err) },
                    input.requestId,
                ),
            );
            throw err;
        }
    }

    /**
     * 反馈分类入口（fire-and-forget）。Runtime 在主回答返回后调用：
     *   1. 从当前 focus 的短期 assistant 滑窗取上一轮 assistant 文本；
     *   2. 喂给 LLM 结构化分类（feedback.interpreter）；
     *   3. 按 enum 分发给 applyFeedback。
     * 没有 model 或没有上一轮 assistant 文本时直接返回。
     */
    public async classifyAndApplyFeedback(message: GatewayMessage, context: RuntimeContext): Promise<void> {
        if (!this.model || !this.config.memory.enabled) return;
        try {
            const previousAssistantText = this.assistantMemoryByFocus.get(focusKeyForMessage(message, context))?.previous;
            if (!previousAssistantText) return;
            const classification = await classifyFeedback(this.model, {
                previousAssistantText,
                currentUserText: message.text,
            });
            if (classification.category === FeedbackCategory.None) {
                this.events.publish(
                    event(
                        RuntimeEventType.MemoryFeedbackClassified,
                        { sourceKey: sourceKeyForMessage(message, context), category: classification.category, hasFact: false },
                        context.requestId,
                    ),
                );
                return;
            }
            await this.applyFeedback({
                ownerKey: continuityOwnerKey(message, context),
                sourceKey: sourceKeyForMessage(message, context),
                category: classification.category,
                extractedFact: classification.extractedFact,
                previousAssistantText,
                currentUserText: message.text,
                recordedAt: new Date(context.now).toISOString(),
                requestId: context.requestId,
            });
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryFeedbackFailed,
                    { sourceKey: sourceKeyForMessage(message, context), stage: "classify", error: String(err) },
                    context.requestId,
                ),
            );
            throw err;
        }
    }

    /**
     * LF-R11：把用户后续纠正 / 确认挂到上一条 behavior-snapshot 上。
     * 注意：反馈分类在当前 turn 完成后异步运行，此时当前 turn 的 snapshot
     * 已经写入，所以这里显式排除当前 requestId，避免把"纠正上一轮"挂错。
     */
    private recordBehaviorCorrection(input: {
        ownerKey: string;
        sourceKey: string;
        category: FeedbackCategory;
        extractedFact?: string;
        currentUserText: string;
        previousAssistantText: string;
        requestId?: string;
    }): string | null {
        if (!this.brainOpened) return null;
        const snapshot = this.findLatestBehaviorSnapshot(input.ownerKey, input.requestId);
        if (!snapshot) return null;
        const eventId = `behavior-correction-${crypto.randomUUID()}`;
        const content: BehaviorCorrectionContent = {
            snapshotId: snapshot.id,
            requestId: input.requestId,
            category: input.category,
            hasFact: Boolean(input.extractedFact),
            ...(input.extractedFact ? { factPreview: compactText(input.extractedFact, 500) } : {}),
            currentUserTextPreview: compactText(input.currentUserText, 500),
            previousAssistantTextPreview: compactText(input.previousAssistantText, 500),
        };
        try {
            this.brain.appendEvent({
                id: eventId,
                ts: Date.now(),
                ownerKey: input.ownerKey,
                sourceKey: input.sourceKey,
                sourceSurface: snapshot.sourceSurface,
                codenameId: snapshot.codenameId,
                type: MemoryEventType.BehaviorCorrection,
                role: ModelRole.User,
                content: content as unknown as Record<string, unknown>,
                parentId: snapshot.id,
                importance: input.category === FeedbackCategory.LocalCorrection ? 0.9 : 0.7,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryBehaviorCorrectionRecorded, {
                    eventId,
                    snapshotId: snapshot.id,
                    sourceKey: input.sourceKey,
                    category: input.category,
                    hasFact: Boolean(input.extractedFact),
                }, input.requestId),
            );
            return eventId;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "behavior.correction",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    private findLatestBehaviorSnapshot(ownerKey: string, excludeRequestId?: string): MemoryEventRecord | null {
        if (!this.brainOpened) return null;
        try {
            const rows = this.brain.listEvents({
                ownerKey,
                type: MemoryEventType.BehaviorSnapshot,
                limit: 20,
            });
            return rows.find((row) => {
                const content = row.content as Partial<BehaviorSnapshotContent>;
                return !excludeRequestId || content.requestId !== excludeRequestId;
            }) ?? null;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "behavior.findLatest",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    // ───── 内部 ──────────────────────────────────────────────────────

    private rememberAssistantForFocus(message: GatewayMessage, assistantText: string, context: RuntimeContext): void {
        const key = focusKeyForMessage(message, context);
        const existing = this.assistantMemoryByFocus.get(key);
        this.assistantMemoryByFocus.set(key, {
            current: assistantText,
            previous: existing?.current,
        });
    }

    /**
     * brain.db 是生命事件事实层：每轮写 `memory_events`，并把模型同轮结构化
     * memory action 派生的 prompt atom 一并封进 event.content.atoms。
     * 旧 journal 只读保留，不再从热路径反向写入。
     */
    private async writeTurnToBrain(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        actions: MemoryAction[],
        provenance: MemoryEpisodeProvenance,
        scopeConstraintId: string,
        codenameId?: string,
    ): Promise<string> {
        try {
            const normalizedProvenance = normalizeEpisodeProvenance(provenance);
            const episodeId = turnEpisodeId(message, context);
            const createdAt = new Date(context.now).toISOString();
            const embedding =
                actions.length > 0
                    ? context.embedding && context.embedding.length > 0
                        ? context.embedding
                        : await this.embeddings.embed(message.text)
                    : [];
            const atoms = actions.slice(0, this.config.memory.candidates.maxCandidatesPerTurn).map((action, index) => {
                let codenameUseCount = 0;
                if (this.brainOpened && action.codename?.name) {
                    const existing = this.brain.getCodenameByName(action.codename.name);
                    codenameUseCount = existing?.useCount ?? 0;
                }
                return brainAtomFromAction({
                    action,
                    codenameId,
                    embedding,
                    episodeId,
                    index,
                    matrix: this.matrix,
                    message,
                    context,
                    scopeConstraintId,
                    reply,
                    defaultWeights: this.config.memory.weights,
                    scoreWeights: this.config.memory.tuning.atomScore.weights,
                    inboxDecayMultiplier: this.config.memory.tuning.inbox.decayMultiplier,
                    createdAt,
                    codenameUseCount,
                });
            });

            this.writeBrainEvent({
                episodeId,
                message,
                context,
                reply,
                provenance: normalizedProvenance,
                createdAt,
                scopeConstraintId,
                requestId: context.requestId,
                atomIds: atoms.map((entry) => entry.atom.id),
                atoms,
                codenameId,
            });
            return episodeId;

        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryReflectionFailed,
                    { stage: "brain-event-build", error: String(err) },
                    context.requestId,
                ),
            );
            throw err;
        }
    }

    /**
     * LF-R10：把每条 episode 落到 brain.db `memory_events`。
     * prompt recall 直接从 event.content.atoms 展开；brain.db 是唯一热路径写入源。
     */
    private writeBrainEvent(input: {
        episodeId: string;
        message: GatewayMessage;
        context: RuntimeContext;
        reply: GatewayReply;
        provenance: MemoryEpisodeProvenance;
        createdAt: string;
        scopeConstraintId: string;
        requestId: string;
        atomIds: string[];
        atoms: BrainPromptAtomWrite[];
        codenameId?: string;
    }): void {
        if (!this.brainOpened) {
            throw new Error(`Cannot write brain event ${input.episodeId}: brain.db is not opened.`);
        }
        const ts = Date.parse(input.createdAt);
        const tsValue = Number.isFinite(ts) ? ts : Date.now();
        try {
            this.brain.appendEvent({
                id: input.episodeId,
                ts: tsValue,
                ownerKey: input.scopeConstraintId,
                sourceKey: sourceKeyForMessage(input.message, input.context),
                sourceSurface: sourceSurfaceForMessage(input.message),
                codenameId: input.codenameId ?? input.scopeConstraintId,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {
                    userText: input.message.text,
                    assistantText: input.reply.text,
                    provenance: input.provenance,
                    atomIds: input.atomIds,
                    atoms: input.atoms.map((entry) => ({
                        atom: entry.atom,
                        score: entry.score,
                    })),
                },
                importance: 0.5,
            });
            this.events.publish(
                event(
                    RuntimeEventType.MemoryBrainEventWritten,
                    {
                        episodeId: input.episodeId,
                        codenameId: input.codenameId ?? input.scopeConstraintId,
                        atoms: input.atoms.length,
                    },
                    input.requestId,
                ),
            );
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryBrainWriteFailed,
                    { stage: "brain-event-write", error: String(err), episodeId: input.episodeId },
                    input.requestId,
                ),
            );
            throw err;
        }
    }

    /**
     * LF-R2: persist any codename anchors emitted by the model in this turn's
     * memory actions. Returns the first codename id (used to tag the brain
     * event). All identification is model-driven; runtime never inspects user
     * text for `@xxx` (zero-character-match red line).
     */
    private persistCodenamesFromActions(
        actions: MemoryAction[],
        createdAt: string,
    ): string | undefined {
        if (!this.brainOpened) return undefined;
        const ts = Date.parse(createdAt);
        const nowMs = Number.isFinite(ts) ? ts : Date.now();
        let firstId: string | undefined;
        for (const action of actions) {
            const codename = action.codename;
            if (!codename) continue;
            try {
                const existing = this.brain.getCodenameByName(codename.name);
                if (existing) {
                    this.brain.touchCodename(existing.id, nowMs);
                    firstId = firstId ?? existing.id;
                    const refreshed = this.brain.getCodename(existing.id);
                    this.events.publish(
                        event(RuntimeEventType.MemoryCodenameTouched, {
                            id: existing.id,
                            name: existing.name,
                            useCount: refreshed?.useCount ?? existing.useCount + 1,
                        }),
                    );
                    if (refreshed) void this.maybePromoteCodename(refreshed, createdAt);
                    continue;
                }
                const id = `cn-${crypto.randomUUID()}`;
                const record = this.brain.upsertCodename({
                    id,
                    name: codename.name,
                    workingDir: codename.workingDir,
                    description: codename.description,
                    createdAt: nowMs,
                    lastUsedAt: nowMs,
                    useCount: 1,
                });
                firstId = firstId ?? record.id;
                this.events.publish(
                    event(RuntimeEventType.MemoryCodenameCreated, {
                        id: record.id,
                        name: record.name,
                        workingDir: record.workingDir,
                    }),
                );
            } catch (err) {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "codename.persist",
                        message: err instanceof Error ? err.message : String(err),
                    }),
                );
                throw err;
            }
        }
        return firstId;
    }

    /**
     * EQ-01 slice A：把同轮 memoryAction.eq 落到 brain.memory_eq_state（latest-only UPSERT）。
     * 零字符匹配——只读结构化字段，runtime 严禁基于消息文本派生 label。
     */
    private persistEqFromActions(ownerKey: string, sourceKey: string, actions: MemoryAction[]): void {
        if (!this.brainOpened) return;
        let last: EqClassification | undefined;
        for (const action of actions) {
            const candidate = normalizeEqClassification(action.eq);
            if (candidate) last = candidate;
        }
        if (!last) return;
        try {
            const updatedAt = Date.now();
            this.brain.upsertEqState({
                ownerKey,
                sourceKey,
                valence: last.valence,
                arousal: last.arousal,
                dominance: last.dominance,
                label: last.label,
                confidence: last.confidence,
                updatedAt,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryEqStateUpdated, {
                    ownerKey,
                    sourceKey,
                    label: last.label,
                    valence: last.valence,
                    arousal: last.arousal,
                    confidence: last.confidence,
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "eq.persist",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R2: codename 升格通路。useCount + age 满足阈值且尚未绑定 scopeId 时，
     * 调用 ScopeScaffolder 在 workspace/scopes/<scopeId>/ 生成骨架，并把
     * scopeId 写回 codenames 表。完全幂等；失败发事件后抛出。
     */
    public async promoteCodename(
        codenameId: string,
        opts: { force?: boolean; createdAt?: string } = {},
    ): Promise<{ promoted: boolean; scopeId?: string; rationale: string }> {
        if (!this.brainOpened) return { promoted: false, rationale: "brain-closed" };
        try {
            const result = await this.codenamePromotion.promote(this.brain, this.scopeScaffolder, codenameId, opts);
            if (result.promoted && result.record && result.scopeId) {
                this.events.publish(
                    event(RuntimeEventType.MemoryCodenamePromoted, {
                        id: result.record.id,
                        name: result.record.name,
                        scopeId: result.scopeId,
                        useCount: result.record.useCount,
                    }),
                );
            }
            return { promoted: result.promoted, scopeId: result.scopeId, rationale: result.rationale };
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryCodenamePromotionFailed, {
                    id: codenameId,
                    error: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    private async maybePromoteCodename(record: CodenameRecord, createdAt: string): Promise<void> {
        if (record.scopeId) return;
        await this.promoteCodename(record.id, { createdAt });
    }

    /**
     * Explicit scope entry point for local apps (`/project`).
     * The path comes from the command protocol, not language understanding, and
     * the returned record must be passed back as RuntimeContext.activeScope on
     * every turn that wants scope-local memory.
     */
    public async createOrUseScope(input: {
        goal?: string;
        path: string;
        sourceKey?: string;
        title?: string;
        now?: number;
    }): Promise<ScopeRecord> {
        await this.ensureBrainOpen("scope.create-or-use");
        const seed = this.contextScope.explicitScopeSeed(input.path);
        const existing = this.brain.getScope(seed.id);
        const nowMs = input.now ?? Date.now();
        const record: ScopeRecord = {
            id: seed.id,
            title: input.title ?? seed.title,
            goal: input.goal,
            projectDir: seed.projectDir,
            projectMemoryDir: seed.projectMemoryDir,
            createdAt: existing?.createdAt ?? nowMs,
            updatedAt: nowMs,
            lastUsedAt: nowMs,
            useCount: (existing?.useCount ?? 0) + 1,
        };
        await this.scopeScaffolder.scaffold({
            scopeId: seed.id,
            projectDir: seed.projectDir,
            title: record.title,
            goal: record.goal ?? `Project scope: ${record.title}`,
            sourceKey: input.sourceKey,
            trigger: {
                kind: ScopeTriggerKind.ExplicitScope,
                score: 1,
                relatedIds: [seed.id],
                rationale: "slash-project",
            },
            createdAt: new Date(nowMs).toISOString(),
        });
        return this.brain.upsertScope(record);
    }

    /** @deprecated Use createOrUseScope. */
    public async createOrUseProject(input: {
        goal?: string;
        path: string;
        sourceKey?: string;
        title?: string;
        now?: number;
    }): Promise<ScopeRecord> {
        return this.createOrUseScope(input);
    }

    public listScopes(_sourceKey: string, options: { limit?: number } = {}): ScopeRecord[] {
        if (!this.brainOpened) return [];
        return this.brain.listScopes({ limit: options.limit ?? 50 });
    }

    public listContextForks(ownerKey: string, options: { limit?: number } = {}): ContextForkRecord[] {
        if (!this.brainOpened) return [];
        return this.brain.listContextForks({ ownerKey, limit: options.limit ?? 50 });
    }

    /**
     * TUI-driven fork creation. The selected history turn supplies only stored
     * event ids and short summaries; no natural-language rule decides whether a
     * fork is needed.
     */
    public async createContextFork(
        record: ContextForkRecord,
        source?: ContextForkStoreSource,
    ): Promise<ContextForkRecord> {
        if (!this.brainOpened) {
            throw new Error("Context fork is unavailable because brain.db is not opened.");
        }
        const written = this.brain.writeContextFork(record);
        await this.contextForkStore.writeFork(written, source);
        return written;
    }

    public cleanupContextForkSidecars(input: { nowMs?: number; ttlDays: number }): Promise<{ removed: number }> {
        return this.contextForkStore.cleanupExpired(input);
    }

    // ─── LF-R3 Ask 一等公民 ────────────────────────────────────────

    /**
     * Runtime 用来查询当前 owner 是否有未答复的 ask、对应链深度。
     * 用于 cap enforcement：模型若要继续 ask 而 chainDepth+1 > maxChainDepth，
     * runtime 抛弃 ask 改走 reply。零字符匹配。
     */
    public peekActiveAsk(ownerKey: string): { askId: string; chainDepth: number; ask: AgentAsk } | null {
        const pending = this.findPendingAsk(ownerKey);
        if (!pending) return null;
        return { askId: pending.id, chainDepth: pending.chainDepth, ask: pending.ask };
    }

    public listChatHistory(options: { beforeTs?: number; limit?: number } = {}): ChatHistoryTurn[] {
        if (!this.config.memory.enabled) {
            throw new Error("Chat history is unavailable because memory is disabled.");
        }
        if (!this.brainOpened) {
            throw new Error("Chat history is unavailable because brain.db is not opened.");
        }
        const rows = this.brain.listEvents({
            type: MemoryEventType.Event,
            untilTs: options.beforeTs,
            limit: options.limit ?? 20,
        });
        return rows.map((row) => historyTurnFromEvent(row, this.historyPlanningForEvent(row.id))).reverse();
    }

    /**
     * Planning/fork/history write path. The semantic decision comes from model
     * protocol blocks or blackboard structured output; this component only
     * attaches source ids and stores summary records in brain.db.
     */
    public recordTurnPlanning(input: TurnPlanningInput & {
        ownerKey: string;
        blackboardTurnId?: string;
        sourceKey: string;
        requestId?: string;
        sourceAskId?: string;
        sourceEventId: string;
    }): void {
        if (!this.brainOpened) return;
        const withSourcePlan = (plan: TaskPlanRecord): TaskPlanRecord => ({
            ...plan,
            ownerKey: input.ownerKey,
            sourceKey: input.sourceKey,
            sourceAskId: plan.sourceAskId ?? input.sourceAskId,
            sourceBlackboardTurnId: plan.sourceBlackboardTurnId ?? input.blackboardTurnId,
            sourceEventId: plan.sourceEventId ?? input.sourceEventId,
        });
        const withSourceFork = (fork: ContextForkRecord): ContextForkRecord => ({
            ...fork,
            ownerKey: input.ownerKey,
            sourceKey: input.sourceKey,
            sourceAskId: fork.sourceAskId ?? input.sourceAskId,
            sourceBlackboardTurnId: fork.sourceBlackboardTurnId ?? input.blackboardTurnId,
            sourceEventId: fork.sourceEventId ?? input.sourceEventId,
            inheritedEventIds: uniqueStrings([input.sourceEventId, ...fork.inheritedEventIds]),
        });
        const withSourceReplay = (replay: ReplayRecord): ReplayRecord => ({
            ...replay,
            ownerKey: input.ownerKey,
            sourceKey: input.sourceKey,
            blackboardTurnId: replay.blackboardTurnId ?? input.blackboardTurnId,
            sourceEventId: replay.sourceEventId ?? input.sourceEventId,
        });
        try {
            for (const plan of (input.taskPlans ?? []).slice(0, 4).map(withSourcePlan)) {
                this.brain.writeTaskPlan(plan);
                this.events.publish(
                    event(RuntimeEventType.MemoryTaskPlanWritten, {
                        planId: plan.id,
                        ownerKey: input.ownerKey,
                        sourceKey: input.sourceKey,
                        status: plan.status,
                        progress: plan.progress,
                    }, input.requestId),
                );
            }
            for (const fork of (input.contextForks ?? []).slice(0, 4).map(withSourceFork)) {
                this.brain.writeContextFork(fork);
                this.events.publish(
                    event(RuntimeEventType.MemoryContextForkWritten, {
                        forkId: fork.id,
                        ownerKey: input.ownerKey,
                        sourceKey: input.sourceKey,
                        maxContextTokens: fork.maxContextTokens,
                    }, input.requestId),
                );
            }
            for (const replay of (input.replayRecords ?? []).slice(0, 8).map(withSourceReplay)) {
                this.brain.writeReplayRecord(replay);
                this.events.publish(
                    event(RuntimeEventType.MemoryReplayRecordWritten, {
                        replayId: replay.id,
                        ownerKey: input.ownerKey,
                        sourceKey: input.sourceKey,
                        kind: replay.kind,
                        blackboardTurnId: replay.blackboardTurnId,
                    }, input.requestId),
                );
            }
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "planning.write",
                    message: err instanceof Error ? err.message : String(err),
                }, input.requestId),
            );
            throw err;
        }
    }

    private historyPlanningForEvent(sourceEventId: string): ChatHistoryPlanning {
        return {
            contextForks: this.brain.listContextForks({ sourceEventId, limit: 8 }),
            replays: this.brain.listReplayRecords({ sourceEventId, limit: 16 }),
            taskPlans: this.brain.listTaskPlans({ sourceEventId, limit: 8 }),
        };
    }

    /**
     * EQ-01 slice C：EQ 的唯一读路径。返回已 decay 的最新状态（资源指标 dt = now - updatedAt）。
     * 零字符匹配——只读 brain 行 + 数字衰减，不基于消息文本派生 label。
     * 没有 state 或 brain 未开则返回 null（只作为语气提示；不参与路由、工具或 ask 决策）。
     */
    public peekEqState(ownerKey: string, nowMs: number = Date.now()): EqState | null {
        if (!this.brainOpened) return null;
        try {
            const state = this.brain.getEqState(ownerKey);
            if (!state) return null;
            return decayEq(state, nowMs);
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "eq.peek",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** brain 缺失时返回 null；读库失败时抛错。 */
    private findPendingAsk(
        ownerKey: string,
    ): { id: string; chainDepth: number; ask: AgentAsk; snapshotId?: string } | null {
        if (!this.brainOpened) return null;
        try {
            const row = this.brain.getLatestPendingAsk(ownerKey);
            if (!row) return null;
            const content = row.content as Partial<AskEventContent> | undefined;
            const ask = content?.ask as AgentAsk | undefined;
            if (!ask) return null;
            const chainDepth = typeof content?.chainDepth === "number" ? content.chainDepth : 1;
            const snapshotId = typeof content?.snapshotId === "string" ? content.snapshotId : undefined;
            return { id: row.id, chainDepth, ask, snapshotId };
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ask.findPending",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R8：若该 owner 上一轮被 sweep 进 Idle，把 idle 时长以 `[runtime-resume]`
     * 块注入 prompt 顶部。零字符匹配——只读 idle supervisor 的资源指标。
     */
    private renderIdleResumeBlock(ownerKey: string): string | undefined {
        const hint = this.idle.peekResumeHint(ownerKey);
        if (!hint) return undefined;
        const idleMinutes = Math.max(1, Math.round(hint.idleMs / 60000));
        const idleHours = idleMinutes / 60;
        const bucket = idleMinutes < 60
            ? `${idleMinutes}m`
            : idleHours < 48
                ? `${idleHours.toFixed(1)}h`
                : `${(idleHours / 24).toFixed(1)}d`;
        return renderRuntimeIdleResumePrompt({ idleBucket: bucket });
    }

    /**
     * EQ-01 slice B：把 brain.memory_eq_state 中的最新情绪状态渲染为 `[eq-context]` 块。
     * - decay 在读时计算（资源指标 dt = now - updatedAt），label / dominance 不衰减；
     * - 衰减后 |valence| < 0.05 且 arousal < 0.05 时视为已平复，跳过注入（避免噪音）；
     * - 注入内容只包含结构化字段（label、衰减后 valence/arousal/dominance、confidence、age 分桶）；
     * - 只用于语气、暖度和节奏提示，不参与路由、工具选择、问答链深度或其他决策。
     */
    private renderEqContextBlock(ownerKey: string): string | undefined {
        if (!this.brainOpened) return undefined;
        let state: EqState | null;
        try {
            state = this.brain.getEqState(ownerKey);
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "eq.render",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
        if (!state) return undefined;
        const now = Date.now();
        const decayed = decayEq(state, now);
        if (Math.abs(decayed.valence) < 0.05 && decayed.arousal < 0.05) return undefined;
        const ageMs = Math.max(0, now - state.updatedAt);
        const ageMinutes = ageMs / 60_000;
        const ageBucket = ageMinutes < 60
            ? `${Math.max(1, Math.round(ageMinutes))}m`
            : ageMinutes < 60 * 48
                ? `${(ageMinutes / 60).toFixed(1)}h`
                : `${(ageMinutes / 1440).toFixed(1)}d`;
        return renderRuntimeEqContextPrompt({
            ageBucket,
            arousal: decayed.arousal.toFixed(2),
            confidence: decayed.confidence.toFixed(2),
            directive: this.renderEqDirectiveLine(deriveEqDirective(decayed)),
            dominance: decayed.dominance.toFixed(2),
            label: decayed.label,
            valence: decayed.valence.toFixed(2),
        });
    }

    /**
     * 把 pending ask 拼成可注入 prompt 的 [continuation] 块。零字符匹配——
     * 是否注入只看 brain 是否存在 pending ask，runtime 不做任何文本判断。
     */
    private renderPendingAskContinuation(ownerKey: string): string | undefined {
        const pending = this.findPendingAsk(ownerKey);
        if (!pending) return undefined;
        const ask = pending.ask;
        const choices: string[] = [];
        if (ask.choices && ask.choices.length > 0) {
            choices.push("Choices you offered:");
            for (const c of ask.choices.slice(0, 8)) {
                choices.push(`- ${c.label}${c.value ? ` (value=${c.value})` : ""}`);
            }
        }
        return renderRuntimeAskContinuationPrompt({
            chainDepth: String(pending.chainDepth),
            choices: choices.join("\n"),
            prompt: ask.prompt.replace(/\n+/g, " ").slice(0, 600),
            reason: ask.reason,
        });
    }

    /**
     * LF-R4：把活跃的高分 continuation-context 渲染为 `[continuation-hint]` 块。仅按
     * decayScore 资源指标排序（不解析任何文本语义），最多展示 3 条。pending ask
     * 的 sibling continuation 已通过 `[continuation]` 单独注入，这里跳过避免重复。
     *
     * 模型可显式输出 `<flyflor_continuation_decisions>`，由 `applyContinuationDecisions`
     * 落库处理 `fork` / `fresh` / `resume`；这里不从自然语言推断分支关系。
     */
    private renderContinuationHint(ownerKey: string): string | undefined {
        if (!this.brainOpened) return undefined;
        let continuations: MemoryEventRecord[];
        try {
            continuations = this.brain.listActiveContinuations(ownerKey, { limit: 12 });
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.render",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
        if (continuations.length === 0) return undefined;

        const pending = this.findPendingAsk(ownerKey);
        const pendingAskId = pending?.id;
        const weightTable = this.config.memory.tuning.continuation.evidenceWeight;

        type Scored = { row: MemoryEventRecord; score: number; tag: string };
        const scored: Scored[] = [];
        for (const row of continuations) {
            if (pendingAskId && row.parentId === pendingAskId) continue;
            const state = this.brain.getState(row.id);
            const base = state?.decayScore ?? 1;
            const { weight, tag } = this.resolveContinuationEvidenceWeight(row, weightTable);
            const score = base * weight;
            const threshold = this.config.memory.tuning.atomScore.visibilityThreshold ?? 0;
            if (score < threshold) continue;
            scored.push({ row, score, tag });
        }
        if (scored.length === 0) return undefined;
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 3);

        const entries: string[] = [];
        for (const { row, score, tag } of top) {
            const c = row.content as Partial<ContinuationContextEventContent>;
            const title = c.userFacing?.title?.slice(0, 120) ?? `continuation:${c.reason ?? "unknown"}`;
            const hint = c.userFacing?.contextHint?.slice(0, 200);
            const ageHours = Math.max(0, Math.round((Date.now() - row.ts) / 36e5));
            entries.push(
                `- id=${row.id} reason=${c.reason ?? "-"} evidence=${tag} score=${score.toFixed(2)} age=${ageHours}h :: ${title}${hint ? ` (${hint})` : ""}`,
            );
        }
        return renderRuntimeContinuationHintPrompt({ continuationEntries: entries.join("\n") });
    }

    private renderContextForkBlock(contextForkId: string | undefined): string | undefined {
        if (!this.brainOpened || !contextForkId) return undefined;
        const fork = this.brain.getContextFork(contextForkId);
        if (!fork) return undefined;
        return [
            "[context-fork]",
            `id: ${fork.id}`,
            `title: ${fork.title}`,
            `scope: ${fork.continuitySummary}`,
            `budget: ${fork.maxContextTokens} tokens`,
            `inheritedEvents: ${fork.inheritedEventIds.slice(0, 12).join(", ")}`,
            "[/context-fork]",
        ].join("\n");
    }

    /**
     * LF-R5：把当前 live identity append 渲染为 `[identity]` 块。仅根据 brain 的状态层
     * （`status='live'`）过滤；runtime 不读 content 文本派生 kind / 排序。
     * 单条 content 来自模型已结构化截断的 `<=240` 字段；整块再做长度上限保护（约 1200 字）。
     */
    private renderIdentityBlock(ownerKey: string): string | undefined {
        if (!this.brainOpened) return undefined;
        let rows: MemoryEventRecord[];
        try {
            rows = this.brain.listActiveIdentity(ownerKey, { limit: 16 });
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "identity.render",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
        if (rows.length === 0) return undefined;
        const entries: string[] = [];
        let budget = 1200;
        for (const row of rows) {
            const c = row.content as Partial<IdentityEventContent>;
            const kind = typeof c.kind === "string" ? c.kind : "other";
            const content = typeof c.content === "string" ? c.content : "";
            if (!content) continue;
            const line = `- (${kind}) ${content}`;
            if (line.length > budget) break;
            entries.push(line);
            budget -= line.length + 1;
        }
        if (entries.length === 0) return undefined;
        return renderRuntimeIdentityContextPrompt({ identityEntries: entries.join("\n") });
    }

    /**
     * LF-R4 evidence weight：根据 continuation 当前结构化状态选权重。
     * - state.status === 'abandoned' → 0（不应出现在 listActiveContinuations，但兜底）
     * - content.continuationCompleted === true（模型已在某轮标记 fork/fresh）→ continuationCompleted（0.75）
     * - sibling ask 已收到答复（存在 ask-answer-pair 事件）→ askAnswered（0.85）
     * - 其它 → default
     * 仅消费结构化字段（state.status + content flag + parent_id + 子事件类型），
     * 不解析任何对话文本。
     */
    private resolveContinuationEvidenceWeight(
        row: MemoryEventRecord,
        table: typeof this.config.memory.tuning.continuation.evidenceWeight,
    ): { weight: number; tag: string } {
        const state = this.brain.getState(row.id);
        if (state?.status === MemoryEventStatus.Abandoned) {
            return { weight: table.abandoned, tag: "abandoned" };
        }
        const c = row.content as Partial<ContinuationContextEventContent>;
        if (c.continuationCompleted === true) {
            return { weight: table.continuationCompleted, tag: "continuation-completed" };
        }
        if (row.parentId) {
            const parent = this.brain.getEvent(row.parentId);
            if (parent && parent.type === MemoryEventType.Ask && this.brain.hasAskBeenAnswered(row.parentId)) {
                return { weight: table.askAnswered, tag: "ask-answered" };
            }
        }
        return { weight: table.default, tag: "default" };
    }

    private recordAskAnswerPair(
        askEventId: string,
        snapshotId: string | undefined,
        message: GatewayMessage,
        context: RuntimeContext,
        ownerKey: string,
    ): void {
        if (!this.brainOpened) return;
        const ts = Date.parse(message.receivedAt);
        const nowMs = Number.isFinite(ts) ? ts : Date.now();
        const content: AskAnswerPairContent = {
            askId: askEventId,
            snapshotId: snapshotId ?? `behavior-${message.id}`,
            answerText: message.text.slice(0, 4000),
            answerMessageId: message.id,
        };
        try {
            this.brain.appendEvent({
                id: `ask-ans-${crypto.randomUUID()}`,
                ts: nowMs,
                ownerKey,
                sourceKey: sourceKeyForMessage(message, context),
                sourceSurface: sourceSurfaceForMessage(message),
                type: MemoryEventType.AskAnswerPair,
                content: content as unknown as Record<string, unknown>,
                parentId: askEventId,
                importance: 0.85,
            });
            this.brain.upsertState(askEventId, { status: MemoryEventStatus.Resumed, resumedAt: nowMs });
            this.events.publish(
                event(RuntimeEventType.MemoryAskAnswered, {
                    askEventId,
                    snapshotId: content.snapshotId,
                    sourceKey: sourceKeyForMessage(message, context),
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ask.answer",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    private recordAskEvent(
        message: GatewayMessage,
        context: RuntimeContext,
        ask: AgentAsk,
        parentAskId: string | undefined,
        behaviorSnapshotId?: string,
    ): string | undefined {
        if (!this.brainOpened) return undefined;
        const ts = Date.parse(context.now);
        const nowMs = Number.isFinite(ts) ? ts : Date.now();
        const askId = `ask-${crypto.randomUUID()}`;
        const chainDepth = parentAskId ? this.brain.countAskChainDepth(parentAskId) + 1 : 1;
        const maxChainDepth = Math.max(1, this.config.memory.tuning.continuation.maxChainDepth);
        const snapshotId = behaviorSnapshotId ?? `behavior-${context.requestId ?? message.id}`;
        const content: AskEventContent = {
            askId,
            snapshotId,
            ask,
            requestId: context.requestId,
            chainDepth,
        };
        try {
            this.brain.appendEvent({
                id: askId,
                ts: nowMs,
                ownerKey: continuityOwnerKey(message, context),
                sourceKey: sourceKeyForMessage(message, context),
                sourceSurface: sourceSurfaceForMessage(message),
                type: MemoryEventType.Ask,
                content: content as unknown as Record<string, unknown>,
                parentId: parentAskId,
                importance: 0.9,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryAskRecorded, {
                    askEventId: askId,
                    snapshotId,
                    sourceKey: sourceKeyForMessage(message, context),
                    reason: ask.reason,
                    chainDepth,
                }),
            );
            if (chainDepth > maxChainDepth) {
                this.events.publish(
                    event(RuntimeEventType.MemoryAskChainCapped, {
                        askEventId: askId,
                        sourceKey: sourceKeyForMessage(message, context),
                        chainDepth,
                        maxChainDepth,
                    }),
                );
            }
            // LF-R4：每条 ask 同步写一条 continuation-context 事件（parent_id 指向 ask），
            // 用户可见 + 可 resume / drop / pin。userFacing.title 缺省 fallback 到
            // ask.prompt 首行（短路降级，不算字符匹配——纯结构化字段）。
            this.recordContinuationFromAsk({
                askId,
                snapshotId,
                ask,
                message,
                context,
                nowMs,
            });
            return askId;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ask.record",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    // ─── LF-R4 Continuation Context（与 LF-R3 Ask 同根）──────────────────

    /**
     * 列出当前用户的活跃 continuation-context 事件（live/resumed），ts 倒序。
     * `codenameId === null` 显式查询无 codename 的 continuation；`undefined` 不限定。
     */
    public listActiveContinuations(
        ownerKey: string,
        options: { codenameId?: string | null; limit?: number } = {},
    ): MemoryEventRecord[] {
        if (!this.brainOpened) return [];
        try {
            return this.brain.listActiveContinuations(ownerKey, options);
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.list",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** 取单个 continuation 详情；找不到或非 continuation-context 类型则返回 null。 */
    public getContinuation(continuationEventId: string): MemoryEventRecord | null {
        if (!this.brainOpened) return null;
        try {
            const row = this.brain.getEvent(continuationEventId);
            return row?.type === MemoryEventType.ContinuationContext ? row : null;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.get",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** 用户主动 resume：拉回峰值，state=resumed + resumedAt。runtime 后续按 continuation 重建上下文。 */
    public resumeContinuation(continuationEventId: string, nowMs = Date.now()): boolean {
        const continuation = this.getContinuation(continuationEventId);
        if (!continuation) return false;
        try {
            this.brain.upsertState(continuation.id, {
                status: MemoryEventStatus.Resumed,
                resumedAt: nowMs,
                lastAccessed: nowMs,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryContinuationResumed, {
                    continuationEventId: continuation.id,
                    ownerKey: continuation.ownerKey,
                    sourceKey: continuation.sourceKey,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.resume",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** 用户主动 drop：state=abandoned，不再展示，evidence weight=0。 */
    public dropContinuation(continuationEventId: string): boolean {
        const continuation = this.getContinuation(continuationEventId);
        if (!continuation) return false;
        try {
            this.brain.upsertState(continuation.id, { status: MemoryEventStatus.Abandoned });
            this.events.publish(
                event(RuntimeEventType.MemoryContinuationDropped, {
                    continuationEventId: continuation.id,
                    ownerKey: continuation.ownerKey,
                    sourceKey: continuation.sourceKey,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.drop",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * 用户 pin：把 decay_score 半衰期乘以 `tuning.continuation.pinHalflifeMultiplier`（默认 3.0）。
     * 实装层面：直接把 decayScore 上调到 current * multiplier，仍走衰减管道（不冻结）。
     */
    public pinContinuation(continuationEventId: string): boolean {
        const continuation = this.getContinuation(continuationEventId);
        if (!continuation) return false;
        try {
            const state = this.brain.getState(continuation.id);
            const multiplier = Math.max(1, this.config.memory.tuning.continuation.pinHalflifeMultiplier);
            const baseScore = state?.decayScore ?? 1;
            this.brain.upsertState(continuation.id, { decayScore: baseScore * multiplier });
            this.events.publish(
                event(RuntimeEventType.MemoryContinuationPinned, {
                    continuationEventId: continuation.id,
                    ownerKey: continuation.ownerKey,
                    sourceKey: continuation.sourceKey,
                    multiplier,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.pin",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R4 fork/fresh hint：把模型同轮输出的 continuation 决策落库。
     * 仅消费 `{continuationId, kind}` 结构化字段，不读文本语义。
     * - `resume`：调 resumeContinuation（state → resumed）。
     * - `fork` / `fresh`：在 continuation-context content 上挂 `continuationCompleted=true` + `lastKind=kind`，
     *   评分阶段 `resolveContinuationEvidenceWeight` 走 `continuationCompleted` 权重（默认 0.75）。
     * 未命中的 continuationId 视为模型结构化输出引用漂移，跳过该项并继续应用其它决策。
     * 返回成功应用的条数。
     */
    public applyContinuationDecisions(decisions: ContinuationDecision[]): number {
        if (!this.brainOpened || decisions.length === 0) return 0;
        let applied = 0;
        for (const decision of decisions) {
            const continuation = this.getContinuation(decision.continuationId);
            if (!continuation) continue;
            try {
                if (decision.kind === ContinuationDecisionKind.Resume) {
                    if (!this.resumeContinuation(decision.continuationId)) {
                        throw new Error(`Continuation decision resume failed for continuationId: ${decision.continuationId}`);
                    }
                } else {
                    this.brain.patchContinuationContent(decision.continuationId, {
                        continuationCompleted: true,
                        lastKind: decision.kind,
                    });
                }
                applied += 1;
                this.events.publish(
                    event(RuntimeEventType.MemoryContinuationDecisionApplied, {
                        continuationEventId: decision.continuationId,
                        ownerKey: continuation.ownerKey,
                        sourceKey: continuation.sourceKey,
                        kind: decision.kind,
                    }),
                );
            } catch (err) {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "continuation.decision",
                        message: err instanceof Error ? err.message : String(err),
                    }),
                );
                throw err;
            }
        }
        return applied;
    }

    /**
     * LF-R5 identity 自写：把模型同轮输出的 identity append 候选落库。
     * 只做 enum + 长度校验（已在 parser 完成），不解析 content 语义。
     * 返回新写入的 eventId 列表（按输入顺序）；写入失败立即抛错。
     */
    public applyIdentityAppends(input: {
        ownerKey?: string;
        sourceKey: string;
        candidates: IdentityAppendCandidate[];
        codenameId?: string;
        sourceSurface?: string;
        requestId?: string;
        nowMs?: number;
    }): string[] {
        if (!this.brainOpened || input.candidates.length === 0) return [];
        const ts = input.nowMs ?? Date.now();
        const ownerKey =
            input.ownerKey ??
            (input.codenameId ? `codename:${input.codenameId}` : input.requestId ? `turn:${input.requestId}` : `turn:${crypto.randomUUID()}`);
        const writtenIds: string[] = [];
        for (const candidate of input.candidates) {
            const eventId = `identity-${crypto.randomUUID()}`;
            const content: IdentityEventContent = {
                kind: candidate.kind,
                content: candidate.content,
                confidence: candidate.confidence ?? 1,
                ...(input.requestId ? { sourceRequestId: input.requestId } : {}),
            };
            try {
                this.brain.appendEvent({
                    id: eventId,
                    ts,
                    ownerKey,
                    sourceKey: input.sourceKey,
                    sourceSurface: input.sourceSurface,
                    codenameId: input.codenameId,
                    type: MemoryEventType.IdentityAppend,
                    content: content as unknown as Record<string, unknown>,
                    importance: 0.6 + 0.3 * Math.max(0, Math.min(1, content.confidence)),
                });
                writtenIds.push(eventId);
                this.events.publish(
                    event(RuntimeEventType.MemoryIdentityAppended, {
                        eventId,
                        sourceKey: input.sourceKey,
                        kind: candidate.kind,
                    }),
                );
            } catch (err) {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "append",
                        message: err instanceof Error ? err.message : String(err),
                    }),
                );
                throw err;
            }
        }
        return writtenIds;
    }

    /**
     * LF-R5 identity 列举：默认只返回 live（未 revert / 未冷归档）行；
     * 传 `includeReverted=true` 时拉全部历史用于 CLI / TUI 审计。
     */
    public listIdentity(
        ownerKey: string,
        options: { limit?: number; includeReverted?: boolean } = {},
    ): MemoryEventRecord[] {
        if (!this.brainOpened) return [];
        try {
            return options.includeReverted
                ? this.brain.listAllIdentity(ownerKey, { limit: options.limit })
                : this.brain.listActiveIdentity(ownerKey, { limit: options.limit });
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "identity.list",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R5 identity revert：把 `identity-append` 行的 state.status 置 abandoned。
     * 仅对 `type='identity-append'` 生效；其他类型返回 false。
     * 不删除底层 event，保留审计 / reconsolidation 证据。
     */
    public revertIdentity(eventId: string, nowMs = Date.now()): boolean {
        if (!this.brainOpened) return false;
        try {
            const row = this.brain.getEvent(eventId);
            if (!row || row.type !== MemoryEventType.IdentityAppend) return false;
            this.brain.upsertState(eventId, {
                status: MemoryEventStatus.Abandoned,
                lastAccessed: nowMs,
            });
            // Patch event content with revertedAt for audit reconstruction.
            const nextContent: IdentityEventContent = {
                ...(row.content as unknown as IdentityEventContent),
                revertedAt: nowMs,
            };
            // Lightweight in-place patch shares the continuation path's UPDATE semantics.
            // Reuse low-level update by reusing patchContinuationContent? It's continuation-typed only;
            // use a dedicated brain helper to keep the type check clean.
            this.brain.updateEventContent(eventId, nextContent as unknown as Record<string, unknown>);
            this.events.publish(
                event(RuntimeEventType.MemoryIdentityReverted, {
                    eventId,
                    ownerKey: row.ownerKey,
                    sourceKey: row.sourceKey,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "identity.revert",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R5 slice B：跑一次该 continuity owner 对应 ledger 用户的 daily + weekly summary 聚合。
     * 纯结构化字段聚合（type / role / codenameId / ask reason / continuation reason 计数），
     * 不调 LLM、不读 content 文本。返回 `null` 表示 brain 未开或当前维护锁忙。
     */
    public async runSummaryOnce(ownerKey: string, nowMs?: number): Promise<SummaryRunResult | null> {
        if (!this.brainOpened || this.brainMaintenanceBusy) return null;
        this.brainMaintenanceBusy = true;
        try {
            const worker = new SummaryWorker(this.brain, {
                rollingWindowDays: this.config.memory.tuning.summary.rollingWindowDays,
                trigger: this.config.memory.tuning.summary.trigger,
                minIntervalHours: this.config.memory.tuning.summary.minIntervalHours,
            });
            const result = worker.runOnceForOwner(ownerKey, nowMs);
            this.events.publish(
                event(RuntimeEventType.MemorySummaryWritten, {
                    ownerKey,
                    sourceKey: this.resolveSourceKey(ownerKey),
                    written: result.written,
                    skippedByInterval: result.skippedByInterval,
                    skippedEmpty: result.skippedEmpty,
                }),
            );
            await this.embedWrittenSummaries(ownerKey, result.writtenIds);
            return result;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "summary.run",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        } finally {
            this.brainMaintenanceBusy = false;
        }
    }

    private resolveSourceKey(ownerKey: string): string {
        return this.sourceKeyByOwnerKey.get(ownerKey) ?? ownerKey;
    }

    /**
     * LF-R14：运行时自动 brain.db 月级冷归档。
     * 只移动 state=archived 且早于 cutoff 的事件；live/resumed 事件不动。
     */
    public async runBrainArchiveOnce(nowMs?: number): Promise<BrainArchiveRunResult | null> {
        if (!this.brainOpened || this.brainMaintenanceBusy) return null;
        this.brainMaintenanceBusy = true;
        try {
            const result = await runBrainArchive({
                brainPath: join(this.config.paths.configDir, "brain.db"),
                archiveAfterMonths: this.config.memory.tuning.brainDb.archiveAfterMonths,
                vacuumIntervalDays: this.config.memory.tuning.brainDb.vacuumIntervalDays,
                vacuumMode: "auto",
                statePath: join(this.config.paths.storageDir, "brain.archive.state.json"),
                nowMs,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryBrainArchiveCompleted, {
                    cutoffMonth: result.cutoffMonth,
                    eventsCopied: result.eventsCopied,
                    months: result.months.map((m) => m.bucketMonth),
                    vacuumed: result.vacuumed,
                }),
            );
            return result;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainArchiveFailed, {
                    error: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        } finally {
            this.brainMaintenanceBusy = false;
        }
    }

    private async embedWrittenSummaries(ownerKey: string, summaryIds: string[]): Promise<void> {
        if (!this.brainOpened || !this.graph || summaryIds.length === 0) return;
        let written = 0;
        const failures: Array<{ summaryId: string; error: unknown }> = [];
        for (const summaryId of summaryIds) {
            const summary = this.brain.getSummary(summaryId);
            if (!summary) continue;
            try {
                const embeddingId = `summary-embedding-${summary.id}`;
                const embedding = await this.embeddings.embed(summary.content);
                await this.graph.upsertSummaryEmbedding({
                    id: embeddingId,
                    ownerKey,
                    summaryId: summary.id,
                    timeRange: summary.timeRange,
                    bucketKey: summary.bucketKey,
                    embedding,
                    createdAt: summary.createdAt,
                });
                this.brain.writeSummary({
                    ...summary,
                    embeddingId,
                });
                written += 1;
            } catch (err) {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "summary.embedding",
                        summaryId,
                        message: err instanceof Error ? err.message : String(err),
                    }),
                );
                failures.push({ summaryId, error: err });
            }
        }
        if (written > 0) {
            this.events.publish(
                event(RuntimeEventType.MemorySummaryEmbeddingWritten, {
                    ownerKey,
                    written,
                }),
            );
        }
        if (failures.length > 0) {
            const failedIds = failures.map((failure) => failure.summaryId).join(", ");
            throw new Error(`Summary embedding write failed for ${failedIds}`);
        }
    }

    /** LF-R5 slice D：Idle 当前态查询。 */
    public runtimeModeOf(ownerKey: string): typeof RuntimeMode.Chat | typeof RuntimeMode.Idle {
        return this.idle.modeOf(ownerKey);
    }

    /** LF-R5 slice D：手动触发一次 idle sweep（测试 / CLI）。 */
    public sweepIdleOnce(): { entered: number } {
        return this.idle.sweepOnce();
    }

    /** LF-R5 slice D：idle 状态快照（CLI / 诊断）。 */
    public idleSnapshot(): Array<{ ownerKey: string; mode: string; lastInputAt: number; idleMs: number }> {
        return this.idle.snapshot();
    }

    /**
     * LF-R4：runtime 在非 ask 路径触发的 continuation-context 写入。
     * 适用于 `tool-failure` / `blackboard-cap` / `process-restart` 三种 reason；
     * 调用方必须显式给出 `userFacing` 字段（不做 prompt fallback，runtime 不解析文本语义）。
     * `ask` reason 的 continuation 仍由 `recordContinuationFromAsk` 自动写入，不要走本入口。
     */
    public recordContinuationFromReason(input: {
        sourceKey: string;
        ownerKey?: string;
        reason: Exclude<ContinuationContextReason, typeof ContinuationContextReason.Ask>;
        userFacing: { title: string; contextHint?: string };
        snapshot?: {
            originalUserMessage?: string;
            blackboardTurnId?: string;
            mcpCallProgress?: Array<{ tool: string; status: string; lastError?: string }>;
        };
        parentEventId?: string;
        codenameId?: string;
        sourceSurface?: string;
        requestId?: string;
        importance?: number;
        nowMs?: number;
    }): string | null {
        if (!this.brainOpened) return null;
        const continuationId = `continuation-${crypto.randomUUID()}`;
        const ts = input.nowMs ?? Date.now();
        const title = input.userFacing.title.trim().slice(0, 120);
        if (!title) return null;
        const contextHint = input.userFacing.contextHint?.trim().slice(0, 500);
        const snapshot: ContinuationSnapshot = {};
        if (input.snapshot?.originalUserMessage) snapshot.originalUserMessage = input.snapshot.originalUserMessage;
        if (input.snapshot?.blackboardTurnId) snapshot.blackboardTurnId = input.snapshot.blackboardTurnId;
        if (input.snapshot?.mcpCallProgress && input.snapshot.mcpCallProgress.length > 0) {
            snapshot.mcpCallProgress = input.snapshot.mcpCallProgress;
        }
        const content: ContinuationContextEventContent = {
            continuationId,
            reason: input.reason,
            userFacing: contextHint ? { title, contextHint } : { title },
            ...(Object.keys(snapshot).length > 0 ? { snapshot } : {}),
            ...(input.codenameId ? { codenameId: input.codenameId } : {}),
            ...(input.requestId ? { requestId: input.requestId } : {}),
        };
        try {
            this.brain.appendEvent({
                id: continuationId,
                ts,
                ownerKey:
                    input.ownerKey ??
                    (input.codenameId ? `codename:${input.codenameId}` : input.requestId ? `turn:${input.requestId}` : continuationId),
                sourceKey: input.sourceKey,
                sourceSurface: input.sourceSurface,
                codenameId: input.codenameId,
                type: MemoryEventType.ContinuationContext,
                content: content as unknown as Record<string, unknown>,
                parentId: input.parentEventId,
                importance: input.importance ?? 0.6,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryContinuationRecorded, {
                    continuationEventId: continuationId,
                    sourceKey: input.sourceKey,
                    reason: input.reason,
                }),
            );
            return continuationId;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.record",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R4：每次 recordAskEvent 完毕后写一条 continuation-context 事件。
     * userFacing.title 必须由模型同轮结构化 `ask.continuationHint.title` 给出。
     */
    private recordContinuationFromAsk(input: {
        askId: string;
        snapshotId: string;
        ask: AgentAsk;
        message: GatewayMessage;
        context: RuntimeContext;
        nowMs: number;
    }): void {
        const { askId, snapshotId, ask, message, context, nowMs } = input;
        const hintTitle = ask.continuationHint?.title?.trim();
        const hintContext = ask.continuationHint?.contextHint?.trim();
        const title = (hintTitle || firstLine(ask.prompt)).slice(0, 120);
        const contextHint = hintContext ?? ask.rationale;
        // LF-R4：ask.reason 是结构化枚举字段，结构化 → 结构化的映射不算字符匹配。
        // 黑板封顶的 ask 是 runtime 合成而非模型表达，单独标记为 reason='blackboard-cap'，
        // 列表 / 召回 / fork 决策时可与普通 ask continuation 区分。
        const continuationReason: ContinuationContextReason =
            ask.reason === AskReason.BlackboardStalemate
                ? ContinuationContextReason.BlackboardCap
                : ContinuationContextReason.Ask;
        const continuationId = `continuation-${crypto.randomUUID()}`;
        const content: ContinuationContextEventContent = {
            continuationId,
            snapshotId,
            reason: continuationReason,
            userFacing: {
                title,
                askPrompt: ask.prompt,
                ...(contextHint ? { contextHint } : {}),
            },
            snapshot: {
                originalUserMessage: message.text,
                askedQuestion: ask,
            },
            requestId: context.requestId,
        };
        try {
            this.brain.appendEvent({
                id: continuationId,
                ts: nowMs,
                ownerKey: continuityOwnerKey(message, context),
                sourceKey: sourceKeyForMessage(message, context),
                sourceSurface: sourceSurfaceForMessage(message),
                type: MemoryEventType.ContinuationContext,
                content: content as unknown as Record<string, unknown>,
                parentId: askId,
                importance: 0.7,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryContinuationRecorded, {
                    continuationEventId: continuationId,
                    askEventId: askId,
                    sourceKey: sourceKeyForMessage(message, context),
                    reason: continuationReason,
                    askReason: ask.reason,
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "continuation.record",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    private async recallVisibleBrainMemory(
        message: GatewayMessage,
        context?: RuntimeContext,
    ): Promise<MemorySearchResult[]> {
        if (!this.brainOpened) return [];
        const nowMs = Date.parse(context?.now ?? message.receivedAt);
        const sinceTs = Number.isFinite(nowMs) ? nowMs - 7 * 24 * 60 * 60 * 1000 : Date.now() - 7 * 24 * 60 * 60 * 1000;
        const visible = this.brain.listPromptAtomsWindow(context?.now ?? message.receivedAt, {
            days: 7,
            limit: this.config.memory.retrieval.maxResults,
            minScore: this.config.memory.tuning.atomScore.visibilityThreshold,
            ownerKey: continuityOwnerKey(message, context),
        });
        this.events.publish(
            event(RuntimeEventType.MemoryBrainPromptRecall, {
                ownerKey: continuityOwnerKey(message, context),
                sinceTs,
                hits: visible.length,
            }),
        );
        if (visible.length === 0) return [];
        const queryEmbedding =
            context?.embedding && context.embedding.length > 0 ? context.embedding : await this.embeddings.embed(message.text);
        // P0 prompt recall：brain_events 是权威源；召回时仍按资源指标做轻量排序。
        // 零字符匹配——只看结构化 score + embedding。
        const activeCodenameOwnerKey = this.peekActiveCodenameOwnerKey(sourceKeyForMessage(message, context), context);
        const boost = this.config.memory.tuning.inbox.codenameRecallBoost;
        const results = visible
            .map((entry) => ({
                entry,
                rank: rankVisibleAtom(entry, queryEmbedding, activeCodenameOwnerKey, boost),
            }))
            .sort((a, b) => b.rank - a.rank)
            .slice(0, this.config.memory.retrieval.maxResults)
            .map(({ entry }) => visibleAtomToMemoryResult(entry, MemoryLayer.Brain));
        return results;
    }

    /**
     * P2：算当前活跃 codename → 对应的 no-scope ownerKey。
     * 不可用（brain 未开/无 touch 命中）返回 null，rank 函数会跳过 boost。
     */
    private peekActiveCodenameOwnerKey(_sourceKey: string, context?: RuntimeContext): string | null {
        if (!this.brainOpened) return null;
        const nowMs = context?.now ? Date.parse(context.now) : Date.now();
        const windowMs = Math.max(0, this.config.memory.tuning.inbox.activeCodenameWindowMinutes) * 60_000;
        const sinceTs = (Number.isFinite(nowMs) ? nowMs : Date.now()) - windowMs;
        const cn = this.brain.getMostRecentTouchedCodename(sinceTs);
        return cn ? `codename:${cn.id}` : null;
    }

    private visibleAtomsForEpisodes(
        ownerKey: string,
        records: Array<EpisodeRecord | undefined>,
    ): Map<string, BrainVisibleAtom[]> {
        if (!this.brainOpened) return new Map();
        const brainEventToWorkingEpisode = new Map<string, string>();
        let latestCreatedAt = 0;
        for (const record of records) {
            if (!record) continue;
            latestCreatedAt = Math.max(latestCreatedAt, record.createdAt);
            const brainEventId = readMetadataString(record.metadata, "brainEventId");
            if (brainEventId) {
                brainEventToWorkingEpisode.set(brainEventId, record.episodeId);
            }
        }
        if (brainEventToWorkingEpisode.size === 0) return new Map();
        // Working-memory episodes carry the authoritative brain event id in metadata.
        // Reading prompt atoms from brain.db keeps hippocampus context on the single hot-path store.
        const visible = this.brain.listPromptAtomsWindow(
            latestCreatedAt > 0 ? new Date(latestCreatedAt) : new Date(),
            {
                days: 31,
                limit: Math.max(this.config.memory.retrieval.maxResults * 4, records.length),
                minScore: this.config.memory.tuning.atomScore.visibilityThreshold,
                ownerKey,
            },
        );
        const byEpisode = new Map<string, BrainVisibleAtom[]>();
        for (const entry of visible) {
            for (const episodeId of entry.atom.episodeIds) {
                const workingEpisodeId = brainEventToWorkingEpisode.get(episodeId);
                if (!workingEpisodeId) continue;
                const existing = byEpisode.get(workingEpisodeId) ?? [];
                existing.push(entry);
                byEpisode.set(workingEpisodeId, existing);
            }
        }
        return byEpisode;
    }

    /**
     * 向工作记忆 Component 写入本轮 episode。
     * 失败记录事件后继续抛出。embedding 优先复用 context.embedding；缺省时使用本地 embedding provider。
     */
    private async writeEpisodeToWorkingMemory(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        ownerKey: string,
        importance: number,
        provenance: MemoryEpisodeProvenance,
    ): Promise<void> {
        if (!this.workingMemory) return;
        try {
            const stability = Math.min(1, importance * 1.2);
            const ttlMultiplier = this.workingMemoryDefaultTtlSeconds;
            const ttlSeconds = Math.max(60, Math.floor(ttlMultiplier * (0.5 + importance)));

            const embedding =
                context.embedding && context.embedding.length > 0
                    ? context.embedding
                    : await this.embeddings.embed(message.text);

            const episodeId = crypto.randomUUID();
            const normalizedProvenance = normalizeEpisodeProvenance(provenance);
            const hasMcpSuccess = (normalizedProvenance.mcpCalls ?? []).some((call) => call.ok);
            const text = renderEpisodeText(message.text, reply.text, normalizedProvenance);

            await this.workingMemory.writeEpisode({
                ownerKey,
                episodeId,
                text,
                concepts: [],
                embedding,
                importance,
                stability,
                sourceKind: hasMcpSuccess ? MemorySourceKind.McpAugmented : MemorySourceKind.UserTurn,
                createdAt: Date.now(),
                ttlSeconds,
                metadata: {
                    provenance: normalizedProvenance,
                    brainEventId: turnEpisodeId(message, context),
                    schemaVersion: 1,
                },
            });

            this.events.publish(
                event(
                    RuntimeEventType.MemoryEpisodeWritten,
                    {
                        episodeId,
                        importance,
                        mcpCalls: normalizedProvenance.mcpCalls?.length ?? 0,
                        skillNames: normalizedProvenance.skillNames ?? [],
                        sourceKind: hasMcpSuccess ? MemorySourceKind.McpAugmented : MemorySourceKind.UserTurn,
                        ttlSeconds,
                    },
                    context.requestId,
                ),
            );
            // Dream 已转晶体图长期层维护（DESIGN §12），不再有 episode 入队步骤。
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryReflectionFailed,
                    { stage: "episode-write", error: String(err) },
                    context.requestId,
                ),
            );
            throw err;
        }
    }

    /**
     * Scope 候选 cluster 扫描：从工作记忆 context ring 拿近期 episode，按 concept 聚合，
     * 用 `detectClusterCandidate` 判定；命中即写入 pending_scope_offer（每 ownerKey 最多一条；
     * 已有 offer 时不重复触发，避免噪声）。
     *
     * 返回是否新增了一条 offer（用于测试与诊断）。
     */
    public async sweepScopeClusters(ownerKey: string, options: { ttlTurns?: number } = {}): Promise<boolean> {
        if (!this.workingMemory) return false;
        const existing = await this.sqlite.getScopeOffer(ownerKey);
        if (existing) return false;

        const ringLimit = Math.max(8, this.config.memory.retrieval.maxResults * 4);
        const episodeIds = await this.workingMemory.readContextRing(ownerKey, ringLimit);
        if (episodeIds.length === 0) return false;
        const episodes = (await Promise.all(episodeIds.map((id) => this.workingMemory!.readEpisode(ownerKey, id)))).filter(
            (e): e is NonNullable<typeof e> => Boolean(e),
        );
        if (episodes.length === 0) return false;

        // 按 concept 聚合，找出出现次数最高的概念作为 seed。
        const conceptCount = new Map<string, number>();
        for (const ep of episodes) {
            for (const c of ep.concepts ?? []) {
                conceptCount.set(c, (conceptCount.get(c) ?? 0) + 1);
            }
        }
        if (conceptCount.size === 0) return false;
        const ranked = [...conceptCount.entries()].sort((a, b) => b[1] - a[1]);
        const top = ranked[0];
        if (!top) return false;
        const topConcept = top[0];
        const clusterEpisodes = episodes.filter((e) => (e.concepts ?? []).includes(topConcept));
        if (clusterEpisodes.length === 0) return false;

        const trigger = this.scopeTriggerDetector.detectClusterCandidate({ concepts: [topConcept], episodes: clusterEpisodes });
        if (trigger.kind === ScopeTriggerKind.None) return false;

        const proposedAt = new Date().toISOString();
        const scopeId = `scope-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        const title = `Recurring topic: ${topConcept}`;
        const goal = `Cluster around concept "${topConcept}" with ${clusterEpisodes.length} related episodes.`;
        const offer: PendingScopeOffer = {
            ownerKey,
            scopeId,
            title,
            goal,
            triggerKind: trigger.kind,
            evidenceScore: trigger.score,
            relatedIds: trigger.relatedIds.slice(0, 16),
            proposedAt,
            ttlTurns: Math.max(1, options.ttlTurns ?? 3),
        };
        await this.sqlite.upsertScopeOffer(offer);
        this.events.publish(
            event(RuntimeEventType.MemoryScopeOfferProposed, {
                ownerKey,
                scopeId,
                title,
                triggerKind: trigger.kind,
                evidenceScore: trigger.score,
                relatedEpisodes: offer.relatedIds.length,
                ttlTurns: offer.ttlTurns,
            }),
        );
        return true;
    }

    /**
     * commitTurn 末端调用：若 Path A 触发了显式 project intent，消费 offer 并发事件；
     * 否则 ttl-1，0 时自动过期。
     */
    public async noteScopeOfferTurn(ownerKey: string, explicitTriggered: boolean): Promise<void> {
        const offer = await this.sqlite.getScopeOffer(ownerKey);
        if (!offer) return;
        if (explicitTriggered) {
            await this.sqlite.deleteScopeOffer(ownerKey);
            this.events.publish(
                event(RuntimeEventType.MemoryScopeOfferConsumed, {
                    ownerKey,
                    scopeId: offer.scopeId,
                    triggerKind: offer.triggerKind,
                }),
            );
            return;
        }
        const remaining = await this.sqlite.decrementScopeOfferTtl(ownerKey);
        if (remaining === 0) {
            this.events.publish(
                event(RuntimeEventType.MemoryScopeOfferExpired, {
                    ownerKey,
                    scopeId: offer.scopeId,
                    evidenceScore: offer.evidenceScore,
                }),
            );
        }
    }

    /**
     * 技能候选扫描：从工作记忆 context ring 拿近期 episode，按 episode.provenance.mcpCalls
     * 的工具组合（成功的 tools，按字典序去重）聚合 cluster；满足 support/confidence 阈值即
     * 写入 pending_skill_offer。
     *
     * 同 sweepScopeClusters 一样：每 ownerKey 最多一条 offer；已存在 offer 时直接跳过。
     */
    public async sweepSkillCandidates(ownerKey: string): Promise<boolean> {
        if (!this.workingMemory) return false;
        const existing = await this.sqlite.getSkillOffer(ownerKey);
        if (existing) return false;

        const ringLimit = Math.max(8, this.config.memory.retrieval.maxResults * 4);
        const episodeIds = await this.workingMemory.readContextRing(ownerKey, ringLimit);
        if (episodeIds.length === 0) return false;
        const episodes = (await Promise.all(episodeIds.map((id) => this.workingMemory!.readEpisode(ownerKey, id)))).filter(
            (e): e is NonNullable<typeof e> => Boolean(e),
        );
        if (episodes.length === 0) return false;

        const supportMin = 5;

        // 按工具组合聚合：episode.metadata.provenance.mcpCalls 中 ok=true 的 (server.tool) 集合 (sorted).
        const clusters = new Map<string, { tools: string[]; episodes: typeof episodes }>();
        for (const ep of episodes) {
            const tools = extractEpisodeMcpTools(ep.metadata);
            if (tools.length === 0) continue;
            const key = tools.join("\u0001");
            const bucket = clusters.get(key);
            if (bucket) {
                bucket.episodes.push(ep);
            } else {
                clusters.set(key, { tools, episodes: [ep] });
            }
        }
        if (clusters.size === 0) return false;
        const sorted = [...clusters.values()].sort((a, b) => b.episodes.length - a.episodes.length);
        const top = sorted[0];
        if (!top) return false;

        const trigger = this.scopeTriggerDetector.detectSkillCandidate(top, { skillSupportMin: supportMin });
        if (trigger.kind === ScopeTriggerKind.None) return false;

        const proposedAt = new Date().toISOString();
        const skillId = `skill-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        const name = synthesizeSkillName(top.tools);
        const description = `Recurring workflow combining ${top.tools.length} MCP tool(s): ${top.tools.join(", ")}.`;
        const summary = buildSkillSummary(top.episodes, top.tools);
        const offer: PendingSkillOffer = {
            ownerKey,
            skillId,
            name,
            description,
            summary,
            support: top.episodes.length,
            confidence: trigger.score,
            mcpTools: top.tools,
            relatedIds: trigger.relatedIds.slice(0, 16),
            proposedAt,
            ttlTurns: 3,
        };
        await this.sqlite.upsertSkillOffer(offer);
        this.events.publish(
            event(RuntimeEventType.MemorySkillOfferProposed, {
                ownerKey,
                skillId,
                name,
                support: offer.support,
                confidence: offer.confidence,
                tools: top.tools.length,
            }),
        );
        return true;
    }

    /** 显式同意：把 pending offer 物化为 SKILL.md，并写 RETROSPECTIVE。 */
    public async consumeSkillOffer(ownerKey: string): Promise<boolean> {
        const offer = await this.sqlite.getSkillOffer(ownerKey);
        if (!offer) return false;
        try {
            const skillDir = await materializeSkillFromOffer(this.config.paths.skillDir, offer);
            await this.sqlite.deleteSkillOffer(ownerKey);
            this.events.publish(
                event(RuntimeEventType.MemorySkillInstalled, {
                    ownerKey,
                    skillId: offer.skillId,
                    name: offer.name,
                    path: skillDir,
                    tools: offer.mcpTools.length,
                }),
            );
            this.events.publish(
                event(RuntimeEventType.MemorySkillOfferConsumed, {
                    ownerKey,
                    skillId: offer.skillId,
                    name: offer.name,
                }),
            );
            const retrospective = new RetrospectiveLog({ projectMemoryDir: this.config.paths.projectMemoryDir });
            await retrospective.append({
                kind: "skill-promoted",
                ownerKey,
                summary: offer.description,
                symbols: offer.mcpTools,
                rationale: `User confirmed promotion of recurring MCP workflow (support=${offer.support}, confidence=${offer.confidence.toFixed(2)}).`,
                extra: { skillId: offer.skillId, name: offer.name, path: skillDir },
            });
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemorySkillInstallFailed, {
                    ownerKey,
                    skillId: offer.skillId,
                    name: offer.name,
                    error: String(err),
                }),
            );
            throw err;
        }
    }

    /** 用户未显式同意 → ttl-1；归零即过期。 */
    public async noteSkillOfferTurn(ownerKey: string, explicitTriggered: boolean): Promise<void> {
        const offer = await this.sqlite.getSkillOffer(ownerKey);
        if (!offer) return;
        if (explicitTriggered) {
            // consumeSkillOffer 已处理；这里幂等保护
            return;
        }
        const remaining = await this.sqlite.decrementSkillOfferTtl(ownerKey);
        if (remaining === 0) {
            this.events.publish(
                event(RuntimeEventType.MemorySkillOfferExpired, {
                    ownerKey,
                    skillId: offer.skillId,
                    confidence: offer.confidence,
                }),
            );
        }
    }

    /**
     * Pending scope offer 是 prompt nudge，不是文本意图检测。
     * 渲染由 MemoryModule 持有，避免散落 helper 重新引入隐式业务入口。
     */
    private renderScopeOfferNudge(offer: PendingScopeOffer): string {
        return renderScopeOfferPrompt({
            evidenceScore: offer.evidenceScore.toFixed(2),
            relatedCount: String(offer.relatedIds.length),
            remainingTurns: String(offer.ttlTurns),
            title: offer.title,
        });
    }

    /** Skill offer nudge 只消费 SQLite pending offer 结构字段，不读取用户文本语义。 */
    private renderSkillOfferNudge(offer: PendingSkillOffer): string {
        return renderSkillOfferPrompt({
            confidence: offer.confidence.toFixed(2),
            name: offer.name,
            remainingTurns: String(offer.ttlTurns),
            support: String(offer.support),
            tools: offer.mcpTools.join(", "),
        });
    }

    /** EQ directive 是结构化 state 的提示行；没有 directive 时不注入噪音。 */
    private renderEqDirectiveLine(directive: string | null): string {
        return directive ? `- directive=${directive}` : "";
    }
}

function extractEpisodeMcpTools(metadata: Record<string, unknown> | undefined): string[] {
    if (!metadata || typeof metadata !== "object") return [];
    const provenance = (metadata as { provenance?: unknown }).provenance;
    if (!provenance || typeof provenance !== "object") return [];
    const calls = (provenance as { mcpCalls?: unknown }).mcpCalls;
    if (!Array.isArray(calls)) return [];
    const tools = new Set<string>();
    for (const call of calls) {
        if (!call || typeof call !== "object") continue;
        const c = call as { ok?: unknown; server?: unknown; tool?: unknown };
        if (c.ok !== true) continue;
        if (typeof c.server !== "string" || typeof c.tool !== "string") continue;
        const id = `${c.server.trim()}.${c.tool.trim()}`;
        if (id.length > 1 && id.length <= 120) tools.add(id);
    }
    return [...tools].sort();
}

function synthesizeSkillName(tools: string[]): string {
    const base = tools
        .map((t) => t.split(".").pop() ?? t)
        .map((t) => t.replace(/[^A-Za-z0-9]+/g, "-"))
        .filter(Boolean)
        .slice(0, 3)
        .join("-")
        .toLowerCase();
    const fallback = base || "mcp-recurring";
    return fallback.length > 48 ? fallback.slice(0, 48) : fallback;
}

function buildSkillSummary(episodes: Array<{ text: string }>, tools: string[]): string {
    const sample = episodes
        .slice(0, 3)
        .map((e) => compactText(e.text, 200))
        .filter(Boolean);
    const lines = [
        `Recurring workflow over MCP tools: ${tools.join(", ")}.`,
        "",
        "## When to use",
        `- Trigger when the user wants to combine ${tools.join(" + ")} for a similar task.`,
        "",
        "## Sample interactions",
        ...sample.map((s) => `- ${s}`),
    ];
    return lines.join("\n");
}

async function materializeSkillFromOffer(skillDir: string, offer: PendingSkillOffer): Promise<string> {
    const safeName = offer.name.replace(/[^A-Za-z0-9_-]+/g, "-");
    const dest = join(skillDir, safeName);
    await mkdir(dest, { recursive: true });
    const frontmatter = [
        "---",
        `name: ${safeName}`,
        `description: ${offer.description.replace(/[\r\n]+/g, " ")}`,
        "schemaVersion: 1",
        "---",
        "",
    ].join("\n");
    const tools =
        offer.mcpTools.length > 0 ? `\n## MCP tools\n${offer.mcpTools.map((t) => `- ${t}`).join("\n")}\n` : "";
    await Bun.write(join(dest, "SKILL.md"), `${frontmatter}\n${offer.summary}\n${tools}`);
    const manifest = {
        name: safeName,
        description: offer.description,
        capabilities: offer.mcpTools,
        compatibility: [],
        mcpServers: offer.mcpTools.map((t) => t.split(".")[0]).filter((v, i, arr) => arr.indexOf(v) === i),
        permissions: [],
        tags: ["auto-promoted"],
        author: "flyflor:auto",
        activation: { auto: true, manual: true },
    };
    await Bun.write(join(dest, "skill.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return dest;
}

function normalizeEpisodeProvenance(provenance: MemoryEpisodeProvenance): MemoryEpisodeProvenance {
    const skillNames = uniqueStrings(provenance.skillNames ?? []).slice(0, 16);
    const mcpCalls = (provenance.mcpCalls ?? [])
        .filter((call) => call.server.trim() && call.tool.trim())
        .slice(0, 8)
        .map((call) => ({
            error: call.error ? call.error.slice(0, 240) : undefined,
            ok: call.ok,
            resultSummary: call.resultSummary ? compactText(call.resultSummary, 500) : undefined,
            resultSummaryMeta: call.resultSummaryMeta,
            server: call.server.trim(),
            tool: call.tool.trim(),
        }));
    return {
        ...(provenance.blackboardTurnId ? { blackboardTurnId: provenance.blackboardTurnId } : {}),
        ...(skillNames.length > 0 ? { skillNames } : {}),
        ...(mcpCalls.length > 0 ? { mcpCalls } : {}),
    };
}

function renderEpisodeText(userText: string, assistantText: string, provenance: MemoryEpisodeProvenance): string {
    const lines = [`[user] ${compactText(userText, 512)}`, `[assistant] ${compactText(assistantText, 512)}`];
    if (provenance.skillNames && provenance.skillNames.length > 0) {
        lines.push(`[skills] ${provenance.skillNames.join(", ")}`);
    }
    if (provenance.mcpCalls && provenance.mcpCalls.length > 0) {
        lines.push("[mcp]");
        for (const call of provenance.mcpCalls) {
            const status = call.ok ? "ok" : "failed";
            const detail = call.ok ? call.resultSummary : call.error;
            lines.push(`- ${call.server}.${call.tool}: ${status}${detail ? `; ${detail}` : ""}`);
        }
    }
    return lines.join("\n").slice(0, 2048);
}

function compactText(value: string, maxChars: number): string {
    return value.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createMemory(config: FlyflorConfig, events: EventSink, model?: ModelClient): MemoryModule {
    return new MemoryModule(config, events, model);
}

function buildScoreExplain(
    scopeConstraintId: string,
    inboxDecayMultiplier: number,
    codenameBoost: number,
    codenameUseCount: number,
): string | undefined {
    const parts: string[] = [];
    if (isInboxScopeId(scopeConstraintId)) {
        const cn = extractCodenameIdFromInboxScopeId(scopeConstraintId);
        const namespace = cn ? `inbox:${cn}` : "inbox";
        parts.push(`${namespace} recency dampened by ${inboxDecayMultiplier}`);
    }
    if (codenameBoost > 0) {
        parts.push(`codename boost +${codenameBoost.toFixed(3)} (uses=${codenameUseCount})`);
    }
    return parts.length > 0 ? parts.join("; ") : undefined;
}

function candidateFromAction(
    action: MemoryAction,
    message: GatewayMessage,
    reply: GatewayReply,
    context: RuntimeContext,
    scopeOrOwnerId: string,
    sourceId: string,
    defaults: MemoryWeights,
    matrixAggregator: MemoryMatrixAggregator,
): MemoryCandidate {
    const baseWeights = weightsFromAction(defaults, action);
    const matrix = matrixAggregator.aggregate({ action, message, reply, weights: baseWeights });
    const weights = matrixAggregator.applyImpact(baseWeights, matrix);
    return {
        id: crypto.randomUUID(),
        targetFile: targetFileForMemoryAction(action),
        kind: kindForMemoryAction(action),
        status: MemoryCandidateStatus.Candidate,
        sourceKind: MemorySourceKind.ExplicitUserIntent,
        content: action.content.replace(/\s+/g, " ").trim(),
        projectId: scopeOrOwnerId,
        sourceId,
        sourceMessageId: message.id,
        sourceReplyId: reply.messageId,
        createdAt: context.now,
        weights,
        metadata: {
            action,
            affect: action.affect ?? {},
            matrix,
            reason: action.reason,
            route: message.route,
            signals: action.signals ?? {},
            weightsBeforeMatrix: baseWeights,
            schemaVersion: 1,
        },
    };
}

function weightsFromAction(defaults: MemoryWeights, action: MemoryAction): MemoryWeights {
    const confidence = clamp01(action.confidence ?? defaults.confidence);
    const certainty = clamp01(action.signals?.certainty ?? confidence);
    const durability = clamp01(action.signals?.durability ?? defaults.durability);
    const relevance = clamp01(action.signals?.relevance ?? defaults.relevance);
    const actionability = clamp01(action.signals?.actionability ?? defaults.actionability);
    const arousal = clamp01(action.affect?.arousal ?? defaults.arousal);
    const dominance = clamp01(action.affect?.dominance ?? defaults.dominance);
    const emotionalValence = clampSigned(action.affect?.valence ?? defaults.emotionalValence);
    const recurrence = clamp01(action.signals?.recurrence ?? defaults.recurrence);
    const sourceDiversity = clamp01(action.signals?.sourceDiversity ?? defaults.sourceDiversity);
    const validationCount = clamp01(action.signals?.validationCount ?? defaults.validationCount);
    const importance = clamp01(
        confidence * 0.28 +
            durability * 0.22 +
            relevance * 0.18 +
            actionability * 0.12 +
            arousal * 0.08 +
            recurrence * 0.06 +
            sourceDiversity * 0.03 +
            validationCount * 0.03,
    );

    return {
        ...defaults,
        actionability,
        arousal,
        certainty,
        confidence,
        dominance,
        durability,
        emotionalValence,
        importance,
        recurrence,
        relevance,
        sourceDiversity,
        validationCount,
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(-1, Math.min(1, value));
}

function dedupeResults(results: MemorySearchResult[]): MemorySearchResult[] {
    const byId = new Map<string, MemorySearchResult>();
    for (const result of results.sort((a, b) => b.score - a.score)) {
        if (!byId.has(result.record.id)) {
            byId.set(result.record.id, result);
        }
    }
    return [...byId.values()];
}

function renderMemoryPrompt(
    markdown: string,
    scopeMemory: string,
    hippocampus: string | undefined,
    results: MemorySearchResult[],
    maxChars: number,
): string {
    const content = renderMemoryContextPrompt({
        markdown,
        hippocampus: hippocampus ?? "",
        scopeMemory,
        renderedResults: results.length > 0 ? renderResults(results) : "",
    });
    return content.length <= maxChars ? content : content.slice(0, maxChars).trimEnd();
}

function renderResults(results: MemorySearchResult[]): string {
    return results
        .map((result) => {
            const source = `${result.layer}:${result.record.kind}`;
            const timestamp = result.record.updatedAt;
            return `- [${source} ${timestamp}] ${result.record.content.replace(/\s+/g, " ").trim()}`;
        })
        .join("\n");
}

/**
 * 从 actions 估算 episode 重要度，避免等待 candidate 构造完成。
 * 使用 confidence 和 signals.durability/relevance/actionability 的加权平均；
 * 没有 actions 时回退到 0.4（与原 candidates.length === 0 分支一致）。
 */
function importanceFromActions(actions: MemoryAction[]): number {
    if (actions.length === 0) return 0.4;
    let total = 0;
    for (const a of actions) {
        const conf = clamp01(a.confidence ?? 0.5);
        const dur = clamp01(a.signals?.durability ?? 0.5);
        const rel = clamp01(a.signals?.relevance ?? 0.5);
        const act = clamp01(a.signals?.actionability ?? 0.5);
        total += conf * 0.4 + dur * 0.25 + rel * 0.2 + act * 0.15;
    }
    return clamp01(total / actions.length);
}

const INBOX_SCOPE_CONSTRAINT_ID = "inbox";
const INBOX_CODENAME_SCOPE_PREFIX = "inbox:cn-";

/**
 * P2 inbox 收口：把 inbox 单一虚拟桶扩成"按 codename 命名空间化"的子桶集合。
 * - 无 codename → "inbox"（保持后向兼容）
 * - 有 codename → "inbox:cn-<codenameId>"
 *
 * 命名空间内仍走 inbox 7-day 加速衰减；scope 升格后改用真实 scope id。
 */
export function inboxScopeIdFor(codenameId?: string | null): string {
    if (!codenameId) return INBOX_SCOPE_CONSTRAINT_ID;
    return `${INBOX_CODENAME_SCOPE_PREFIX}${codenameId}`;
}

/** @deprecated Compatibility alias for older tests and callers. Use inboxScopeIdFor. */
export const inboxProjectIdFor = inboxScopeIdFor;

/**
 * 谓词：scope id 是否属于 inbox 容器（含 codename 子桶）。
 * 决定 atom 是否走 inbox decay multiplier；零字符匹配——只看 scope id 字面量前缀。
 */
export function isInboxScopeId(id: string): boolean {
    return id === INBOX_SCOPE_CONSTRAINT_ID || id.startsWith(INBOX_CODENAME_SCOPE_PREFIX);
}

/** @deprecated Compatibility alias for older tests and callers. Use isInboxScopeId. */
export const isInboxProjectId = isInboxScopeId;

/**
 * 从命名空间化的 inbox scope id 中抽取 codenameId；非 codename 桶返回 null。
 * 单一来源 — 任何需要反解的 caller 都用这个，不要本地再 slice 前缀。
 */
export function extractCodenameIdFromInboxScopeId(id: string): string | null {
    if (!id.startsWith(INBOX_CODENAME_SCOPE_PREFIX)) return null;
    const tail = id.slice(INBOX_CODENAME_SCOPE_PREFIX.length);
    return tail.length > 0 ? tail : null;
}

/** @deprecated Compatibility alias for older tests and callers. Use extractCodenameIdFromInboxScopeId. */
export const extractCodenameIdFromInboxProjectId = extractCodenameIdFromInboxScopeId;

interface BrainAtomFromActionInput {
    action: MemoryAction;
    codenameId?: string;
    createdAt: string;
    defaultWeights: MemoryWeights;
    embedding: number[];
    episodeId: string;
    index: number;
    matrix: MemoryMatrixAggregator;
    message: GatewayMessage;
    context: RuntimeContext;
    scopeConstraintId: string;
    reply: GatewayReply;
    scoreWeights: {
        access: number;
        fanout: number;
        recency: number;
        successPrior: number;
    };
    inboxDecayMultiplier: number;
    /**
     * LF-R2 codename boost：当 atom 来自带 codename 的 action 时，把 codename 的
     * useCount 视作"反复出现的工作锚点"信号，按对数曲线（min(1, log2(1+useCount)/4)）
     * 把它叠加到 score.total。零字符匹配——只用 useCount 资源指标。
     */
    codenameUseCount?: number;
}

function brainAtomFromAction(input: BrainAtomFromActionInput): BrainPromptAtomWrite {
    const baseWeights = weightsFromAction(input.defaultWeights, input.action);
    const matrix = input.matrix.aggregate({
        action: input.action,
        message: input.message,
        reply: input.reply,
        weights: baseWeights,
    });
    const weights = input.matrix.applyImpact(baseWeights, matrix);
    const inboxDecayMultiplier = Math.max(1, input.inboxDecayMultiplier);
    const recency =
        isInboxScopeId(input.scopeConstraintId) ? clamp01(1 / inboxDecayMultiplier) : 1;
    const codenameUseCount = Math.max(0, Math.floor(input.codenameUseCount ?? 0));
    const codenameBoost =
        codenameUseCount > 0 ? clamp01(Math.log2(1 + codenameUseCount) / 4) : 0;
    const score: AtomScore = {
        atomId: `${input.episodeId}:atom:${input.index}`,
        access: clamp01(weights.recurrence),
        fanout: clamp01(weights.sourceDiversity),
        inboxDecayApplied: isInboxScopeId(input.scopeConstraintId),
        recency,
        successPrior: clamp01(weights.confidence * 0.5 + weights.durability * 0.3 + weights.validationCount * 0.2),
        total: 0,
        explain: buildScoreExplain(input.scopeConstraintId, inboxDecayMultiplier, codenameBoost, codenameUseCount),
    };
    score.total = clamp01(
        score.recency * input.scoreWeights.recency +
            score.access * input.scoreWeights.access +
            score.successPrior * input.scoreWeights.successPrior +
            score.fanout * input.scoreWeights.fanout +
            codenameBoost,
    );
    const ownerKey = continuityOwnerKey(input.message, input.context, input.codenameId);
    const scopeId = input.context.activeScope?.id;
    const legacyProjectId = scopeId ?? ownerKey;
    const atom: MemoryAtom = {
        id: score.atomId,
        episodeIds: [input.episodeId],
        ownerKey,
        scopeId,
        sourceKey: sourceKeyForMessage(input.message, input.context),
        sourceSurface: sourceSurfaceForMessage(input.message),
        projectId: legacyProjectId,
        role: ModelRole.Assistant,
        task: input.action.target,
        context: input.action.reason ?? input.action.target,
        action: input.action.content,
        outcome: input.action.reason ?? input.action.content,
        success: true,
        confidence: clamp01(input.action.confidence ?? weights.confidence),
        priorWeight: clamp01(weights.importance),
        embedding: input.embedding,
        text: input.action.content,
        stage: AtomStage.Raw,
        createdAt: input.createdAt,
    };
    return { atom, score };
}

type VisibleAtomEntry = {
    atom: MemoryAtom;
    score: AtomScore;
};

function visibleAtomToMemoryResult(entry: VisibleAtomEntry, layer: MemoryLayer): MemorySearchResult {
    return {
        layer,
        score: entry.score.total,
        record: {
            id: entry.atom.id,
            kind: MemoryKind.Summary,
            content: compactText([entry.atom.task, entry.atom.action, entry.atom.outcome].filter(Boolean).join(" | "), 640),
            scope: entry.atom.scopeId ?? entry.atom.projectId ?? entry.atom.ownerKey ?? entry.atom.id,
            subjectId: entry.atom.sourceKey,
            importance: entry.score.total,
            confidence: entry.atom.confidence,
            createdAt: entry.atom.createdAt,
            updatedAt: entry.atom.refinedAt ?? entry.atom.createdAt,
            metadata: {
                atomScore: entry.score,
                episodeIds: entry.atom.episodeIds,
                stage: entry.atom.stage,
            },
        },
    };
}

function rankVisibleAtom(
    entry: VisibleAtomEntry,
    queryEmbedding: number[],
    activeCodenameOwnerKey?: string | null,
    codenameBoost?: number,
): number {
    const similarity =
        queryEmbedding.length > 0 && entry.atom.embedding.length === queryEmbedding.length
            ? Math.max(0, cosine(queryEmbedding, entry.atom.embedding))
            : 0;
    const codenameBoostScore =
        activeCodenameOwnerKey && (entry.atom.ownerKey ?? entry.atom.scopeId ?? entry.atom.projectId) === activeCodenameOwnerKey
            ? Math.max(0, codenameBoost ?? 0)
            : 0;
    return entry.score.total * 0.75 + similarity * 0.25 + codenameBoostScore;
}

function cosine(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const av = Number.isFinite(a[i]) ? (a[i] as number) : 0;
        const bv = Number.isFinite(b[i]) ? (b[i] as number) : 0;
        dot += av * bv;
        magA += av * av;
        magB += bv * bv;
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function turnEpisodeId(message: GatewayMessage, context: RuntimeContext): string {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(`${context.requestId}:${message.id}:${context.now}`);
    return `episode:${hasher.digest("hex").slice(0, 24)}`;
}

function focusKeyForMessage(message: GatewayMessage, context?: RuntimeContext): string {
    return continuityOwnerKey(message, context);
}

function resolveWorkingMemoryConfig(config: FlyflorConfig): WorkingMemoryConfig {
    if (config.memory.working) {
        return config.memory.working;
    }
    return createDefaultMemoryConfig().working ?? {
        backend: MemoryWorkingBackend.Local,
        local: {
            contextRingSize: 12,
            defaultTtlSeconds: 86_400,
            maxEpisodesPerUser: 200,
            maxWalBytes: 4 * 1024 * 1024,
            snapshotEveryWrites: 64,
            snapshotFile: "working.snapshot.json",
            walFile: "working.wal.jsonl",
        },
    };
}

function deriveProjectTitle(message: GatewayMessage): string {
    const text = message.text.trim().split("\n")[0] ?? "Untitled project";
    return text.slice(0, 80);
}

function firstLine(value: string): string {
    // UI 标题只承载一行可扫读摘要；完整 ask.prompt 仍保存在 askPrompt 字段。
    return value.trim().split(/\r?\n/u)[0]?.trim() ?? "";
}
