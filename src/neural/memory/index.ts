import type { FlyflorConfig } from "../../config/index.ts";
import type { CrystalCandidateInput } from "../../crystal/reflection/index.ts";
import {
    ArchitectureLayer,
    ComponentKind,
    MemoryCandidateStatus,
    MemorySourceKind,
} from "../../protocol/contracts/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../protocol/contracts/index.ts";
import { Memory } from "../../agent/components.ts";
import { Module, Provide } from "../../agent/di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { SessionModule, scopeFor } from "../../agent/session/index.ts";
import { loadPromptTemplates, renderMemoryContextPrompt } from "../../agent/prompts/index.ts";
import { kindForMemoryAction, targetFileForMemoryAction } from "./actions.ts";
import { LocalHashEmbeddingProvider } from "./embedding.ts";
import { MarkdownMemoryStore } from "./markdown.ts";
import { applyMatrixImpact, MemoryMatrixAggregator } from "./matrix.ts";
import { CrystalMemoryService } from "../../crystal/memory/index.ts";
import { SQLiteMemoryStore } from "./sqlite.ts";
import { RedisMemoryStore } from "./redis.ts";
import type {
    MemoryAction,
    MemoryCandidate,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryWeights,
    TurnMemoryResult,
} from "./types.ts";
import type { HistoryEntry, SessionMessageRecord } from "../../agent/session/index.ts";

export { parseMemoryActions, targetFileForMemoryAction } from "./actions.ts";
export { MarkdownMemoryStore } from "./markdown.ts";
export { SQLiteMemoryStore } from "./sqlite.ts";
export type {
    MemoryAction,
    MemoryCandidate,
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
    private readonly matrix: MemoryMatrixAggregator;
    private readonly sqlite: SQLiteMemoryStore;
    private readonly crystal: CrystalMemoryService;
    private readonly session: SessionModule;
    private readonly redis: RedisMemoryStore | null;
    /** 单例 embedding provider；用于 context.embedding 缺省时降级计算。 */
    private readonly embeddings: LocalHashEmbeddingProvider;

    constructor(
        private readonly config: FlyflorConfig,
        private readonly events: EventSink,
    ) {
        super();
        this.embeddings = new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
        this.markdown = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        this.matrix = new MemoryMatrixAggregator(config.memory.matrix);
        this.sqlite = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        this.crystal = new CrystalMemoryService(config.memory.crystal);
        this.session = new SessionModule(this.sqlite, config.memory.session);
        this.redis = config.memory.redis.enabled
            ? new RedisMemoryStore(config.memory.redis)
            : null;
    }

    /**
     * 预热：连接 Redis 并测 PING 往返延迟。
     * 失败时降级（redis = null 已经 guard），不抛出。
     */
    async warmup(): Promise<void> {
        if (!this.redis) return;
        try {
            const latencyMs = await this.redis.ping();
            this.events.publish(event(RuntimeEventType.MemoryWarmupComplete, { latencyMs }));
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.MemoryWarmupComplete, { latencyMs: -1, error: String(err) }),
            );
        }
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
        const markdown = await this.markdown.snapshot();
        const [sessionMessages, sqliteResults, crystalResults] = await Promise.all([
            this.session.recentMessagesFor(message),
            this.sqlite.search(request),
            this.crystal.recall(request),
        ]);
        const results = dedupeResults([...crystalResults, ...sqliteResults]);
        const prompt = renderMemoryPrompt(
            markdown.prompt,
            results,
            sessionMessages,
            this.config.memory.retrieval.maxPromptChars,
        );

        this.events.publish(
            event(RuntimeEventType.MemoryPromptBuilt, {
                recallResults: results.length,
                sessionKey,
                sessionMessages: sessionMessages.length,
            }),
        );

        return prompt;
    }

    async rememberTurn(
        message: GatewayMessage,
        reply: GatewayReply,
        context: RuntimeContext,
        actions: MemoryAction[] = [],
    ): Promise<TurnMemoryResult> {
        if (!this.config.memory.enabled) {
            return {
                sessionKey: scopeFor(message),
                candidates: [],
                promoted: [],
                historyEntries: [],
            };
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
        const promoted: MemoryRecord[] = [];

        for (const candidate of candidates) {
            await this.sqlite.addCandidate(candidate);
            if (this.config.memory.candidates.autoPromoteExplicit) {
                const promotedAt = context.now;
                const record = await this.markdown.promoteCandidate(candidate, promotedAt);
                await this.sqlite.markCandidatePromoted(candidate.id, promotedAt);
                await this.sqlite.addSearchRecord(record);
                promoted.push(record);
            }
        }

        const historyEntries = await this.session.consolidate(session.key, context.now);
        await Promise.all(historyEntries.map((entry) => this.markdown.appendHistory(entry)));

        // Redis episode 写入（工作记忆，最高 importance 取自 candidates 均值或默认）
        void this.writeEpisodeToRedis(message, reply, context, candidates);

        // 晶体记忆（fire-and-forget，不阻塞回答返回）
        void this.crystal
            .recordTurn({
                requestId: context.requestId,
                now: context.now,
                candidates,
                promoted,
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
                    promoted: promoted.length,
                    sessionKey: session.key,
                },
                context.requestId,
            ),
        );

        return {
            sessionKey: session.key,
            candidates,
            promoted,
            historyEntries,
        };
    }

    /**
     * 异步反思入口：由 RuntimeModule 在回答已返回后 fire-and-forget 调用。
     * 不阻塞主链路；失败发布 MemoryReflectionFailed 事件后静默。
     */
    async applyReflection(
        candidates: CrystalCandidateInput[],
        context: RuntimeContext,
    ): Promise<void> {
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
        candidates: MemoryCandidate[],
    ): Promise<void> {
        if (!this.redis) return;
        try {
            const importance =
                candidates.length > 0
                    ? candidates.reduce((sum, c) => sum + (c.weights?.importance ?? 0), 0) / candidates.length
                    : 0.4;
            const stability = Math.min(1, importance * 1.2);
            const ttlMultiplier = this.config.memory.redis.defaultTtlSeconds;
            const ttlSeconds = Math.max(60, Math.floor(ttlMultiplier * (0.5 + importance)));

            const embedding =
                context.embedding && context.embedding.length > 0
                    ? context.embedding
                    : await this.embeddings.embed(message.text);

            const episodeId = crypto.randomUUID();
            const text = `[user] ${message.text.slice(0, 512)}\n[assistant] ${reply.text.slice(0, 512)}`;

            await this.redis.writeEpisode({
                userId: message.user.id,
                episodeId,
                text,
                concepts: [],
                embedding,
                importance,
                stability,
                sourceKind: MemorySourceKind.SessionTurn,
                createdAt: Date.now(),
                ttlSeconds,
            });

            this.events.publish(
                event(
                    RuntimeEventType.MemoryEpisodeWritten,
                    { episodeId, importance, ttlSeconds },
                    context.requestId,
                ),
            );
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

export function createMemory(config: FlyflorConfig, events: EventSink): MemoryModule {
    return new MemoryModule(config, events);
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
    results: MemorySearchResult[],
    sessionMessages: SessionMessageRecord[],
    maxChars: number,
): string {
    const content = renderMemoryContextPrompt({
        markdown,
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
