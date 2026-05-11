import { ModelRole, type ModelClient } from "../../protocol/contracts/index.ts";
import type { EpisodeRecord, RedisMemoryStore } from "./redis.ts";
import type { SurrealGraphStore } from "./surreal.graph.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { renderMemoryConsolidationPrompt } from "../../agent/prompts/index.ts";

/**
 * 整合 Worker (consolidation worker)。
 *
 * 角色（与 DESIGN.md §7 晶体智力候选与升格对齐）：
 * 1. 周期扫描 Redis ff:cq:{userId}（已到 review 时间的 episode 候选）；
 * 2. 让 LLM 输出结构化决策：reinforce / consolidate / discard；
 * 3. consolidate → upsert SurrealDB episode + memory_node + 边；
 * 4. discard → 直接 dropEpisode；
 * 5. reinforce → 不写 SurrealDB，重置 Redis TTL（让其在工作记忆里存活更久）。
 *
 * 设计约束：
 *  - **零字符串匹配**：决策完全由 LLM 结构化 JSON 决定，代码只校验 schema；
 *  - 单次 drain 调用处理 ≤ batch 条，由调用方决定何时触发（cron / lazy / dream）；
 *  - 失败只记录事件，不抛错（保持后台幂等）；
 *  - 不做 native binding，编译进 bun 二进制无障碍。
 */

export const ConsolidationDecisionKind = {
    Reinforce: "reinforce",
    Consolidate: "consolidate",
    Discard: "discard",
} as const;
export type ConsolidationDecisionKind =
    (typeof ConsolidationDecisionKind)[keyof typeof ConsolidationDecisionKind];

export interface ConsolidationDecision {
    decision: ConsolidationDecisionKind;
    confidence: number;
    summary?: string;
    symbols?: string[];
    rationale?: string;
}

export interface ConsolidationRunResult {
    scanned: number;
    reinforced: number;
    consolidated: number;
    discarded: number;
    skipped: number;
}

export interface ConsolidationWorkerOptions {
    /** 每轮 drain 的最大候选数（默认 32） */
    batchSize?: number;
    /** reinforce 时延长的 TTL（秒），默认 7 天 */
    reinforceTtlSeconds?: number;
    /** consolidate 时 memory_node 默认 confidence */
    defaultConfidence?: number;
}

// 系统消息留空：所有提示词内容由 templates/prompts/*.md 提供，避免代码内出现提示词字符串。

export class ConsolidationWorker {
    private readonly batchSize: number;
    private readonly reinforceTtl: number;
    private readonly defaultConfidence: number;

    constructor(
        private readonly redis: RedisMemoryStore,
        private readonly graph: SurrealGraphStore,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        options: ConsolidationWorkerOptions = {},
    ) {
        this.batchSize = options.batchSize ?? 32;
        this.reinforceTtl = options.reinforceTtlSeconds ?? 7 * 24 * 3600;
        this.defaultConfidence = options.defaultConfidence ?? 0.6;
    }

    /**
     * 处理一个用户当前到期的整合候选。
     * - 拉取 ff:cq:{userId} 中 reviewAt <= now 的 episode；
     * - 逐条让 LLM 决策；按结果走三条通道。
     */
    async drain(userId: string): Promise<ConsolidationRunResult> {
        const result: ConsolidationRunResult = {
            scanned: 0,
            reinforced: 0,
            consolidated: 0,
            discarded: 0,
            skipped: 0,
        };
        let candidateIds: string[];
        try {
            candidateIds = await this.redis.listConsolidationCandidates(
                userId,
                Math.floor(Date.now() / 1000),
                this.batchSize,
            );
        } catch (err) {
            this.publishFailure(userId, "list-candidates", err);
            return result;
        }
        result.scanned = candidateIds.length;
        for (const id of candidateIds) {
            try {
                const episode = await this.redis.readEpisode(userId, id);
                if (!episode) {
                    result.skipped += 1;
                    continue;
                }
                const decision = await this.classify(episode);
                if (decision.decision === ConsolidationDecisionKind.Discard) {
                    await this.redis.dropEpisode(userId, id);
                    result.discarded += 1;
                } else if (decision.decision === ConsolidationDecisionKind.Reinforce) {
                    await this.redis.touchConcepts(userId, episode.concepts ?? []);
                    result.reinforced += 1;
                } else if (decision.decision === ConsolidationDecisionKind.Consolidate) {
                    await this.consolidateEpisode(episode, decision);
                    await this.redis.dropEpisode(userId, id);
                    result.consolidated += 1;
                } else {
                    result.skipped += 1;
                }
            } catch (err) {
                this.publishFailure(userId, "process-candidate", err);
                result.skipped += 1;
            }
        }
        this.events.publish(event(RuntimeEventType.MemoryConsolidationCompleted, { userId, ...result }));
        return result;
    }

