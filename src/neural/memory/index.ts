import type { FlyflorConfig } from "../../config/index.ts";
import type { CrystalCandidateInput } from "../../crystal/reflection/index.ts";
import {
    ArchitectureLayer,
    ComponentKind,
    MarkdownMemoryFile,
    MemoryCandidateStatus,
    MemorySourceKind,
} from "../../protocol/contracts/index.ts";
import type { GatewayMessage, GatewayReply, ModelClient, RuntimeContext } from "../../protocol/contracts/index.ts";
import { Memory } from "../../agent/components.ts";
import { Module, Provide } from "../../agent/di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { SessionModule, scopeFor } from "../../agent/session/index.ts";
import { loadPromptTemplates, renderMemoryContextPrompt } from "../../agent/prompts/index.ts";
import { FeedbackCategory, classifyFeedback } from "../../agent/runtime/feedback.interpreter.ts";
import { detectExplicitIntent, ProjectTriggerKind } from "../../agent/project/index.ts";
import { ProjectScaffolder } from "../../agent/project/scaffolder.ts";
import { spreadActivation, type ActivationCandidate } from "./activation.ts";
import { kindForMemoryAction, targetFileForMemoryAction } from "./actions.ts";
import { LocalHashEmbeddingProvider } from "./embedding.ts";
import { MarkdownMemoryStore } from "./markdown.ts";
import { ProjectMemoryStore } from "./project.memory.ts";
import { applyMatrixImpact, MemoryMatrixAggregator } from "./matrix.ts";
import { CrystalMemoryService } from "../../crystal/memory/index.ts";
import { SQLiteMemoryStore } from "./sqlite.ts";
import { RedisMemoryStore } from "./redis.ts";
import { SurrealGraphStore } from "./surreal.graph.ts";
import { ConsolidationWorker } from "./consolidation.worker.ts";
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
import type { HistoryEntry, SessionMessageRecord } from "../../agent/session/index.ts";

