import type { FlyflorConfig } from "../../config/index.ts";
import { join } from "node:path";
import type { CrystalCandidateInput } from "../../crystal/reflection/index.ts";
import {
    ArchitectureLayer,
    AtomStage,
    ComponentKind,
    MarkdownMemoryFile,
    MemoryCandidateStatus,
    MemoryKind,
    MemoryLayer,
    MemorySourceKind,
    ModelRole,
} from "../../protocol/contracts/index.ts";
import type {
    AtomScore,
    GatewayMessage,
    GatewayReply,
    MemoryAtom,
    ModelClient,
    RuntimeContext,
} from "../../protocol/contracts/index.ts";
import { Memory } from "../../agent/components.ts";
import { Module, Provide } from "../../agent/di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { loadPromptTemplates, renderMemoryContextPrompt } from "../../agent/prompts/index.ts";
import { FeedbackCategory, classifyFeedback } from "../../agent/runtime/feedback.interpreter.ts";
import { detectExplicitIntent, detectExplicitSkillIntent, ProjectTriggerKind } from "../../agent/project/index.ts";
import { ProjectScaffolder } from "../../agent/project/scaffolder.ts";
import { spreadActivation, type ActivationCandidate } from "./activation.ts";
import { kindForMemoryAction, targetFileForMemoryAction } from "./actions.ts";
import { LocalHashEmbeddingProvider } from "./embedding.ts";
import { MarkdownMemoryStore } from "./markdown.ts";
import { ProjectMemoryStore } from "./project.memory.ts";
import { JournalStore, type JournalAtomWrite, type JournalVisibleAtom } from "./journal.store.ts";
import { applyMatrixImpact, MemoryMatrixAggregator } from "./matrix.ts";
import { CrystalMemoryService } from "../../crystal/memory/index.ts";
import { SQLiteMemoryStore } from "./sqlite.ts";
import type { PendingProjectOffer, PendingSkillOffer } from "./sqlite.ts";
import { RedisMemoryStore } from "./redis.ts";
import { SurrealGraphStore } from "./surreal.graph.ts";
import { ConsolidationWorker } from "./consolidation.worker.ts";
import { RetrospectiveLog } from "./retrospective.ts";
import { BackgroundScheduler } from "./background.scheduler.ts";
import { DreamWorkerImpl } from "../../agent/runtime/dream.worker.ts";
import type {
    MemoryAction,
    MemoryCandidate,
    MemoryEpisodeProvenance,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "./types.ts";

export { parseMemoryActions, targetFileForMemoryAction } from "./actions.ts";
export { MarkdownMemoryStore } from "./markdown.ts";
export { JournalStore, type JournalAtomWrite, type JournalEpisodeInput } from "./journal.store.ts";
export { ProjectMemoryStore } from "./project.memory.ts";
export { RetrospectiveLog, type RetrospectiveEntry } from "./retrospective.ts";
export { SQLiteMemoryStore } from "./sqlite.ts";
export type {
    MemoryAction,
    MemoryCandidate,
    MemoryEpisodeProvenance,
    MemoryMatrixResult,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "./types.ts";

@Module({ name: "memory", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Memory, layer: ArchitectureLayer.Control, name: "memory", provider: true })
export class MemoryModule extends Memory {
    private readonly journal: JournalStore;
    private readonly markdown: MarkdownMemoryStore;
    private readonly projectMemory: ProjectMemoryStore;
    private readonly matrix: MemoryMatrixAggregator;
    private readonly sqlite: SQLiteMemoryStore;
    private readonly crystal: CrystalMemoryService;
    private readonly redis: RedisMemoryStore | null;
    private readonly surreal: SurrealGraphStore | null;
    private readonly scheduler: BackgroundScheduler | null;
    private readonly model: ModelClient | undefined;
    private readonly projectScaffolder: ProjectScaffolder;
    /** 单例 embedding provider；用于 context.embedding 缺省时降级计算。 */
    private readonly embeddings: LocalHashEmbeddingProvider;
    private readonly assistantMemoryByFocus = new Map<string, { current?: string; previous?: string }>();

    constructor(
        private readonly config: FlyflorConfig,
        private readonly events: EventSink,
        model?: ModelClient,
    ) {
        super();
        this.model = model;
        this.embeddings = new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
        this.journal = new JournalStore({ journalRoot: config.paths.journalDir ?? join(config.paths.home, "journal") });
        this.markdown = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        this.projectMemory = new ProjectMemoryStore(config.paths, this.events);
        this.matrix = new MemoryMatrixAggregator(config.memory.matrix);
        this.sqlite = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        this.crystal = new CrystalMemoryService(config.memory.crystal);
        this.redis = config.memory.redis.enabled ? new RedisMemoryStore(config.memory.redis) : null;
        this.surreal = config.memory.crystal.surreal.enabled
            ? new SurrealGraphStore(config.memory.crystal.surreal)
            : null;
        this.projectScaffolder = new ProjectScaffolder(config.paths, this.events);
        // 后台调度器仅在三件依赖（Redis 短期 + Surreal 长期 + 模型）齐备时启用；
        // 任一缺失即降级为 null，rememberTurn / warmup / dispose 全部跳过即可。
        this.scheduler =
            this.redis && this.surreal && model
                ? new BackgroundScheduler(
                      new ConsolidationWorker(this.redis, this.surreal, model, this.events, {
                          retrospective: new RetrospectiveLog({ projectMemoryDir: config.paths.projectMemoryDir }),
                      }),
                      this.surreal,
                      this.events,
                      {
                          dream: new DreamWorkerImpl(this.surreal, model, this.events),
                          projectSweeper: (userId: string) => this.sweepProjectClusters(userId).catch(() => false),
                          skillSweeper: (userId: string) => this.sweepSkillCandidates(userId).catch(() => false),
                      },
                  )
                : null;
    }

    /**
     * 预热：连接 Redis 并测 PING 往返延迟。
     * 失败时降级（redis = null 已经 guard），不抛出。
     */
    /** 暴露底层 Redis 客户端，供同进程其他热路径组件（fastRoute 快照等）复用。 */
    getRedisClient() {
        return this.redis?.getClient();
    }

    async warmup(): Promise<void> {
        if (this.scheduler) {
            this.scheduler.start();
        } else {
            const missing: string[] = [];
            if (!this.redis) missing.push("redis");
            if (!this.surreal) missing.push("surreal");
            if (!this.model) missing.push("model");
            this.events.publish(
                event(RuntimeEventType.MemoryBackgroundSchedulerSkipped, {
                    missing,
                    redisEnabled: this.config.memory.redis.enabled,
                    surrealEnabled: this.config.memory.crystal.surreal.enabled,
                    modelProvider: this.config.model.provider,
                    impact: "consolidation/decay/dream 全部跳过；记忆只走当轮 markdown+sqlite 短期路径，不会自动整合到长期晶体层",
                }),
            );
        }
        if (!this.redis) return;
        try {
            const latencyMs = await this.redis.ping();
            this.events.publish(event(RuntimeEventType.MemoryWarmupComplete, { latencyMs }));
        } catch (err) {
            this.events.publish(event(RuntimeEventType.MemoryWarmupComplete, { latencyMs: -1, error: String(err) }));
        }
    }

    /** 关停：停止后台调度器，让 bun --compile 二进制可以干净退出。 */
    dispose(): void {
        this.scheduler?.stop();
    }

    /** CLI / 诊断接口：dream 后台状态。无 scheduler 时返回禁用快照。 */
    dreamSnapshot(): { dreamEnabled: boolean; dreamBusy: boolean; users: number } {
        if (!this.scheduler) {
            return { dreamEnabled: false, dreamBusy: false, users: 0 };
        }
        const s = this.scheduler.snapshot();
        return { dreamEnabled: s.dreamEnabled, dreamBusy: s.dreamBusy, users: s.users };
    }

    /** CLI 手动触发一轮 dream pass；scheduler 未启用时返回零值。 */
    async runDreamOnce(
        limit?: number,
        userId?: string,
    ): Promise<{
        users: number;
        driftRepaired: number;
        recallReinforced: number;
        contradictionsFlagged: number;
        skipped: number;
    }> {
        if (!this.scheduler)
            return { users: 0, driftRepaired: 0, recallReinforced: 0, contradictionsFlagged: 0, skipped: 0 };
        return this.scheduler.runDreamOnce(limit, userId);
    }

    async buildPrompt(message: GatewayMessage, context?: RuntimeContext): Promise<string> {
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

        const [hippocampus, projectMemory, journalResults, markdown] = await Promise.all([
            this.assembleHippocampusContext(message, context),
            this.projectMemory.snapshot({
                maxChars: this.config.memory.retrieval.maxPromptChars,
                query: message.text,
                requestId: context?.requestId,
                scope: request.scope,
            }),
            this.recallVisibleJournalMemory(message, context),
            this.markdown.snapshot(),
        ]);
        const results = dedupeResults(journalResults);
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
        const body = nudges.length > 0 ? `${nudges.join("\n\n")}\n\n${memoryBody}` : memoryBody;

        this.events.publish(
            event(RuntimeEventType.MemoryPromptBuilt, {
                recallResults: results.length,
                atomScoreThreshold: this.config.memory.tuning.atomScore.visibilityThreshold,
                hippocampusActivated: hippocampus ? true : false,
                journalAtomRecallResults: journalResults.length,
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
     * Hippocampus 上下文装配（Redis ring + spreading activation）。
     * 仅在 Redis 启用且 ring 非空时有效；异常必须向上传递，禁止静默吞掉记忆层错误。
     * 性能：限制 candidate ≤ ringSize，激活计算 O(N·D) 在 1ms 量级。
     */
    private async assembleHippocampusContext(
        message: GatewayMessage,
        context?: RuntimeContext,
    ): Promise<string | undefined> {
        if (!this.redis) return undefined;
        const userId = message.user.id;
        const ringSize = this.config.memory.retrieval.maxResults;
        const [episodeIds, hotConcepts] = await Promise.all([
            this.redis.readContextRing(userId, ringSize),
            this.redis.hotConcepts(userId, 16),
        ]);
        if (episodeIds.length === 0) return undefined;
        const records = await Promise.all(episodeIds.map((id) => this.redis!.readEpisode(userId, id)));
        const visibleByEpisode = await this.visibleAtomsForEpisodes(userId, records);
        const candidates: ActivationCandidate[] = [];
        const visibleAtoms = new Map<string, JournalVisibleAtom>();
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

    async rememberTurn(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        actions: MemoryAction[] = [],
        provenance: MemoryEpisodeProvenance = {},
    ): Promise<TurnMemoryResult> {
        if (!this.config.memory.enabled) {
            return {
                candidates: [],
                promoted: [],
            };
        }

        const projectTrigger = detectExplicitIntent(actions);
        const projectConstraintId = deriveProjectConstraintId(message, projectTrigger.kind);

        // Journal 是生命事件事实层：每轮先按天落 episode，再从同轮结构化 memory action
        // 派生 hot atom。失败不阻断回答，但必须发审计事件。
        await this.writeTurnToJournal(message, reply, context, actions, provenance, projectConstraintId);

        // async-pipeline: Redis 热记忆可以独立启动。
        // 用 actions 直接估 importance，避免等 candidates 构造完成。
        void this.writeEpisodeToRedis(message, reply, context, importanceFromActions(actions), provenance);
        // 把当前用户登记进后台调度器，确保 ConsolidationWorker / decay sweep 会按节拍 drain。
        // 不做 Redis SCAN（会爆炸），只信任活跃 turn 触发。
        this.scheduler?.noteUserTurn(message.user.id);

        // 项目脚手架触发（仅显式意图通道，幂等；cluster 通道由后台 sweep 触发，本路径不参与）。
        if (projectTrigger.kind !== ProjectTriggerKind.None) {
            void this.projectScaffolder.scaffold({
                projectId: projectConstraintId,
                title: deriveProjectTitle(message),
                goal: message.text.slice(0, 500),
                userId: message.user.id,
                trigger: projectTrigger,
                createdAt: new Date(context.now).toISOString(),
            });
        }
        // 项目候选 offer 生命周期：显式触发即消费，否则 ttl-1。
        void this.noteProjectOfferTurn(message.user.id, projectTrigger.kind !== ProjectTriggerKind.None).catch(
            () => undefined,
        );

        // 技能候选 offer 生命周期：用户在本轮回复中明确同意（skillPromotionIntent ≥ 0.7）即
        // 立即从 pending_skill_offer 生成 SKILL.md；否则 ttl-1。完全与 project offer 解耦。
        const skillTrigger = detectExplicitSkillIntent(actions);
        if (skillTrigger.kind !== ProjectTriggerKind.None) {
            void this.consumeSkillOffer(message.user.id).catch(() => undefined);
        } else {
            void this.noteSkillOfferTurn(message.user.id, false).catch(() => undefined);
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

        // 三路并行：candidate 写入 / project memory / Redis 已经 fire-and-forget。
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

        // 晶体记忆（fire-and-forget，不阻塞回答返回）
        void this.crystal
            .recordTurn({
                requestId: context.requestId,
                now: context.now,
                candidates,
                promoted: promotedRecords,
                historyEntries: [],
                reflectionCandidates: [],
            })
            .catch(() => {});

        this.events.publish(
            event(
                RuntimeEventType.MemoryTurnRecorded,
                {
                    candidates: candidates.length,
                    journal: true,
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
     * 异步反思入口：由 RuntimeModule 在回答已返回后 fire-and-forget 调用。
     * 不阻塞主链路；失败发布 MemoryReflectionFailed 事件后静默。
     */
    async applyReflection(candidates: CrystalCandidateInput[], context: RuntimeContext): Promise<void> {
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
        }
    }

    /**
     * 黑板辩论收敛后由 RuntimeModule 调用，将整轮辩论沉淀为 Redis episode；
     * sourceKind=blackboard-converged，weight 0.8（高于普通对话）。
     * best-effort，失败发布事件后静默。
     */
    async recordDebateEpisode(input: {
        userId: string;
        text: string;
        embedding?: number[];
        requestId?: string;
    }): Promise<void> {
        if (!this.redis) return;
        try {
            const importance = 0.8;
            const stability = 0.9;
            const ttlSeconds = Math.max(
                300,
                Math.floor(this.config.memory.redis.defaultTtlSeconds * (0.5 + importance)),
            );
            const embedding =
                input.embedding && input.embedding.length > 0
                    ? input.embedding
                    : await this.embeddings.embed(input.text);
            const episodeId = crypto.randomUUID();
            await this.redis.writeEpisode({
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
        }
    }

    /**
     * Apply a feedback classification produced by feedback.interpreter.
     * Routes (零字符串匹配；仅在 enum 上分发)：
     *   - LocalCorrection → 高重要度 episode（带 correction 标记）写入 Redis；
     *   - Preference      → user.md 追加 (managed block)；
     *   - GlobalStrategy  → self.md 追加 (managed block)；
     *   - Confirmation    → 仅发事件，由 reinforce 通道（ConsolidationWorker）拾取；
     *   - None            → no-op。
     * 失败只发事件，不抛出。
     */
    async applyFeedback(input: {
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
            if (input.category === FeedbackCategory.LocalCorrection && this.redis) {
                const embedding = await this.embeddings.embed(input.currentUserText);
                await this.redis.writeEpisode({
                    userId: input.userId,
                    episodeId: crypto.randomUUID(),
                    text: `correction: ${fact} (was: ${input.previousAssistantText.slice(0, 256)})`,
                    concepts: ["correction"],
                    embedding,
                    importance: 0.9,
                    stability: 0.95,
                    sourceKind: MemorySourceKind.UserFeedback,
                    createdAt: Date.now(),
                    ttlSeconds: this.config.memory.redis.defaultTtlSeconds,
                });
            } else if (input.category === FeedbackCategory.Preference) {
                await this.markdown.appendFeedback(MarkdownMemoryFile.User, fact, input.recordedAt);
            } else if (input.category === FeedbackCategory.GlobalStrategy) {
                await this.markdown.appendFeedback(MarkdownMemoryFile.Self, fact, input.recordedAt);
            } else if (input.category === FeedbackCategory.Confirmation) {
                // Confirmation：用户明确确认上一轮答案有效。
                // 1) Redis 写一条高稳定性 episode（concept=confirmation，便于召回时识别正反馈）；
                // 2) 若 Surreal 装配了，用 previousAssistantText 的 embedding 做 ANN top-1
                //    召回最相关的 gem/memory_node，调用 applyMemoryReinforce 提升 importance + 刷 lastVerifiedAt。
                if (this.redis) {
                    const embedding = await this.embeddings.embed(input.previousAssistantText);
                    await this.redis.writeEpisode({
                        userId: input.userId,
                        episodeId: crypto.randomUUID(),
                        text: `confirmation: ${fact} (about: ${input.previousAssistantText.slice(0, 256)})`,
                        concepts: ["confirmation"],
                        embedding,
                        importance: 0.85,
                        stability: 0.9,
                        sourceKind: MemorySourceKind.UserFeedback,
                        createdAt: Date.now(),
                        ttlSeconds: this.config.memory.redis.defaultTtlSeconds,
                    });
                    if (this.surreal) {
                        const top = await this.surreal
                            .recallMemoryNodes({ userId: input.userId, embedding, limit: 1 })
                            .catch(() => []);
                        const candidate = top[0];
                        const score = (candidate as { score?: number } | undefined)?.score ?? 0;
                        if (candidate && score >= 0.75) {
                            await this.surreal
                                .applyMemoryReinforce({
                                    table: "memory_node",
                                    id: candidate.id,
                                    importanceMultiplier: 1.2,
                                    nowMs: Date.now(),
                                })
                                .catch(() => false);
                        }
                    }
                }
            }
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
        }
    }

    /**
     * 反馈分类入口（fire-and-forget）。Runtime 在主回答返回后调用：
     *   1. 从当前 focus 的短期 assistant 滑窗取上一轮 assistant 文本；
     *   2. 喂给 LLM 结构化分类（feedback.interpreter）；
     *   3. 按 enum 分发给 applyFeedback。
     * 没有 model 或没有上一轮 assistant 文本时直接返回。
     */
    async classifyAndApplyFeedback(message: GatewayMessage, context: RuntimeContext): Promise<void> {
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
     * Journal 是生命事件事实层：按天写 episode，并从模型同轮结构化 memory action
     * 派生 hot atom。这里不读取用户自然语言做语义判断。
     */
    private async writeTurnToJournal(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        actions: MemoryAction[],
        provenance: MemoryEpisodeProvenance,
        projectConstraintId: string,
    ): Promise<void> {
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
            const atoms = actions.slice(0, this.config.memory.candidates.maxCandidatesPerTurn).map((action, index) =>
                journalAtomFromAction({
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
                }),
            );
            const result = await this.journal.appendEpisode(
                {
                    id: episodeId,
                    userId: message.user.id,
                    channelId: message.route.channel,
                    projectId: projectConstraintId,
                    role: ModelRole.User,
                    text: renderEpisodeText(message.text, reply.text, normalizedProvenance),
                    createdAt,
                },
                atoms,
            );
            this.events.publish(
                event(
                    RuntimeEventType.MemoryJournalWritten,
                    {
                        atomIds: result.atomIds,
                        atoms: result.atomIds.length,
                        dbPath: result.dbPath,
                        episodeId: result.episodeId,
                        projectConstraintId,
                        week: result.week,
                    },
                    context.requestId,
                ),
            );
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryReflectionFailed,
                    { stage: "journal-write", error: String(err) },
                    context.requestId,
                ),
            );
        }
    }

    private async recallVisibleJournalMemory(
        message: GatewayMessage,
        context?: RuntimeContext,
    ): Promise<MemorySearchResult[]> {
        const visible = await this.journal.listVisibleAtomsWindow(context?.now ?? message.receivedAt, {
            days: 7,
            limit: this.config.memory.retrieval.maxResults,
            minScore: this.config.memory.tuning.atomScore.visibilityThreshold,
            userId: message.user.id,
        });
        if (visible.length === 0) return [];
        const queryEmbedding =
            context?.embedding && context.embedding.length > 0 ? context.embedding : await this.embeddings.embed(message.text);
        return visible
            .map((entry) => ({
                entry,
                rank: rankVisibleAtom(entry, queryEmbedding),
            }))
            .sort((a, b) => b.rank - a.rank)
            .slice(0, this.config.memory.retrieval.maxResults)
            .map(({ entry }) => visibleAtomToMemoryResult(entry));
    }

    private async visibleAtomsForEpisodes(
        userId: string,
        records: Array<Awaited<ReturnType<RedisMemoryStore["readEpisode"]>>>,
    ): Promise<Map<string, JournalVisibleAtom[]>> {
        const dates = uniqueStrings(
            records
                .filter((record): record is NonNullable<typeof record> => record != null)
                .map((record) => new Date(record.createdAt).toISOString()),
        );
        const visible = (
            await Promise.all(
                dates.map((date) =>
                    this.journal.listVisibleAtoms(date, {
                        limit: this.config.memory.retrieval.maxResults,
                        minScore: this.config.memory.tuning.atomScore.visibilityThreshold,
                        userId,
                    }),
                ),
            )
        ).flat();
        const byEpisode = new Map<string, JournalVisibleAtom[]>();
        for (const entry of visible) {
            for (const episodeId of entry.atom.episodeIds) {
                const existing = byEpisode.get(episodeId) ?? [];
                existing.push(entry);
                byEpisode.set(episodeId, existing);
            }
        }
        return byEpisode;
    }

    /**
     * 向 Redis 写入本轮 episode（工作记忆）。
     * best-effort：失败只记录事件，不影响主链路。
     * embedding 优先复用 context.embedding；缺省时本地降级计算。
     */
    private async writeEpisodeToRedis(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        importance: number,
        provenance: MemoryEpisodeProvenance,
    ): Promise<void> {
        if (!this.redis) return;
        try {
            const stability = Math.min(1, importance * 1.2);
            const ttlMultiplier = this.config.memory.redis.defaultTtlSeconds;
            const ttlSeconds = Math.max(60, Math.floor(ttlMultiplier * (0.5 + importance)));

            const embedding =
                context.embedding && context.embedding.length > 0
                    ? context.embedding
                    : await this.embeddings.embed(message.text);

            const episodeId = crypto.randomUUID();
            const normalizedProvenance = normalizeEpisodeProvenance(provenance);
            const hasMcpSuccess = (normalizedProvenance.mcpCalls ?? []).some((call) => call.ok);
            const text = renderEpisodeText(message.text, reply.text, normalizedProvenance);

            await this.redis.writeEpisode({
                userId: message.user.id,
                episodeId,
                text,
                concepts: [],
                embedding,
                importance,
                stability,
                sourceKind: hasMcpSuccess ? MemorySourceKind.McpAugmented : MemorySourceKind.JournalTurn,
                createdAt: Date.now(),
                ttlSeconds,
                metadata: {
                    provenance: normalizedProvenance,
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
                        sourceKind: hasMcpSuccess ? MemorySourceKind.McpAugmented : MemorySourceKind.JournalTurn,
                        ttlSeconds,
                    },
                    context.requestId,
                ),
            );
            // Dream 已转 SurrealDB 长期层维护（DESIGN §12），不再有 episode 入队步骤。
        } catch (err) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryReflectionFailed,
                    { stage: "episode-write", error: String(err) },
                    context.requestId,
                ),
            );
        }
    }

    /**
     * 项目候选 cluster 扫描：从 Redis context ring 拿近期 episode，按 concept 聚合，
     * 用 `detectClusterCandidate` 判定；命中即写入 pending_project_offer（每 userId 最多一条；
     * 已有 offer 时不重复触发，避免噪声）。
     *
     * 返回是否新增了一条 offer（用于测试与诊断）。
     */
    async sweepProjectClusters(userId: string, options: { ttlTurns?: number } = {}): Promise<boolean> {
        if (!this.redis) return false;
        const existing = await this.sqlite.getProjectOffer(userId).catch(() => undefined);
        if (existing) return false;

        const ringLimit = Math.max(8, this.config.memory.retrieval.maxResults * 4);
        const episodeIds = await this.redis.readContextRing(userId, ringLimit).catch(() => [] as string[]);
        if (episodeIds.length === 0) return false;
        const episodes = (
            await Promise.all(episodeIds.map((id) => this.redis!.readEpisode(userId, id).catch(() => undefined)))
        ).filter((e): e is NonNullable<typeof e> => Boolean(e));
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

        const { detectClusterCandidate } = await import("../../agent/project/index.ts");
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
    async noteProjectOfferTurn(userId: string, explicitTriggered: boolean): Promise<void> {
        const offer = await this.sqlite.getProjectOffer(userId).catch(() => undefined);
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
     * 技能候选扫描：从 Redis context ring 拿近期 episode，按 episode.provenance.mcpCalls
     * 的工具组合（成功的 tools，按字典序去重）聚合 cluster；满足 support/confidence 阈值即
     * 写入 pending_skill_offer。
     *
     * 同 sweepProjectClusters 一样：每 userId 最多一条 offer；已存在 offer 时直接跳过。
     */
    async sweepSkillCandidates(userId: string): Promise<boolean> {
        if (!this.redis) return false;
        const existing = await this.sqlite.getSkillOffer(userId).catch(() => undefined);
        if (existing) return false;

        const ringLimit = Math.max(8, this.config.memory.retrieval.maxResults * 4);
        const episodeIds = await this.redis.readContextRing(userId, ringLimit).catch(() => [] as string[]);
        if (episodeIds.length === 0) return false;
        const episodes = (
            await Promise.all(episodeIds.map((id) => this.redis!.readEpisode(userId, id).catch(() => undefined)))
        ).filter((e): e is NonNullable<typeof e> => Boolean(e));
        if (episodes.length === 0) return false;

        const { detectSkillCandidate } = await import("../../agent/project/index.ts");
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
    async consumeSkillOffer(userId: string): Promise<boolean> {
        const offer = await this.sqlite.getSkillOffer(userId).catch(() => undefined);
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
            try {
                const retrospective = new RetrospectiveLog({ projectMemoryDir: this.config.paths.projectMemoryDir });
                await retrospective.append({
                    kind: "skill-promoted",
                    userId,
                    summary: offer.description,
                    symbols: offer.mcpTools,
                    rationale: `User confirmed promotion of recurring MCP workflow (support=${offer.support}, confidence=${offer.confidence.toFixed(2)}).`,
                    extra: { skillId: offer.skillId, name: offer.name, path: skillDir },
                });
            } catch {
                // retrospective is audit-only; never fail consume
            }
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
            return false;
        }
    }

    /** 用户未显式同意 → ttl-1；归零即过期。 */
    async noteSkillOfferTurn(userId: string, explicitTriggered: boolean): Promise<void> {
        const offer = await this.sqlite.getSkillOffer(userId).catch(() => undefined);
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
    // Hermes-style 自我 nudge：把候选项目以"自我笔记"形式注入 system prompt，
    // 由 LLM 在自然对话中向用户提议确认；用户明确同意时，模型会在 memory action
    // signals 中抬高 projectIntent，commitTurn Path A 自动触发 scaffolder。
    return [
        "[project-offer]",
        `  title: ${offer.title}`,
        `  evidence: ${offer.evidenceScore.toFixed(2)} from ${offer.relatedIds.length} related episodes`,
        `  remaining_turns: ${offer.ttlTurns}`,
        `  hint: 这是一个可能值得固化为长期项目的候选。如果对话主题确实在持续聚焦，可以主动询问用户是否希望把它升格为长期项目；用户明确同意时再固化。不要凭空创建，也不要重复询问。`,
    ].join("\n");
}

function renderSkillOfferNudge(offer: PendingSkillOffer): string {
    // 与 project-offer 同构：以自我笔记注入 system prompt。用户在自然对话中明确同意
    // 后，模型抬高 memory action 的 signals.skillPromotionIntent ≥ 0.7，commitTurn 自动
    // 调用 consumeSkillOffer 物化为 SKILL.md。
    return [
        "[skill-offer]",
        `  name: ${offer.name}`,
        `  tools: ${offer.mcpTools.join(", ")}`,
        `  support: ${offer.support} episodes, confidence ${offer.confidence.toFixed(2)}`,
        `  remaining_turns: ${offer.ttlTurns}`,
        `  hint: 这是一个反复出现的 MCP 工具组合，可能值得固化为可复用 Skill（写入 ~/.flyflor/skills/）。若用户表达过想"保存为技能/把这套流程留下来"等明确意图，再设置 signals.skillPromotionIntent ≥ 0.7。否则保持 0，不要凭空提议或重复询问。`,
    ].join("\n");
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
            server: call.server.trim(),
            tool: call.tool.trim(),
        }));
    return {
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

export function createMemory(config: FlyflorConfig, events: EventSink, model?: ModelClient): MemoryModule {
    return new MemoryModule(config, events, model);
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

interface JournalAtomFromActionInput {
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
}

function journalAtomFromAction(input: JournalAtomFromActionInput): JournalAtomWrite {
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
        input.projectConstraintId === INBOX_PROJECT_CONSTRAINT_ID ? clamp01(1 / inboxDecayMultiplier) : 1;
    const score: AtomScore = {
        atomId: `${input.episodeId}:atom:${input.index}`,
        access: clamp01(weights.recurrence),
        fanout: clamp01(weights.sourceDiversity),
        inboxDecayApplied: input.projectConstraintId === INBOX_PROJECT_CONSTRAINT_ID,
        recency,
        successPrior: clamp01(weights.confidence * 0.5 + weights.durability * 0.3 + weights.validationCount * 0.2),
        total: 0,
        explain:
            input.projectConstraintId === INBOX_PROJECT_CONSTRAINT_ID
                ? `inbox recency dampened by ${inboxDecayMultiplier}`
                : undefined,
    };
    score.total =
        score.recency * input.scoreWeights.recency +
        score.access * input.scoreWeights.access +
        score.successPrior * input.scoreWeights.successPrior +
        score.fanout * input.scoreWeights.fanout;
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

function visibleAtomToMemoryResult(entry: JournalVisibleAtom): MemorySearchResult {
    return {
        layer: MemoryLayer.Journal,
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

function rankVisibleAtom(entry: JournalVisibleAtom, queryEmbedding: number[]): number {
    const similarity =
        queryEmbedding.length > 0 && entry.atom.embedding.length === queryEmbedding.length
            ? Math.max(0, cosine(queryEmbedding, entry.atom.embedding))
            : 0;
    return entry.score.total * 0.75 + similarity * 0.25;
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

function deriveProjectConstraintId(message: GatewayMessage, triggerKind: ProjectTriggerKind): string {
    return triggerKind === ProjectTriggerKind.None ? INBOX_PROJECT_CONSTRAINT_ID : deriveProjectId(message);
}

function focusKeyForMessage(message: GatewayMessage): string {
    return `${message.user.id}:${message.route.channel}`;
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
