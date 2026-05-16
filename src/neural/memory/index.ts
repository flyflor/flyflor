import { createDefaultMemoryConfig, type FlyflorConfig } from "../../config/index.ts";
import type { WorkingMemoryConfig } from "../../config/index.ts";
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
} from "../../protocol/contracts/index.ts";
import type {
    AtomScore,
    GatewayMessage,
    GatewayReply,
    MemoryAtom,
    ModelClient,
    RuntimeContext,
} from "../../protocol/contracts/index.ts";
import { Memory } from "../../components/index.ts";
import { Module } from "../../agent/di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import {
    loadPromptTemplates,
    renderMemoryContextPrompt,
    renderProjectOfferPrompt,
    renderRuntimeAskContinuationPrompt,
    renderRuntimeDormantResumePrompt,
    renderRuntimeEqContextPrompt,
    renderRuntimeGhostHintPrompt,
    renderRuntimeIdentityContextPrompt,
    renderSkillOfferPrompt,
} from "../../agent/prompts/index.ts";
import { FeedbackCategory, classifyFeedback } from "./feedback.interpreter.ts";
import { detectExplicitIntent, detectExplicitSkillIntent, ProjectTriggerKind } from "../project/index.ts";
import { promoteCodename as promoteCodenameHelper } from "../project/codename.promote.ts";
import { ProjectScaffolder } from "../project/scaffolder.ts";
import { spreadActivation, type ActivationCandidate } from "./activation.ts";
import { kindForMemoryAction, targetFileForMemoryAction } from "./actions.ts";
import { LocalHashEmbeddingProvider, type EmbeddingProvider } from "../embedding/index.ts";
import { MarkdownMemoryStore } from "../../components/memory/markdown.store.ts";
import { ProjectMemoryStore } from "../../components/memory/project.memory.store.ts";
import { BrainStore, type BrainPromptAtomWrite, type BrainVisibleAtom } from "../../components/memory/brain.store.ts";
import { SummaryWorker, type SummaryRunResult } from "./summary.worker.ts";
import { AskReason, MemoryEventStatus, MemoryEventType, SceneRecordKind, decayEq, deriveEqDirective, normalizeEqClassification, type AgentAsk, type AskEventContent, type AskAnswerPairContent, type BehaviorCorrectionContent, type BehaviorSnapshotContent, type CodenameRecord, type ContextForkRecord, type EqClassification, type EqState, type GhostContextEventContent, GhostContextReason, GhostDecisionKind, type GhostDecision, type GhostSnapshot, type IdentityAppendCandidate, type IdentityEventContent, type MemoryEventRecord, type SceneRecord, type TaskPlanRecord } from "../../protocol/contracts/index.ts";
import { applyMatrixImpact, MemoryMatrixAggregator } from "./matrix.ts";
import { CrystalMemoryComponent } from "../../crystal/memory/index.ts";
import { SQLiteMemoryStore } from "../../components/memory/sqlite.memory.store.ts";
import type { PendingProjectOffer, PendingSkillOffer } from "../../components/memory/sqlite.memory.store.ts";
import { LocalWorkingMemoryStore } from "../../components/memory/local.working.store.ts";
import type { EpisodeRecord, WorkingMemoryStore } from "../../components/memory/working.store.ts";
import type { MemoryGraphStore } from "../../components/memory/graph.store.ts";
import { SQLiteGraphStore } from "../../components/memory/sqlite.graph.store.ts";
import { ConsolidationWorker } from "./consolidation.worker.ts";
import { HotMemoryCompressionWorker } from "./hot.memory.compression.worker.ts";
import { RetrospectiveLog } from "./retrospective.ts";
import { BackgroundScheduler } from "./background.scheduler.ts";
import { runBrainArchive, type BrainArchiveRunResult } from "./brain.archive.ts";
import { DormantSupervisor } from "../dormant/index.ts";
import { DreamWorkerImpl } from "./dream.worker.ts";
import { historyTurnFromEvent, type ChatHistoryPlanning, type ChatHistoryTurn } from "./history.ts";
import type { MemoryAction } from "./actions.ts";
import type {
    MemoryCandidate,
    MemoryEpisodeProvenance,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "../../components/memory/types.ts";
import type { WorkingMemoryHealthSnapshot } from "../../components/memory/working.store.ts";

export { parseMemoryActions, targetFileForMemoryAction } from "./actions.ts";
export { MarkdownMemoryStore } from "../../components/memory/markdown.store.ts";
export { ProjectMemoryStore } from "../../components/memory/project.memory.store.ts";
export { RetrospectiveLog, type RetrospectiveEntry } from "./retrospective.ts";
export { HotMemoryCompressionWorker, parseHotMemoryCompressionDecision } from "./hot.memory.compression.worker.ts";
export { SQLiteMemoryStore } from "../../components/memory/sqlite.memory.store.ts";
export { SQLiteGraphStore } from "../../components/memory/sqlite.graph.store.ts";
export type { MemoryAction } from "./actions.ts";
export type {
    MemoryCandidate,
    MemoryEpisodeProvenance,
    MemoryMatrixResult,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "../../components/memory/types.ts";

export interface BehaviorSnapshotRecord {
    corrections: MemoryEventRecord[];
    snapshot: MemoryEventRecord;
}

export type { ChatHistoryTurn } from "./history.ts";

export interface TurnPlanningInput {
    contextForks?: ContextForkRecord[];
    sceneRecords?: SceneRecord[];
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

@Module({ name: "memory", tags: ["flyflor", "boundary"] })
export class MemoryModule extends Memory {
    /** LF-R10 brain.db 权威源。warmup 时 open；旧 journal 不再参与热路径写入。 */
    private readonly brain: BrainStore;
    private brainOpened = false;
    private readonly markdown: MarkdownMemoryStore;
    private readonly projectMemory: ProjectMemoryStore;
    private readonly matrix: MemoryMatrixAggregator;
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
    private readonly activeMemoryUsers = new Set<string>();
    private readonly dormant: DormantSupervisor;
    private readonly model: ModelClient | undefined;
    private readonly projectScaffolder: ProjectScaffolder;
    /** 单例 embedding provider；用于 context.embedding 缺省时降级计算。 */
    private readonly embeddings: EmbeddingProvider;
    private readonly assistantMemoryByFocus = new Map<string, { current?: string; previous?: string }>();

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
        this.brain = new BrainStore({ dbPath: join(config.paths.home, "brain.db") });
        this.markdown = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        this.projectMemory = new ProjectMemoryStore(config.paths, this.events);
        this.matrix = new MemoryMatrixAggregator(config.memory.matrix);
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
        this.projectScaffolder = new ProjectScaffolder(config.paths, this.events);
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
                          projectSweeper: (userId: string) => this.sweepProjectClusters(userId),
                          skillSweeper: (userId: string) => this.sweepSkillCandidates(userId),
                          summarySweeper: async (userId: string) => {
                              const r = await this.runSummaryOnce(userId);
                              return { written: r?.written ?? 0 };
                          },
                          hotMemoryCompression: this.hotMemoryCompression ?? undefined,
                          hotMemoryCompressionIntervalMs:
                              Math.max(0, config.memory.tuning.hotMemoryCompression.intervalMinutes) * 60_000,
                          dormantSweeper: () => this.dormant.sweepOnce(),
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
        this.dormant = new DormantSupervisor(this.events, {
            idleMinutes: config.memory.tuning.dormant.idleMinutes,
        });
    }

    public getWorkingMemoryHealthSnapshot(): WorkingMemoryHealthSnapshot | undefined {
        return (this.workingMemory as { getHealthSnapshot?: () => WorkingMemoryHealthSnapshot } | null)?.getHealthSnapshot?.();
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
            for (const userId of [...this.activeMemoryUsers]) {
                await this.hotMemoryCompression.drain(userId);
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
        return { dreamEnabled: s.dreamEnabled, dreamBusy: s.dreamBusy, users: s.users };
    }

    /** CLI 手动触发一轮 dream pass；scheduler 未启用时返回零值。 */
    public async runDreamOnce(
        limit?: number,
        userId?: string,
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
        return this.scheduler.runDreamOnce(limit, userId);
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
                channel: input.message.route.channel,
                chatId: input.message.route.chatId,
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
                userId: input.message.user.id,
                channelId: input.message.route.channel,
                codenameId: input.codenameId,
                type: MemoryEventType.BehaviorSnapshot,
                role: ModelRole.Assistant,
                content: content as unknown as Record<string, unknown>,
                importance: 0.35,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryBehaviorSnapshotRecorded, {
                    snapshotId,
                    userId: input.message.user.id,
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
    public listBehaviorSnapshots(userId: string, options: { limit?: number } = {}): BehaviorSnapshotRecord[] {
        if (!this.brainOpened) return [];
        try {
            const snapshots = this.brain.listEvents({
                userId,
                type: MemoryEventType.BehaviorSnapshot,
                limit: options.limit ?? 20,
            });
            if (snapshots.length === 0) return [];
            const corrections = this.brain.listEvents({
                userId,
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
        const projectConstraintId = INBOX_PROJECT_CONSTRAINT_ID;

        const request: MemorySearchRequest = {
            query: message.text,
            scope: projectConstraintId,
            subjectId: message.user.id,
            channel: message.route.channel,
            chatId: message.route.chatId,
            limit: this.config.memory.retrieval.maxResults,
        };

        const [hippocampus, projectMemory, brainResults, markdown] = await Promise.all([
            this.assembleHippocampusContext(message, context),
            this.projectMemory.snapshot({
                maxChars: this.config.memory.retrieval.maxPromptChars,
                query: message.text,
                requestId: context?.requestId,
                scope: request.scope,
            }),
            this.recallVisibleBrainMemory(message, context),
            this.markdown.snapshot(),
        ]);
        const results = dedupeResults(brainResults);
        const memoryBody = renderMemoryPrompt(
            markdown.prompt,
            projectMemory.prompt,
            hippocampus,
            results,
            this.config.memory.retrieval.maxPromptChars,
        );

        // 项目候选 nudge 注入：若该 userId 有待确认 offer，把 nudge 拼到 memoryBody 顶部。
        // 复用 Path A：用户下一轮回复若给出明确意图，model 自然在 memory action 的 signals 中
        // 抬高 projectIntent，commitTurn 的 detectExplicitIntent 即触发 scaffolder。
        const [offer, skillOffer] = await Promise.all([
            this.sqlite.getProjectOffer(message.user.id),
            this.sqlite.getSkillOffer(message.user.id),
        ]);
        const nudges: string[] = [];
        if (offer) nudges.push(renderProjectOfferNudge(offer));
        if (skillOffer) nudges.push(renderSkillOfferNudge(skillOffer));

        // LF-R3 Ask 一等公民：若 brain 中存在 pending ask，把 [continuation] 块拼到顶部，
        // 让模型把用户下一条消息当作对该 ask 的答复处理。零字符匹配——是否注入只看
        // brain 是否有未答复的 ask 事件，runtime 不解析任何对话文本。
        const continuation = this.renderPendingAskContinuation(message.user.id);
        if (continuation) nudges.unshift(continuation);

        // LF-R4 Ghost Context：把活跃的高分 ghost-context 拼成 [ghost-hint] 块注入
        // prompt。零字符匹配——是否注入只看 brain 的 status + decayScore 资源指标，
        // 不解析任何对话文本。用户可在回复里显式 resume / fork / fresh。
        const ghostHint = this.renderGhostHint(message.user.id);
        if (ghostHint) nudges.push(ghostHint);

        // ContextFork：无 session 设计下的显式分叉上下文。只有调用方传入
        // context.contextForkId 时才注入范围边界；runtime 不从文本推断 fork。
        const forkBlock = this.renderContextForkBlock(message.user.id, context?.contextForkId);
        if (forkBlock) nudges.push(forkBlock);

        // LF-R5 Identity：把当前 live identity append 拼成 [identity] 块注入 prompt 顶部。
        // 零字符匹配——是否注入只看 brain 行的 status，runtime 不解析 content 语义。
        const identityBlock = this.renderIdentityBlock(message.user.id);
        if (identityBlock) nudges.unshift(identityBlock);

        // LF-R8 Dormant 行为联动：若上一轮该用户被 sweep 进 Dormant，
        // 本轮 user 输入会触发 awaken，但此时 touch() 还未发生（在 persistTurn
        // 阶段才执行），所以 peekResumeHint 仍能返回旧 mode 的 idleMs。
        // 仅注入资源指标 idleMinutes，让模型对长时间未互动的用户更 graceful。
        // 零字符匹配——不读消息文本，只用 (now - lastInputAt) 资源指标。
        const resumeBlock = this.renderDormantResumeBlock(message.user.id);
        if (resumeBlock) nudges.unshift(resumeBlock);

        // EQ-01 slice B：把当前 EQ state 渲染为 `[eq-context]` 块注入 prompt 顶部。
        // 零字符匹配——只读 brain.memory_eq_state 结构化字段 + 资源指标 decay；
        // 不解析消息文本，不基于文本派生 label。
        const eqBlock = this.renderEqContextBlock(message.user.id);
        if (eqBlock) nudges.unshift(eqBlock);

        const body = nudges.length > 0 ? `${nudges.join("\n\n")}\n\n${memoryBody}` : memoryBody;

        this.events.publish(
            event(RuntimeEventType.MemoryPromptBuilt, {
                recallResults: results.length,
                atomScoreThreshold: this.config.memory.tuning.atomScore.visibilityThreshold,
                hippocampusActivated: hippocampus ? true : false,
                brainPromptRecallResults: brainResults.length,
                projectConstraintId,
                projectMemoryActivated: projectMemory.prompt ? true : false,
                projectMemoryManifestPath: projectMemory.manifest.paths.manifest,
                projectMemoryRecallReceiptId: projectMemory.receipt?.id,
                projectMemoryRecallResults: projectMemory.results.length,
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
        const userId = message.user.id;
        const ringSize = this.config.memory.retrieval.maxResults;
        const [episodeIds, hotConcepts] = await Promise.all([
            this.workingMemory.readContextRing(userId, ringSize),
            this.workingMemory.hotConcepts(userId, 16),
        ]);
        if (episodeIds.length === 0) return undefined;
        const records = await Promise.all(episodeIds.map((id) => this.workingMemory!.readEpisode(userId, id)));
        const visibleByEpisode = this.visibleAtomsForEpisodes(userId, records);
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
        const activated = spreadActivation({
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

        // LF-R3 Ask 一等公民：先把"用户对上一轮 ask 的答复"落到 brain（ask-answer-pair 事件），
        // 再处理本轮可能新发起的 ask。两个写入顺序固定，避免 chain 被错误跨轮接续。
        const pendingAskBefore = this.findPendingAsk(message.user.id);
        if (pendingAskBefore) {
            this.recordAskAnswerPair(pendingAskBefore.id, pendingAskBefore.snapshotId, message);
        }

        const projectTrigger = detectExplicitIntent(actions);
        const createdAt = new Date(context.now).toISOString();
        // P2 inbox 收口：把 codename 持久化提前到 atom 写之前，使 inbox projectId
        // 能命名空间化为 "inbox:cn-<codenameId>"。零字符匹配——只读结构化 action.codename。
        const codenameId = this.persistCodenamesFromActions(message.user.id, actions, createdAt);
        const projectConstraintId = deriveProjectConstraintId(message, projectTrigger.kind, codenameId);

        // brain.db 是生命事件事实层：每轮先写权威事件，再从同轮结构化 memory action
        // 派生 atom。失败直接抛出，避免半状态继续运行。
        const sourceEventId = await this.writeTurnToBrain(
            message,
            reply,
            context,
            actions,
            provenance,
            projectConstraintId,
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
            requestId: context.requestId,
            sourceAskId: askEventId,
            sourceEventId,
            userId: message.user.id,
        });

        await this.writeEpisodeToWorkingMemory(message, reply, context, importanceFromActions(actions), provenance);
        // 把当前用户登记进后台调度器，确保 ConsolidationWorker / decay sweep 会按节拍 drain。
        // 不扫描外部后端，只信任活跃 turn 触发，避免把后端存储变成全局枚举入口。
        this.activeMemoryUsers.add(message.user.id);
        this.scheduler?.noteUserTurn(message.user.id);
        this.dormant.touch(message.user.id);

        // EQ-01 slice A：若本轮模型同轮在 memoryAction.eq 给出情绪分类，
        // 落 brain.memory_eq_state（latest-only UPSERT）。零字符匹配——
        // runtime 不读消息文本派生 label，只读已规范化的结构化字段。
        this.persistEqFromActions(message.user.id, actions);

        // 项目脚手架触发（仅显式意图通道，幂等；cluster 通道由后台 sweep 触发，本路径不参与）。
        if (projectTrigger.kind !== ProjectTriggerKind.None) {
            await this.projectScaffolder.scaffold({
                projectId: projectConstraintId,
                title: deriveProjectTitle(message),
                goal: message.text.slice(0, 500),
                userId: message.user.id,
                trigger: projectTrigger,
                createdAt: new Date(context.now).toISOString(),
            });
        }
        // 项目候选 offer 生命周期：显式触发即消费，否则 ttl-1。
        await this.noteProjectOfferTurn(message.user.id, projectTrigger.kind !== ProjectTriggerKind.None);

        // 技能候选 offer 生命周期：用户在本轮回复中明确同意（skillPromotionIntent ≥ 0.7）即
        // 立即从 pending_skill_offer 生成 SKILL.md；否则 ttl-1。完全与 project offer 解耦。
        const skillTrigger = detectExplicitSkillIntent(actions);
        if (skillTrigger.kind !== ProjectTriggerKind.None) {
            await this.consumeSkillOffer(message.user.id);
        } else {
            await this.noteSkillOfferTurn(message.user.id, false);
        }

        this.rememberAssistantForFocus(message, reply.text);
        const candidates = actions
            .map((action) =>
                candidateFromAction(
                    action,
                    message,
                    reply,
                    context,
                    projectConstraintId,
                    turnEpisodeId(message, context),
                    this.config.memory.weights,
                    this.matrix,
                ),
            )
            .slice(0, this.config.memory.candidates.maxCandidatesPerTurn);

        // 三路并行：candidate 写入 / project memory / crystal 记录，任一失败都向上抛出。
        const projectMemoryPipeline =
            projectTrigger.kind !== ProjectTriggerKind.None
                ? this.projectMemory.recordTurn({
                      message,
                      reply,
                      context,
                      trigger: projectTrigger,
                      candidates,
                      projectId: projectConstraintId,
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

        const [candidateResults, projectRecords] = await Promise.all([candidatePipeline, projectMemoryPipeline]);
        const promoted: MemoryRecord[] = candidateResults.filter((r): r is MemoryRecord => r !== undefined);
        const promotedRecords = [...promoted, ...projectRecords];

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
                    projectConstraintId,
                    projectPromoted: projectRecords.length,
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
        userId: string;
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
            await this.workingMemory.writeEpisode({
                userId: input.userId,
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
        userId: string;
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
            if (input.category === FeedbackCategory.LocalCorrection && this.workingMemory) {
                const embedding = await this.embeddings.embed(input.currentUserText);
                await this.workingMemory.writeEpisode({
                    userId: input.userId,
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
                        userId: input.userId,
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
                        const top = await this.graph.recallMemoryNodes({ userId: input.userId, embedding, limit: 1 });
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
                userId: input.userId,
                category: input.category,
                extractedFact: input.extractedFact,
                currentUserText: input.currentUserText,
                previousAssistantText: input.previousAssistantText,
                requestId: input.requestId,
            });
            this.events.publish(
                event(
                    RuntimeEventType.MemoryFeedbackClassified,
                    { userId: input.userId, category: input.category, hasFact: Boolean(input.extractedFact) },
                    input.requestId,
                ),
            );
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryFeedbackFailed,
                    { userId: input.userId, category: input.category, error: String(err) },
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
            const previousAssistantText = this.assistantMemoryByFocus.get(focusKeyForMessage(message))?.previous;
            if (!previousAssistantText) return;
            const classification = await classifyFeedback(this.model, {
                previousAssistantText,
                currentUserText: message.text,
            });
            if (classification.category === FeedbackCategory.None) {
                this.events.publish(
                    event(
                        RuntimeEventType.MemoryFeedbackClassified,
                        { userId: message.user.id, category: classification.category, hasFact: false },
                        context.requestId,
                    ),
                );
                return;
            }
            await this.applyFeedback({
                userId: message.user.id,
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
                    { userId: message.user.id, stage: "classify", error: String(err) },
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
        userId: string;
        category: FeedbackCategory;
        extractedFact?: string;
        currentUserText: string;
        previousAssistantText: string;
        requestId?: string;
    }): string | null {
        if (!this.brainOpened) return null;
        const snapshot = this.findLatestBehaviorSnapshot(input.userId, input.requestId);
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
                userId: input.userId,
                channelId: snapshot.channelId,
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
                    userId: input.userId,
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

    private findLatestBehaviorSnapshot(userId: string, excludeRequestId?: string): MemoryEventRecord | null {
        if (!this.brainOpened) return null;
        try {
            const rows = this.brain.listEvents({
                userId,
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

    private rememberAssistantForFocus(message: GatewayMessage, assistantText: string): void {
        const key = focusKeyForMessage(message);
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
        projectConstraintId: string,
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
                    const existing = this.brain.getCodenameByName(message.user.id, action.codename.name);
                    codenameUseCount = existing?.useCount ?? 0;
                }
                return brainAtomFromAction({
                    action,
                    embedding,
                    episodeId,
                    index,
                    matrix: this.matrix,
                    message,
                    projectConstraintId,
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
                reply,
                provenance: normalizedProvenance,
                createdAt,
                projectConstraintId,
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
        reply: GatewayReply;
        provenance: MemoryEpisodeProvenance;
        createdAt: string;
        projectConstraintId: string;
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
                userId: input.message.user.id,
                channelId: input.message.route.channel,
                codenameId: input.codenameId ?? input.projectConstraintId,
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
                        codenameId: input.codenameId ?? input.projectConstraintId,
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
        userId: string,
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
                const existing = this.brain.getCodenameByName(userId, codename.name);
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
                    userId,
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
    private persistEqFromActions(userId: string, actions: MemoryAction[]): void {
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
                userId,
                valence: last.valence,
                arousal: last.arousal,
                dominance: last.dominance,
                label: last.label,
                confidence: last.confidence,
                updatedAt,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryEqStateUpdated, {
                    userId,
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
     * LF-R2: codename 升格通路。useCount + age 满足阈值且尚未绑定 projectId 时，
     * 调用 ProjectScaffolder 在 workspace/projects/<projectId>/ 生成骨架，并把
     * projectId 写回 codenames 表。完全幂等；失败发事件后抛出。
     */
    public async promoteCodename(
        codenameId: string,
        opts: { force?: boolean; createdAt?: string } = {},
    ): Promise<{ promoted: boolean; projectId?: string; rationale: string }> {
        if (!this.brainOpened) return { promoted: false, rationale: "brain-closed" };
        try {
            const result = await promoteCodenameHelper(this.brain, this.projectScaffolder, codenameId, opts);
            if (result.promoted && result.record && result.projectId) {
                this.events.publish(
                    event(RuntimeEventType.MemoryCodenamePromoted, {
                        id: result.record.id,
                        name: result.record.name,
                        projectId: result.projectId,
                        useCount: result.record.useCount,
                    }),
                );
            }
            return { promoted: result.promoted, projectId: result.projectId, rationale: result.rationale };
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
        if (record.projectId) return;
        await this.promoteCodename(record.id, { createdAt });
    }

    // ─── LF-R3 Ask 一等公民 ────────────────────────────────────────

    /**
     * Runtime 用来查询当前用户是否有未答复的 ask、对应链深度。
     * 用于 cap enforcement：模型若要继续 ask 而 chainDepth+1 > maxChainDepth，
     * runtime 抛弃 ask 改走 reply。零字符匹配。
     */
    public peekActiveAsk(userId: string): { askId: string; chainDepth: number; ask: AgentAsk } | null {
        const pending = this.findPendingAsk(userId);
        if (!pending) return null;
        return { askId: pending.id, chainDepth: pending.chainDepth, ask: pending.ask };
    }

    public listChatHistory(userId: string, options: { beforeTs?: number; limit?: number } = {}): ChatHistoryTurn[] {
        if (!this.config.memory.enabled) {
            throw new Error("Chat history is unavailable because memory is disabled.");
        }
        if (!this.brainOpened) {
            throw new Error("Chat history is unavailable because brain.db is not opened.");
        }
        const rows = this.brain.listEvents({
            userId,
            type: MemoryEventType.Event,
            untilTs: options.beforeTs,
            limit: options.limit ?? 20,
        });
        return rows.map((row) => historyTurnFromEvent(row, this.historyPlanningForEvent(userId, row.id))).reverse();
    }

    /**
     * Planning/fork/history write path. The semantic decision comes from model
     * protocol blocks or blackboard structured output; this component only
     * attaches source ids and stores summary records in brain.db.
     */
    public recordTurnPlanning(input: TurnPlanningInput & {
        blackboardTurnId?: string;
        requestId?: string;
        sourceAskId?: string;
        sourceEventId: string;
        userId: string;
    }): void {
        if (!this.brainOpened) return;
        const withSourcePlan = (plan: TaskPlanRecord): TaskPlanRecord => ({
            ...plan,
            userId: input.userId,
            sourceAskId: plan.sourceAskId ?? input.sourceAskId,
            sourceBlackboardTurnId: plan.sourceBlackboardTurnId ?? input.blackboardTurnId,
            sourceEventId: plan.sourceEventId ?? input.sourceEventId,
        });
        const withSourceFork = (fork: ContextForkRecord): ContextForkRecord => ({
            ...fork,
            userId: input.userId,
            sourceAskId: fork.sourceAskId ?? input.sourceAskId,
            sourceBlackboardTurnId: fork.sourceBlackboardTurnId ?? input.blackboardTurnId,
            sourceEventId: fork.sourceEventId ?? input.sourceEventId,
            inheritedEventIds: uniqueStrings([input.sourceEventId, ...fork.inheritedEventIds]),
        });
        const withSourceScene = (scene: SceneRecord): SceneRecord => ({
            ...scene,
            userId: input.userId,
            blackboardTurnId: scene.blackboardTurnId ?? input.blackboardTurnId,
            sourceEventId: scene.sourceEventId ?? input.sourceEventId,
        });
        try {
            for (const plan of (input.taskPlans ?? []).slice(0, 4).map(withSourcePlan)) {
                this.brain.writeTaskPlan(plan);
                this.events.publish(
                    event(RuntimeEventType.MemoryTaskPlanWritten, {
                        planId: plan.id,
                        userId: input.userId,
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
                        userId: input.userId,
                        maxContextTokens: fork.maxContextTokens,
                    }, input.requestId),
                );
            }
            for (const scene of (input.sceneRecords ?? []).slice(0, 8).map(withSourceScene)) {
                this.brain.writeSceneRecord(scene);
                this.events.publish(
                    event(RuntimeEventType.MemorySceneRecordWritten, {
                        sceneId: scene.id,
                        userId: input.userId,
                        kind: scene.kind,
                        blackboardTurnId: scene.blackboardTurnId,
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

    private historyPlanningForEvent(
        userId: string,
        sourceEventId: string,
    ): ChatHistoryPlanning {
        return {
            contextForks: this.brain.listContextForks({ userId, sourceEventId, limit: 8 }),
            scenes: this.brain.listSceneRecords({ userId, sourceEventId, limit: 16 }),
            taskPlans: this.brain.listTaskPlans({ userId, sourceEventId, limit: 8 }),
        };
    }

    /**
     * EQ-01 slice C：EQ 的唯一读路径。返回已 decay 的最新状态（资源指标 dt = now - updatedAt）。
     * 零字符匹配——只读 brain 行 + 数字衰减，不基于消息文本派生 label。
     * 没有 state 或 brain 未开则返回 null（只作为语气提示；不参与路由、工具或 ask 决策）。
     */
    public peekEqState(userId: string, nowMs: number = Date.now()): EqState | null {
        if (!this.brainOpened) return null;
        try {
            const state = this.brain.getEqState(userId);
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
        userId: string,
    ): { id: string; chainDepth: number; ask: AgentAsk; snapshotId?: string } | null {
        if (!this.brainOpened) return null;
        try {
            const row = this.brain.getLatestPendingAsk(userId);
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
     * LF-R8：若该用户上一轮被 sweep 进 Dormant，把 idle 时长以 `[runtime-resume]`
     * 块注入 prompt 顶部。零字符匹配——只读 dormant supervisor 的资源指标。
     */
    private renderDormantResumeBlock(userId: string): string | undefined {
        const hint = this.dormant.peekResumeHint(userId);
        if (!hint) return undefined;
        const idleMinutes = Math.max(1, Math.round(hint.idleMs / 60000));
        const idleHours = idleMinutes / 60;
        const bucket = idleMinutes < 60
            ? `${idleMinutes}m`
            : idleHours < 48
                ? `${idleHours.toFixed(1)}h`
                : `${(idleHours / 24).toFixed(1)}d`;
        return renderRuntimeDormantResumePrompt({ idleBucket: bucket });
    }

    /**
     * EQ-01 slice B：把 brain.memory_eq_state 中的最新情绪状态渲染为 `[eq-context]` 块。
     * - decay 在读时计算（资源指标 dt = now - updatedAt），label / dominance 不衰减；
     * - 衰减后 |valence| < 0.05 且 arousal < 0.05 时视为已平复，跳过注入（避免噪音）；
     * - 注入内容只包含结构化字段（label、衰减后 valence/arousal/dominance、confidence、age 分桶）；
     * - 只用于语气、暖度和节奏提示，不参与路由、工具选择、问答链深度或其他决策。
     */
    private renderEqContextBlock(userId: string): string | undefined {
        if (!this.brainOpened) return undefined;
        let state: EqState | null;
        try {
            state = this.brain.getEqState(userId);
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
            directive: renderEqDirectiveLine(deriveEqDirective(decayed)),
            dominance: decayed.dominance.toFixed(2),
            label: decayed.label,
            valence: decayed.valence.toFixed(2),
        });
    }

    /**
     * 把 pending ask 拼成可注入 prompt 的 [continuation] 块。零字符匹配——
     * 是否注入只看 brain 是否存在 pending ask，runtime 不做任何文本判断。
     */
    private renderPendingAskContinuation(userId: string): string | undefined {
        const pending = this.findPendingAsk(userId);
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
     * LF-R4：把活跃的高分 ghost-context 渲染为 `[ghost-hint]` 块。仅按
     * decayScore 资源指标排序（不解析任何文本语义），最多展示 3 条。pending ask
     * 的 sibling ghost 已通过 `[continuation]` 单独注入，这里跳过避免重复。
     *
     * 模型可显式输出 `kind: 'fork' | 'fresh' | 'resume'` 的处理方式（slice D 后续完善），
     * 当前仅暴露候选清单，由模型同轮自行判断是否需要 fork / fresh。
     */
    private renderGhostHint(userId: string): string | undefined {
        if (!this.brainOpened) return undefined;
        let ghosts: MemoryEventRecord[];
        try {
            ghosts = this.brain.listActiveGhosts(userId, { limit: 12 });
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.render",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
        if (ghosts.length === 0) return undefined;

        const pending = this.findPendingAsk(userId);
        const pendingAskId = pending?.id;
        const weightTable = this.config.memory.tuning.ghost.evidenceWeight;

        type Scored = { row: MemoryEventRecord; score: number; tag: string };
        const scored: Scored[] = [];
        for (const row of ghosts) {
            if (pendingAskId && row.parentId === pendingAskId) continue;
            const state = this.brain.getState(row.id);
            const base = state?.decayScore ?? 1;
            const { weight, tag } = this.resolveGhostEvidenceWeight(row, weightTable);
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
            const c = row.content as Partial<GhostContextEventContent>;
            const title = c.userFacing?.title?.slice(0, 120) ?? `ghost:${c.reason ?? "unknown"}`;
            const hint = c.userFacing?.contextHint?.slice(0, 200);
            const ageHours = Math.max(0, Math.round((Date.now() - row.ts) / 36e5));
            entries.push(
                `- id=${row.id} reason=${c.reason ?? "-"} evidence=${tag} score=${score.toFixed(2)} age=${ageHours}h :: ${title}${hint ? ` (${hint})` : ""}`,
            );
        }
        return renderRuntimeGhostHintPrompt({ ghostEntries: entries.join("\n") });
    }

    private renderContextForkBlock(userId: string, contextForkId: string | undefined): string | undefined {
        if (!this.brainOpened || !contextForkId) return undefined;
        const fork = this.brain.getContextFork(contextForkId);
        if (!fork || fork.userId !== userId) return undefined;
        return [
            "[context-fork]",
            `id: ${fork.id}`,
            `title: ${fork.title}`,
            `scope: ${fork.scopeSummary}`,
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
    private renderIdentityBlock(userId: string): string | undefined {
        if (!this.brainOpened) return undefined;
        let rows: MemoryEventRecord[];
        try {
            rows = this.brain.listActiveIdentity(userId, { limit: 16 });
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
     * LF-R4 evidence weight：根据 ghost 当前结构化状态选权重。
     * - state.status === 'abandoned' → 0（不应出现在 listActiveGhosts，但兜底）
     * - content.continuationCompleted === true（模型已在某轮标记 fork/fresh）→ continuationCompleted（0.75）
     * - sibling ask 已收到答复（存在 ask-answer-pair 事件）→ askAnswered（0.85）
     * - 其它 → default
     * 仅消费结构化字段（state.status + content flag + parent_id + 子事件类型），
     * 不解析任何对话文本。
     */
    private resolveGhostEvidenceWeight(
        row: MemoryEventRecord,
        table: typeof this.config.memory.tuning.ghost.evidenceWeight,
    ): { weight: number; tag: string } {
        const state = this.brain.getState(row.id);
        if (state?.status === MemoryEventStatus.Abandoned) {
            return { weight: table.abandoned, tag: "abandoned" };
        }
        const c = row.content as Partial<GhostContextEventContent>;
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

    private recordAskAnswerPair(askEventId: string, snapshotId: string | undefined, message: GatewayMessage): void {
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
                userId: message.user.id,
                channelId: message.route.channel,
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
                    userId: message.user.id,
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
        const maxChainDepth = Math.max(1, this.config.memory.tuning.ghost.maxChainDepth);
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
                userId: message.user.id,
                channelId: message.route.channel,
                type: MemoryEventType.Ask,
                content: content as unknown as Record<string, unknown>,
                parentId: parentAskId,
                importance: 0.9,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryAskRecorded, {
                    askEventId: askId,
                    snapshotId,
                    userId: message.user.id,
                    reason: ask.reason,
                    chainDepth,
                }),
            );
            if (chainDepth > maxChainDepth) {
                this.events.publish(
                    event(RuntimeEventType.MemoryAskChainCapped, {
                        askEventId: askId,
                        userId: message.user.id,
                        chainDepth,
                        maxChainDepth,
                    }),
                );
            }
            // LF-R4：每条 ask 同步写一条 ghost-context 事件（parent_id 指向 ask），
            // 用户可见 + 可 resume / drop / pin。userFacing.title 缺省 fallback 到
            // ask.prompt 首行（短路降级，不算字符匹配——纯结构化字段）。
            this.recordGhostFromAsk({
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

    // ─── LF-R4 Ghost Context（与 LF-R3 Ask 同根）──────────────────

    /**
     * 列出当前用户的活跃 ghost-context 事件（live/resumed），ts 倒序。
     * `codenameId === null` 显式查询无 codename 的 ghost；`undefined` 不限定。
     */
    public listActiveGhosts(
        userId: string,
        options: { codenameId?: string | null; limit?: number } = {},
    ): MemoryEventRecord[] {
        if (!this.brainOpened) return [];
        try {
            return this.brain.listActiveGhosts(userId, options);
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.list",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** 取单个 ghost 详情；找不到或非 ghost-context 类型则返回 null。 */
    public getGhost(ghostEventId: string): MemoryEventRecord | null {
        if (!this.brainOpened) return null;
        try {
            const row = this.brain.getEvent(ghostEventId);
            return row?.type === MemoryEventType.GhostContext ? row : null;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.get",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** 用户主动 resume：拉回峰值，state=resumed + resumedAt。runtime 后续按 ghost 重建上下文。 */
    public resumeGhost(ghostEventId: string, nowMs = Date.now()): boolean {
        const ghost = this.getGhost(ghostEventId);
        if (!ghost) return false;
        try {
            this.brain.upsertState(ghost.id, {
                status: MemoryEventStatus.Resumed,
                resumedAt: nowMs,
                lastAccessed: nowMs,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryGhostResumed, {
                    ghostEventId: ghost.id,
                    userId: ghost.userId,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.resume",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /** 用户主动 drop：state=abandoned，不再展示，evidence weight=0。 */
    public dropGhost(ghostEventId: string): boolean {
        const ghost = this.getGhost(ghostEventId);
        if (!ghost) return false;
        try {
            this.brain.upsertState(ghost.id, { status: MemoryEventStatus.Abandoned });
            this.events.publish(
                event(RuntimeEventType.MemoryGhostDropped, {
                    ghostEventId: ghost.id,
                    userId: ghost.userId,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.drop",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * 用户 pin：把 decay_score 半衰期乘以 `tuning.ghost.pinHalflifeMultiplier`（默认 3.0）。
     * 实装层面：直接把 decayScore 上调到 current * multiplier，仍走衰减管道（不冻结）。
     */
    public pinGhost(ghostEventId: string): boolean {
        const ghost = this.getGhost(ghostEventId);
        if (!ghost) return false;
        try {
            const state = this.brain.getState(ghost.id);
            const multiplier = Math.max(1, this.config.memory.tuning.ghost.pinHalflifeMultiplier);
            const baseScore = state?.decayScore ?? 1;
            this.brain.upsertState(ghost.id, { decayScore: baseScore * multiplier });
            this.events.publish(
                event(RuntimeEventType.MemoryGhostPinned, {
                    ghostEventId: ghost.id,
                    userId: ghost.userId,
                    multiplier,
                }),
            );
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.pin",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R4 fork/fresh hint：把模型同轮输出的 ghost 决策落库。
     * 仅消费 `{ghostId, kind}` 结构化字段，不读文本语义。
     * - `resume`：调 resumeGhost（state → resumed）。
     * - `fork` / `fresh`：在 ghost-context content 上挂 `continuationCompleted=true` + `lastKind=kind`，
     *   评分阶段 `resolveGhostEvidenceWeight` 走 `continuationCompleted` 权重（默认 0.75）。
     * 未命中的 ghostId 视为模型结构化输出引用漂移，跳过该项并继续应用其它决策。
     * 返回成功应用的条数。
     */
    public applyGhostDecisions(decisions: GhostDecision[]): number {
        if (!this.brainOpened || decisions.length === 0) return 0;
        let applied = 0;
        for (const decision of decisions) {
            const ghost = this.getGhost(decision.ghostId);
            if (!ghost) continue;
            try {
                if (decision.kind === GhostDecisionKind.Resume) {
                    if (!this.resumeGhost(decision.ghostId)) {
                        throw new Error(`Ghost decision resume failed for ghostId: ${decision.ghostId}`);
                    }
                } else {
                    this.brain.patchGhostContent(decision.ghostId, {
                        continuationCompleted: true,
                        lastKind: decision.kind,
                    });
                }
                applied += 1;
                this.events.publish(
                    event(RuntimeEventType.MemoryGhostDecisionApplied, {
                        ghostEventId: decision.ghostId,
                        userId: ghost.userId,
                        kind: decision.kind,
                    }),
                );
            } catch (err) {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "ghost.decision",
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
        userId: string;
        candidates: IdentityAppendCandidate[];
        codenameId?: string;
        channelId?: string;
        requestId?: string;
        nowMs?: number;
    }): string[] {
        if (!this.brainOpened || input.candidates.length === 0) return [];
        const ts = input.nowMs ?? Date.now();
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
                    userId: input.userId,
                    channelId: input.channelId,
                    codenameId: input.codenameId,
                    type: MemoryEventType.IdentityAppend,
                    content: content as unknown as Record<string, unknown>,
                    importance: 0.6 + 0.3 * Math.max(0, Math.min(1, content.confidence)),
                });
                writtenIds.push(eventId);
                this.events.publish(
                    event(RuntimeEventType.MemoryIdentityAppended, {
                        eventId,
                        userId: input.userId,
                        kind: candidate.kind,
                    }),
                );
            } catch (err) {
                this.events.publish(
                    event(RuntimeEventType.MemoryBrainWriteFailed, {
                        op: "identity.append",
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
        userId: string,
        options: { limit?: number; includeReverted?: boolean } = {},
    ): MemoryEventRecord[] {
        if (!this.brainOpened) return [];
        try {
            return options.includeReverted
                ? this.brain.listAllIdentity(userId, { limit: options.limit })
                : this.brain.listActiveIdentity(userId, { limit: options.limit });
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
            // Lightweight in-place patch shares the ghost path's UPDATE semantics.
            // Reuse low-level update by reusing patchGhostContent? It's ghost-typed only;
            // use a dedicated brain helper to keep the type check clean.
            this.brain.updateEventContent(eventId, nextContent as unknown as Record<string, unknown>);
            this.events.publish(
                event(RuntimeEventType.MemoryIdentityReverted, {
                    eventId,
                    userId: row.userId,
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
     * LF-R5 slice B：跑一次该用户的 daily + weekly summary 聚合。
     * 纯结构化字段聚合（type / role / codenameId / ask reason / ghost reason 计数），
     * 不调 LLM、不读 content 文本。返回 `null` 表示 brain 未开或当前维护锁忙。
     */
    public async runSummaryOnce(userId: string, nowMs?: number): Promise<SummaryRunResult | null> {
        if (!this.brainOpened || this.brainMaintenanceBusy) return null;
        this.brainMaintenanceBusy = true;
        try {
            const worker = new SummaryWorker(this.brain, {
                rollingWindowDays: this.config.memory.tuning.summary.rollingWindowDays,
                trigger: this.config.memory.tuning.summary.trigger,
                minIntervalHours: this.config.memory.tuning.summary.minIntervalHours,
            });
            const result = worker.runOnceForUser(userId, nowMs);
            this.events.publish(
                event(RuntimeEventType.MemorySummaryWritten, {
                    userId,
                    written: result.written,
                    skippedByInterval: result.skippedByInterval,
                    skippedEmpty: result.skippedEmpty,
                }),
            );
            await this.embedWrittenSummaries(userId, result.writtenIds);
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

    /**
     * LF-R14：运行时自动 brain.db 月级冷归档。
     * 只移动 state=archived 且早于 cutoff 的事件；live/resumed 事件不动。
     */
    public async runBrainArchiveOnce(nowMs?: number): Promise<BrainArchiveRunResult | null> {
        if (!this.brainOpened || this.brainMaintenanceBusy) return null;
        this.brainMaintenanceBusy = true;
        try {
            const result = await runBrainArchive({
                brainPath: join(this.config.paths.home, "brain.db"),
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
                    statesCopied: result.statesCopied,
                    summariesCopied: result.summariesCopied,
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

    private async embedWrittenSummaries(userId: string, summaryIds: string[]): Promise<void> {
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
                    userId,
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
                    userId,
                    written,
                }),
            );
        }
        if (failures.length > 0) {
            const failedIds = failures.map((failure) => failure.summaryId).join(", ");
            throw new Error(`Summary embedding write failed for ${failedIds}`);
        }
    }

    /** LF-R5 slice D：Dormant 当前态查询。 */
    public runtimeModeOf(userId: string): typeof RuntimeMode.Chat | typeof RuntimeMode.Dormant {
        return this.dormant.modeOf(userId);
    }

    /** LF-R5 slice D：手动触发一次 dormant sweep（测试 / CLI）。 */
    public sweepDormantOnce(): { entered: number } {
        return this.dormant.sweepOnce();
    }

    /** LF-R5 slice D：dormant 状态快照（CLI / 诊断）。 */
    public dormantSnapshot(): Array<{ userId: string; mode: string; lastInputAt: number; idleMs: number }> {
        return this.dormant.snapshot();
    }

    /**
     * LF-R4：runtime 在非 ask 路径触发的 ghost-context 写入。
     * 适用于 `tool-failure` / `blackboard-cap` / `process-restart` 三种 reason；
     * 调用方必须显式给出 `userFacing` 字段（不做 prompt fallback，runtime 不解析文本语义）。
     * `ask` reason 的 ghost 仍由 `recordGhostFromAsk` 自动写入，不要走本入口。
     */
    public recordGhostFromReason(input: {
        userId: string;
        reason: Exclude<GhostContextReason, typeof GhostContextReason.Ask>;
        userFacing: { title: string; contextHint?: string };
        snapshot?: {
            originalUserMessage?: string;
            blackboardTurnId?: string;
            mcpCallProgress?: Array<{ tool: string; status: string; lastError?: string }>;
        };
        parentEventId?: string;
        codenameId?: string;
        channelId?: string;
        requestId?: string;
        importance?: number;
        nowMs?: number;
    }): string | null {
        if (!this.brainOpened) return null;
        const ghostId = `ghost-${crypto.randomUUID()}`;
        const ts = input.nowMs ?? Date.now();
        const title = input.userFacing.title.trim().slice(0, 120);
        if (!title) return null;
        const contextHint = input.userFacing.contextHint?.trim().slice(0, 500);
        const snapshot: GhostSnapshot = {};
        if (input.snapshot?.originalUserMessage) snapshot.originalUserMessage = input.snapshot.originalUserMessage;
        if (input.snapshot?.blackboardTurnId) snapshot.blackboardTurnId = input.snapshot.blackboardTurnId;
        if (input.snapshot?.mcpCallProgress && input.snapshot.mcpCallProgress.length > 0) {
            snapshot.mcpCallProgress = input.snapshot.mcpCallProgress;
        }
        const content: GhostContextEventContent = {
            ghostId,
            reason: input.reason,
            userFacing: contextHint ? { title, contextHint } : { title },
            ...(Object.keys(snapshot).length > 0 ? { snapshot } : {}),
            ...(input.codenameId ? { codenameId: input.codenameId } : {}),
            ...(input.requestId ? { requestId: input.requestId } : {}),
        };
        try {
            this.brain.appendEvent({
                id: ghostId,
                ts,
                userId: input.userId,
                channelId: input.channelId,
                codenameId: input.codenameId,
                type: MemoryEventType.GhostContext,
                content: content as unknown as Record<string, unknown>,
                parentId: input.parentEventId,
                importance: input.importance ?? 0.6,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryGhostRecorded, {
                    ghostEventId: ghostId,
                    userId: input.userId,
                    reason: input.reason,
                }),
            );
            return ghostId;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.record",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        }
    }

    /**
     * LF-R4：每次 recordAskEvent 完毕后写一条 ghost-context 事件。
     * userFacing.title 必须由模型同轮结构化 `ask.ghostHint.title` 给出。
     */
    private recordGhostFromAsk(input: {
        askId: string;
        snapshotId: string;
        ask: AgentAsk;
        message: GatewayMessage;
        context: RuntimeContext;
        nowMs: number;
    }): void {
        const { askId, snapshotId, ask, message, context, nowMs } = input;
        const hintTitle = ask.ghostHint?.title?.trim();
        const hintContext = ask.ghostHint?.contextHint?.trim();
        const title = (hintTitle || firstLine(ask.prompt)).slice(0, 120);
        const contextHint = hintContext ?? ask.rationale;
        // LF-R4：ask.reason 是结构化枚举字段，结构化 → 结构化的映射不算字符匹配。
        // 黑板封顶的 ask 是 runtime 合成而非模型表达，单独标记为 reason='blackboard-cap'，
        // 列表 / 召回 / fork 决策时可与普通 ask ghost 区分。
        const ghostReason: GhostContextReason =
            ask.reason === AskReason.BlackboardStalemate
                ? GhostContextReason.BlackboardCap
                : GhostContextReason.Ask;
        const ghostId = `ghost-${crypto.randomUUID()}`;
        const content: GhostContextEventContent = {
            ghostId,
            snapshotId,
            reason: ghostReason,
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
                id: ghostId,
                ts: nowMs,
                userId: message.user.id,
                channelId: message.route.channel,
                type: MemoryEventType.GhostContext,
                content: content as unknown as Record<string, unknown>,
                parentId: askId,
                importance: 0.7,
            });
            this.events.publish(
                event(RuntimeEventType.MemoryGhostRecorded, {
                    ghostEventId: ghostId,
                    askEventId: askId,
                    userId: message.user.id,
                    reason: ghostReason,
                    askReason: ask.reason,
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "ghost.record",
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
            userId: message.user.id,
        });
        this.events.publish(
            event(RuntimeEventType.MemoryBrainPromptRecall, {
                userId: message.user.id,
                sinceTs,
                hits: visible.length,
            }),
        );
        if (visible.length === 0) return [];
        const queryEmbedding =
            context?.embedding && context.embedding.length > 0 ? context.embedding : await this.embeddings.embed(message.text);
        // P0 prompt recall：brain_events 是权威源；召回时仍按资源指标做轻量排序。
        // 零字符匹配——只看结构化 score + embedding。
        const activeInboxProjectId = this.peekActiveInboxProjectId(message.user.id, context);
        const boost = this.config.memory.tuning.inbox.codenameRecallBoost;
        const results = visible
            .map((entry) => ({
                entry,
                rank: rankVisibleAtom(entry, queryEmbedding, activeInboxProjectId, boost),
            }))
            .sort((a, b) => b.rank - a.rank)
            .slice(0, this.config.memory.retrieval.maxResults)
            .map(({ entry }) => visibleAtomToMemoryResult(entry, MemoryLayer.Brain));
        return results;
    }

    /**
     * P2：算"用户当前活跃的 codename" → 对应的 inbox 命名空间 projectId。
     * 不可用（brain 未开/无 touch 命中）返回 null，rank 函数会跳过 boost。
     */
    private peekActiveInboxProjectId(userId: string, context?: RuntimeContext): string | null {
        if (!this.brainOpened) return null;
        const nowMs = context?.now ? Date.parse(context.now) : Date.now();
        const windowMs = Math.max(0, this.config.memory.tuning.inbox.activeCodenameWindowMinutes) * 60_000;
        const sinceTs = (Number.isFinite(nowMs) ? nowMs : Date.now()) - windowMs;
        const cn = this.brain.getMostRecentTouchedCodename(userId, sinceTs);
        return cn ? inboxProjectIdFor(cn.id) : null;
    }

    private visibleAtomsForEpisodes(
        userId: string,
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
                userId,
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
                userId: message.user.id,
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
     * 项目候选 cluster 扫描：从工作记忆 context ring 拿近期 episode，按 concept 聚合，
     * 用 `detectClusterCandidate` 判定；命中即写入 pending_project_offer（每 userId 最多一条；
     * 已有 offer 时不重复触发，避免噪声）。
     *
     * 返回是否新增了一条 offer（用于测试与诊断）。
     */
    public async sweepProjectClusters(userId: string, options: { ttlTurns?: number } = {}): Promise<boolean> {
        if (!this.workingMemory) return false;
        const existing = await this.sqlite.getProjectOffer(userId);
        if (existing) return false;

        const ringLimit = Math.max(8, this.config.memory.retrieval.maxResults * 4);
        const episodeIds = await this.workingMemory.readContextRing(userId, ringLimit);
        if (episodeIds.length === 0) return false;
        const episodes = (await Promise.all(episodeIds.map((id) => this.workingMemory!.readEpisode(userId, id)))).filter(
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

        const { detectClusterCandidate } = await import("../project/index.ts");
        const trigger = detectClusterCandidate({ concepts: [topConcept], episodes: clusterEpisodes });
        if (trigger.kind === ProjectTriggerKind.None) return false;

        const proposedAt = new Date().toISOString();
        const projectId = `project-${userId}-${Date.now().toString(36)}`;
        const title = `Recurring topic: ${topConcept}`;
        const goal = `Cluster around concept "${topConcept}" with ${clusterEpisodes.length} related episodes.`;
        const offer: PendingProjectOffer = {
            userId,
            projectId,
            title,
            goal,
            triggerKind: trigger.kind,
            evidenceScore: trigger.score,
            relatedIds: trigger.relatedIds.slice(0, 16),
            proposedAt,
            ttlTurns: Math.max(1, options.ttlTurns ?? 3),
        };
        await this.sqlite.upsertProjectOffer(offer);
        this.events.publish(
            event(RuntimeEventType.MemoryProjectOfferProposed, {
                userId,
                projectId,
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
    public async noteProjectOfferTurn(userId: string, explicitTriggered: boolean): Promise<void> {
        const offer = await this.sqlite.getProjectOffer(userId);
        if (!offer) return;
        if (explicitTriggered) {
            await this.sqlite.deleteProjectOffer(userId);
            this.events.publish(
                event(RuntimeEventType.MemoryProjectOfferConsumed, {
                    userId,
                    projectId: offer.projectId,
                    triggerKind: offer.triggerKind,
                }),
            );
            return;
        }
        const remaining = await this.sqlite.decrementProjectOfferTtl(userId);
        if (remaining === 0) {
            this.events.publish(
                event(RuntimeEventType.MemoryProjectOfferExpired, {
                    userId,
                    projectId: offer.projectId,
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
     * 同 sweepProjectClusters 一样：每 userId 最多一条 offer；已存在 offer 时直接跳过。
     */
    public async sweepSkillCandidates(userId: string): Promise<boolean> {
        if (!this.workingMemory) return false;
        const existing = await this.sqlite.getSkillOffer(userId);
        if (existing) return false;

        const ringLimit = Math.max(8, this.config.memory.retrieval.maxResults * 4);
        const episodeIds = await this.workingMemory.readContextRing(userId, ringLimit);
        if (episodeIds.length === 0) return false;
        const episodes = (await Promise.all(episodeIds.map((id) => this.workingMemory!.readEpisode(userId, id)))).filter(
            (e): e is NonNullable<typeof e> => Boolean(e),
        );
        if (episodes.length === 0) return false;

        const { detectSkillCandidate } = await import("../project/index.ts");
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

        const trigger = detectSkillCandidate(top, { skillSupportMin: supportMin });
        if (trigger.kind === ProjectTriggerKind.None) return false;

        const proposedAt = new Date().toISOString();
        const skillId = `skill-${userId}-${Date.now().toString(36)}`;
        const name = synthesizeSkillName(top.tools);
        const description = `Recurring workflow combining ${top.tools.length} MCP tool(s): ${top.tools.join(", ")}.`;
        const summary = buildSkillSummary(top.episodes, top.tools);
        const offer: PendingSkillOffer = {
            userId,
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
                userId,
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
    public async consumeSkillOffer(userId: string): Promise<boolean> {
        const offer = await this.sqlite.getSkillOffer(userId);
        if (!offer) return false;
        try {
            const skillDir = await materializeSkillFromOffer(this.config.paths.skillDir, offer);
            await this.sqlite.deleteSkillOffer(userId);
            this.events.publish(
                event(RuntimeEventType.MemorySkillInstalled, {
                    userId,
                    skillId: offer.skillId,
                    name: offer.name,
                    path: skillDir,
                    tools: offer.mcpTools.length,
                }),
            );
            this.events.publish(
                event(RuntimeEventType.MemorySkillOfferConsumed, {
                    userId,
                    skillId: offer.skillId,
                    name: offer.name,
                }),
            );
            const retrospective = new RetrospectiveLog({ projectMemoryDir: this.config.paths.projectMemoryDir });
            await retrospective.append({
                kind: "skill-promoted",
                userId,
                summary: offer.description,
                symbols: offer.mcpTools,
                rationale: `User confirmed promotion of recurring MCP workflow (support=${offer.support}, confidence=${offer.confidence.toFixed(2)}).`,
                extra: { skillId: offer.skillId, name: offer.name, path: skillDir },
            });
            return true;
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemorySkillInstallFailed, {
                    userId,
                    skillId: offer.skillId,
                    name: offer.name,
                    error: String(err),
                }),
            );
            throw err;
        }
    }

    /** 用户未显式同意 → ttl-1；归零即过期。 */
    public async noteSkillOfferTurn(userId: string, explicitTriggered: boolean): Promise<void> {
        const offer = await this.sqlite.getSkillOffer(userId);
        if (!offer) return;
        if (explicitTriggered) {
            // consumeSkillOffer 已处理；这里幂等保护
            return;
        }
        const remaining = await this.sqlite.decrementSkillOfferTtl(userId);
        if (remaining === 0) {
            this.events.publish(
                event(RuntimeEventType.MemorySkillOfferExpired, {
                    userId,
                    skillId: offer.skillId,
                    confidence: offer.confidence,
                }),
            );
        }
    }
}

function renderProjectOfferNudge(offer: PendingProjectOffer): string {
    return renderProjectOfferPrompt({
        evidenceScore: offer.evidenceScore.toFixed(2),
        relatedCount: String(offer.relatedIds.length),
        remainingTurns: String(offer.ttlTurns),
        title: offer.title,
    });
}

function renderSkillOfferNudge(offer: PendingSkillOffer): string {
    return renderSkillOfferPrompt({
        confidence: offer.confidence.toFixed(2),
        name: offer.name,
        remainingTurns: String(offer.ttlTurns),
        support: String(offer.support),
        tools: offer.mcpTools.join(", "),
    });
}

function renderEqDirectiveLine(directive: string | null): string {
    return directive ? `- directive=${directive}` : "";
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
    const { mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
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
    projectConstraintId: string,
    inboxDecayMultiplier: number,
    codenameBoost: number,
    codenameUseCount: number,
): string | undefined {
    const parts: string[] = [];
    if (isInboxProjectId(projectConstraintId)) {
        const cn = extractCodenameIdFromInboxProjectId(projectConstraintId);
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
    projectId: string,
    sourceId: string,
    defaults: MemoryWeights,
    matrixAggregator: MemoryMatrixAggregator,
): MemoryCandidate {
    const baseWeights = weightsFromAction(defaults, action);
    const matrix = matrixAggregator.aggregate({ action, message, reply, weights: baseWeights });
    const weights = applyMatrixImpact(baseWeights, matrix);
    return {
        id: crypto.randomUUID(),
        targetFile: targetFileForMemoryAction(action),
        kind: kindForMemoryAction(action),
        status: MemoryCandidateStatus.Candidate,
        sourceKind: MemorySourceKind.ExplicitUserIntent,
        content: action.content.replace(/\s+/g, " ").trim(),
        projectId,
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
    projectMemory: string,
    hippocampus: string | undefined,
    results: MemorySearchResult[],
    maxChars: number,
): string {
    const content = renderMemoryContextPrompt({
        markdown,
        hippocampus: hippocampus ?? "",
        projectMemory,
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

const INBOX_PROJECT_CONSTRAINT_ID = "inbox";
const INBOX_CODENAME_PROJECT_PREFIX = "inbox:cn-";

/**
 * P2 inbox 收口：把 inbox 单一虚拟桶扩成"按 codename 命名空间化"的子桶集合。
 * - 无 codename → "inbox"（保持后向兼容）
 * - 有 codename → "inbox:cn-<codenameId>"
 *
 * 命名空间内仍走 inbox 7-day 加速衰减；项目升格后改用真实 project-<hex> 路径。
 */
export function inboxProjectIdFor(codenameId?: string | null): string {
    if (!codenameId) return INBOX_PROJECT_CONSTRAINT_ID;
    return `${INBOX_CODENAME_PROJECT_PREFIX}${codenameId}`;
}

/**
 * 谓词：projectId 是否属于 inbox 容器（含 codename 子桶）。
 * 决定 atom 是否走 inbox decay multiplier；零字符匹配——只看 projectId 字面量前缀。
 */
export function isInboxProjectId(id: string): boolean {
    return id === INBOX_PROJECT_CONSTRAINT_ID || id.startsWith(INBOX_CODENAME_PROJECT_PREFIX);
}

/**
 * 从命名空间化的 inbox projectId 中抽取 codenameId；非 codename 桶返回 null。
 * 单一来源 — 任何需要反解的 caller 都用这个，不要本地再 slice 前缀。
 */
export function extractCodenameIdFromInboxProjectId(id: string): string | null {
    if (!id.startsWith(INBOX_CODENAME_PROJECT_PREFIX)) return null;
    const tail = id.slice(INBOX_CODENAME_PROJECT_PREFIX.length);
    return tail.length > 0 ? tail : null;
}

interface BrainAtomFromActionInput {
    action: MemoryAction;
    createdAt: string;
    defaultWeights: MemoryWeights;
    embedding: number[];
    episodeId: string;
    index: number;
    matrix: MemoryMatrixAggregator;
    message: GatewayMessage;
    projectConstraintId: string;
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
    const weights = applyMatrixImpact(baseWeights, matrix);
    const inboxDecayMultiplier = Math.max(1, input.inboxDecayMultiplier);
    const recency =
        isInboxProjectId(input.projectConstraintId) ? clamp01(1 / inboxDecayMultiplier) : 1;
    const codenameUseCount = Math.max(0, Math.floor(input.codenameUseCount ?? 0));
    const codenameBoost =
        codenameUseCount > 0 ? clamp01(Math.log2(1 + codenameUseCount) / 4) : 0;
    const score: AtomScore = {
        atomId: `${input.episodeId}:atom:${input.index}`,
        access: clamp01(weights.recurrence),
        fanout: clamp01(weights.sourceDiversity),
        inboxDecayApplied: isInboxProjectId(input.projectConstraintId),
        recency,
        successPrior: clamp01(weights.confidence * 0.5 + weights.durability * 0.3 + weights.validationCount * 0.2),
        total: 0,
        explain: buildScoreExplain(input.projectConstraintId, inboxDecayMultiplier, codenameBoost, codenameUseCount),
    };
    score.total = clamp01(
        score.recency * input.scoreWeights.recency +
            score.access * input.scoreWeights.access +
            score.successPrior * input.scoreWeights.successPrior +
            score.fanout * input.scoreWeights.fanout +
            codenameBoost,
    );
    const atom: MemoryAtom = {
        id: score.atomId,
        episodeIds: [input.episodeId],
        userId: input.message.user.id,
        channelId: input.message.route.channel,
        projectId: input.projectConstraintId,
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
            scope: entry.atom.projectId,
            subjectId: entry.atom.userId,
            channel: entry.atom.channelId,
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
    activeInboxProjectId?: string | null,
    codenameBoost?: number,
): number {
    const similarity =
        queryEmbedding.length > 0 && entry.atom.embedding.length === queryEmbedding.length
            ? Math.max(0, cosine(queryEmbedding, entry.atom.embedding))
            : 0;
    const inboxBoost =
        activeInboxProjectId && entry.atom.projectId === activeInboxProjectId
            ? Math.max(0, codenameBoost ?? 0)
            : 0;
    return entry.score.total * 0.75 + similarity * 0.25 + inboxBoost;
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

function deriveProjectConstraintId(message: GatewayMessage, triggerKind: ProjectTriggerKind, codenameId?: string): string {
    if (triggerKind !== ProjectTriggerKind.None) return deriveProjectId(message);
    return inboxProjectIdFor(codenameId);
}

function focusKeyForMessage(message: GatewayMessage): string {
    return `${message.user.id}:${message.route.channel}`;
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

/**
 * Project id 派生：来自 (channel, chatId, user) 的稳定 hash，便于多次显式触发命中同一目录（幂等）。
 * 不依赖 GUID，避免每轮重新 scaffold 一个新目录。
 */
function deriveProjectId(message: GatewayMessage): string {
    const seed = `${message.route.channel}:${message.route.chatId}:${message.user.id}`;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(seed);
    return hasher.digest("hex").slice(0, 12);
}

function deriveProjectTitle(message: GatewayMessage): string {
    const text = message.text.trim().split("\n")[0] ?? "Untitled project";
    return text.slice(0, 80);
}

function firstLine(value: string): string {
    // UI 标题只承载一行可扫读摘要；完整 ask.prompt 仍保存在 askPrompt 字段。
    return value.trim().split(/\r?\n/u)[0]?.trim() ?? "";
}