export { parseMemoryActions, targetFileForMemoryAction } from "./actions.ts";
export { MarkdownMemoryStore } from "./markdown.ts";
export { ProjectMemoryStore } from "./project.memory.ts";
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
    private readonly markdown: MarkdownMemoryStore;
    private readonly projectMemory: ProjectMemoryStore;
    private readonly matrix: MemoryMatrixAggregator;
    private readonly sqlite: SQLiteMemoryStore;
    private readonly crystal: CrystalMemoryService;
    private readonly session: SessionModule;
    private readonly redis: RedisMemoryStore | null;
    private readonly surreal: SurrealGraphStore | null;
    private readonly scheduler: BackgroundScheduler | null;
    private readonly model: ModelClient | undefined;
    private readonly projectScaffolder: ProjectScaffolder;
    /** 单例 embedding provider；用于 context.embedding 缺省时降级计算。 */
    private readonly embeddings: LocalHashEmbeddingProvider;

    constructor(
        private readonly config: FlyflorConfig,
        private readonly events: EventSink,
        model?: ModelClient,
    ) {
        super();
        this.model = model;
        this.embeddings = new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
        this.markdown = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        this.projectMemory = new ProjectMemoryStore(config.paths, this.events);
        this.matrix = new MemoryMatrixAggregator(config.memory.matrix);
        this.sqlite = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        this.crystal = new CrystalMemoryService(config.memory.crystal);
        this.session = new SessionModule(this.sqlite, config.memory.session);
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
                      new ConsolidationWorker(this.redis, this.surreal, model, this.events),
                      this.surreal,
                      this.events,
                      { dream: new DreamWorkerImpl(this.surreal, model, this.events) },
                  )
                : null;
    }

    /**
     * 预热：连接 Redis 并测 PING 往返延迟。
     * 失败时降级（redis = null 已经 guard），不抛出。
     */
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
                    impact:
                        "consolidation/decay/dream 全部跳过；记忆只走当轮 markdown+sqlite 短期路径，不会自动整合到长期晶体层",
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

        const request: MemorySearchRequest = {
            query: message.text,
            scope: scopeFor(message),
            subjectId: message.user.id,
            channel: message.route.channel,
            chatId: message.route.chatId,
            limit: this.config.memory.retrieval.maxResults,
        };

        const sessionKey = scopeFor(message);
        const [sessionMessages, hippocampus, projectMemory, crystalResults, sqliteResults, markdown] =
            await Promise.all([
                this.session.recentMessagesFor(message),
                this.assembleHippocampusContext(message, context),
                this.projectMemory.snapshot({
                    maxChars: this.config.memory.retrieval.maxPromptChars,
                    query: message.text,
                    requestId: context?.requestId,
                    scope: request.scope,
                }),
                this.crystal.recall(request),
                this.sqlite.search(request),
                this.markdown.snapshot(),
            ]);
        const results = dedupeResults([...projectMemory.results, ...crystalResults, ...sqliteResults]);
        const memoryBody = renderMemoryPrompt(
            markdown.prompt,
            projectMemory.prompt,
            hippocampus,
            results,
            sessionMessages,
            this.config.memory.retrieval.maxPromptChars,
        );

        this.events.publish(
            event(RuntimeEventType.MemoryPromptBuilt, {
                recallResults: results.length,
                sessionKey,
                sessionMessages: sessionMessages.length,
                hippocampusActivated: hippocampus ? true : false,
                projectMemoryActivated: projectMemory.prompt ? true : false,
                projectMemoryManifestPath: projectMemory.manifest.paths.manifest,
                projectMemoryRecallReceiptId: projectMemory.receipt?.id,
                projectMemoryRecallResults: projectMemory.results.length,
            }),
        );

        return memoryBody;
    }

    /**
     * Hippocampus 上下文装配（Redis ring + spreading activation）。
     * 仅在 Redis 启用且 ring 非空时有效；失败/空都返回 undefined（main path 自动降级）。
     * 性能：限制 candidate ≤ ringSize，激活计算 O(N·D) 在 1ms 量级。
     */
    private async assembleHippocampusContext(
        message: GatewayMessage,
        context?: RuntimeContext,
    ): Promise<string | undefined> {
        if (!this.redis) return undefined;
        try {
            const userId = message.user.id;
            const ringSize = this.config.memory.retrieval.maxResults;
            const [episodeIds, hotConcepts] = await Promise.all([
                this.redis.readContextRing(userId, ringSize),
                this.redis.hotConcepts(userId, 16),
            ]);
            if (episodeIds.length === 0) return undefined;
            const records = await Promise.all(episodeIds.map((id) => this.redis!.readEpisode(userId, id)));
            const candidates: ActivationCandidate[] = [];
            for (const rec of records) {
                if (!rec) continue;
                candidates.push({
                    id: rec.episodeId,
                    embedding: rec.embedding,
                    concepts: rec.concepts,
                    importance: rec.importance,
                    createdAt: rec.createdAt,
                });
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
                    const rec = records.find((r) => r?.episodeId === a.id);
                    if (!rec) return "";
                    const text = rec.text.replace(/\s+/g, " ").trim().slice(0, 240);
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
        } catch {
            return undefined;
        }
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
                sessionKey: scopeFor(message),
                candidates: [],
                promoted: [],
                historyEntries: [],
            };
        }

        // async-pipeline: redis episode 在拿到 session 之前就可以启动（不需要 session.key）。
        // 用 actions 直接估 importance，避免等 candidates 构造完成。
        void this.writeEpisodeToRedis(message, reply, context, importanceFromActions(actions), provenance);
        // 把当前用户登记进后台调度器，确保 ConsolidationWorker / decay sweep 会按节拍 drain。
        // 不做 Redis SCAN（会爆炸），只信任活跃 turn 触发。
        this.scheduler?.noteUserTurn(message.user.id);

        // 项目脚手架触发（仅显式意图通道，幂等；cluster 通道由后台 sweep 触发，本路径不参与）。
        const projectTrigger = detectExplicitIntent(actions);
        if (projectTrigger.kind !== ProjectTriggerKind.None) {
            void this.projectScaffolder.scaffold({
                projectId: deriveProjectId(message),
                title: deriveProjectTitle(message),
                goal: message.text.slice(0, 500),
                userId: message.user.id,
                trigger: projectTrigger,
                createdAt: new Date(context.now).toISOString(),
            });
        }

        const session = await this.session.recordTurn(message, reply, context);
        const candidates = actions
            .map((action) =>
                candidateFromAction(
                    action,
                    message,
                    reply,
                    context,
                    session.key,
                    this.config.memory.weights,
                    this.matrix,
                ),
            )
            .slice(0, this.config.memory.candidates.maxCandidatesPerTurn);

        // 三路并行：candidate 写入 / session consolidate→markdown history / Redis 已经 fire-and-forget。
        const projectMemoryPipeline =
            projectTrigger.kind !== ProjectTriggerKind.None
                ? this.projectMemory.recordTurn({
                      message,
                      reply,
                      context,
                      trigger: projectTrigger,
                      candidates,
                      projectId: deriveProjectId(message),
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
        const historyPipeline = (async () => {
            const entries = await this.session.consolidate(session.key, context.now);
            await Promise.all(entries.map((entry) => this.markdown.appendHistory(entry)));
            return entries;
        })();

        const [candidateResults, historyEntries, projectRecords] = await Promise.all([
            candidatePipeline,
            historyPipeline,
            projectMemoryPipeline,
        ]);
        const promoted: MemoryRecord[] = candidateResults.filter((r): r is MemoryRecord => r !== undefined);
        const promotedRecords = [...promoted, ...projectRecords];

        // 晶体记忆（fire-and-forget，不阻塞回答返回）
        void this.crystal
            .recordTurn({
                requestId: context.requestId,
                now: context.now,
                candidates,
                promoted: promotedRecords,
                historyEntries,
                reflectionCandidates: [],
            })
            .catch(() => {});

        this.events.publish(
            event(
                RuntimeEventType.MemoryTurnRecorded,
                {
                    candidates: candidates.length,
                    historyEntries: historyEntries.length,
                    projectPromoted: projectRecords.length,
                    promoted: promotedRecords.length,
                    sessionKey: session.key,
                },
                context.requestId,
            ),
        );

        return {
            sessionKey: session.key,
            candidates,
            promoted: promotedRecords,
            historyEntries,
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
     *   1. 拉上一回合 assistant 文本（用 session.recentMessagesFor）；
     *   2. 喂给 LLM 结构化分类（feedback.interpreter）；
     *   3. 按 enum 分发给 applyFeedback。
     * 没有 model 或没有上一轮 assistant 文本时直接返回。
     */
    async classifyAndApplyFeedback(message: GatewayMessage, context: RuntimeContext): Promise<void> {
        if (!this.model || !this.config.memory.enabled) return;
        try {
            // 取最近若干条 session 消息，找最后一条 assistant；若没有则视为首轮，无反馈可分类。
            const recent = await this.session.recentMessagesFor(message, 4);
            const previousAssistant = [...recent].reverse().find((m) => m.role === "assistant");
            if (!previousAssistant) return;
            const classification = await classifyFeedback(this.model, {
                previousAssistantText: previousAssistant.content,
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
                previousAssistantText: previousAssistant.content,
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
                sourceKind: hasMcpSuccess ? MemorySourceKind.McpAugmented : MemorySourceKind.SessionTurn,
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
                        sourceKind: hasMcpSuccess ? MemorySourceKind.McpAugmented : MemorySourceKind.SessionTurn,
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
    sessionKey: string,
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
        sessionKey,
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
    sessionMessages: SessionMessageRecord[],
    maxChars: number,
): string {
    const content = renderMemoryContextPrompt({
        markdown,
        hippocampus: hippocampus ?? "",
        projectMemory,
        renderedResults: results.length > 0 ? renderResults(results) : "",
        renderedSessionMessages: sessionMessages.length > 0 ? renderSessionMessages(sessionMessages) : "",
    });
    return content.length <= maxChars ? content : content.slice(0, maxChars).trimEnd();
}

function renderSessionMessages(messages: SessionMessageRecord[]): string {
    return messages
        .map((message) => {
            const timestamp = message.createdAt;
            return `- [session:${message.sequence} ${message.role} ${timestamp}] ${message.content.replace(/\s+/g, " ").trim()}`;
        })
        .join("\n");
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