    /** Public for testing; calls model and parses structured JSON. */
    async classify(episode: EpisodeRecord): Promise<ConsolidationDecision> {
        const prompt = renderMemoryConsolidationPrompt({ episode: renderEpisodeBlock(episode) });
        const raw = await this.model.generate([{ role: ModelRole.User, content: prompt }]);
        return parseConsolidationDecision(raw);
    }

    /** Promote one episode to SurrealDB long-term storage with a memory_node + edge. */
    async consolidateEpisode(
        episode: EpisodeRecord,
        decision: ConsolidationDecision,
    ): Promise<void> {
        const memoryNodeId = crypto.randomUUID();
        await this.graph.upsertEpisode({
            id: episode.episodeId,
            userId: episode.userId,
            text: episode.text,
            concepts: episode.concepts,
            embedding: episode.embedding,
            importance: episode.importance,
            sourceKind: episode.sourceKind,
            createdAt: episode.createdAt,
            metadata: episode.metadata,
        });
        await this.graph.upsertMemoryNode({
            id: memoryNodeId,
            userId: episode.userId,
            symbols: decision.symbols ?? episode.concepts,
            summary: decision.summary ?? episode.text.slice(0, 240),
            embedding: episode.embedding,
            confidence: clamp01(decision.confidence ?? this.defaultConfidence),
            evidenceCount: 1,
            importance: episode.importance,
            updatedAt: Date.now(),
        });
        await this.graph.relateConsolidatedInto(episode.episodeId, memoryNodeId);
    }

    private publishFailure(userId: string, stage: string, err: unknown): void {
        this.events.publish(
            event(RuntimeEventType.MemoryConsolidationFailed, {
                userId,
                stage,
                error: String(err),
            }),
        );
    }
}

function renderEpisodeBlock(episode: EpisodeRecord): string {
    return [
        `episodeId: ${episode.episodeId}`,
        `importance: ${episode.importance.toFixed(2)}`,
        `concepts: ${JSON.stringify(episode.concepts ?? [])}`,
        `sourceKind: ${episode.sourceKind}`,
        `metadata: ${JSON.stringify(episode.metadata ?? {})}`,
        `text:`,
        episode.text.slice(0, 1500),
    ].join("\n");
}

export function parseConsolidationDecision(raw: string): ConsolidationDecision {
    const fallback: ConsolidationDecision = {
        decision: ConsolidationDecisionKind.Reinforce,
        confidence: 0,
        rationale: "parse-failed",
    };
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return fallback;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
        return fallback;
    }
    if (!isRecord(parsed)) return fallback;
    const decision = normaliseDecision(parsed.decision);
    if (!decision) return fallback;
    const confidence = clamp01(toNumber(parsed.confidence, 0));
    const summary =
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
            ? parsed.summary.trim().slice(0, 500)
            : undefined;
    const symbols = Array.isArray(parsed.symbols)
        ? parsed.symbols
              .filter((s): s is string => typeof s === "string" && s.length > 0)
              .slice(0, 16)
        : undefined;
    const rationale =
        typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 200) : "";
    return { decision, confidence, summary, symbols, rationale };
}

function normaliseDecision(value: unknown): ConsolidationDecisionKind | undefined {
    if (typeof value !== "string") return undefined;
    const known = Object.values(ConsolidationDecisionKind) as string[];
    return known.includes(value) ? (value as ConsolidationDecisionKind) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
