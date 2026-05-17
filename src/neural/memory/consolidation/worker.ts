import { ModelRole, type ModelClient } from "../../../protocol/contracts/index.ts";
import type { EpisodeRecord, WorkingMemoryStore, WorkingMemoryHealthSnapshot } from "../working/types.ts";
import { isWorkingMemoryCircuitCoolingDown } from "../working/types.ts";
import type { MemoryGraphStore } from "../graph/types.ts";
import { event, RuntimeEventType, type EventSink } from "../../../protocol/events/index.ts";
import { renderMemoryConsolidationPrompt } from "../../../agent/prompts/index.ts";
import type { RetrospectiveLog } from "./retrospective.ts";

/**
 * 整合 Worker (consolidation worker)。
 *
 * 角色（与 README.md §7 晶体智力候选与升格对齐）：
 * 1. 周期扫描工作记忆 Component（已到 review 时间的 episode 候选）；
 * 2. 让 LLM 输出结构化决策：reinforce / consolidate / discard；
 * 3. consolidate → upsert 晶体图 Component 的 episode + memory_node + 边；
 * 4. discard → 直接 dropEpisode；
 * 5. reinforce → 不写长期图，重置工作记忆 TTL（让其在工作记忆里存活更久）。
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
export type ConsolidationDecisionKind = (typeof ConsolidationDecisionKind)[keyof typeof ConsolidationDecisionKind];

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

const FALLBACK_CONSOLIDATION_DECISION: ConsolidationDecision = {
    decision: ConsolidationDecisionKind.Discard,
    confidence: 0,
    rationale: "invalid consolidation output",
};

export interface ConsolidationWorkerOptions {
    /** 每轮 drain 的最大候选数（默认 32） */
    batchSize?: number;
    /** reinforce 时延长的 TTL（秒），默认 7 天 */
    reinforceTtlSeconds?: number;
    /** consolidate 时 memory_node 默认 confidence */
    defaultConfidence?: number;
    /** 可选的回顾日志：consolidate / discard 决策结果会追加到 RETROSPECTIVE.md */
    retrospective?: RetrospectiveLog;
    /** 工作记忆健康快照，用于在 breaker 冷却期内薄跳过。 */
    workingMemoryHealthSnapshot?: () => WorkingMemoryHealthSnapshot | undefined;
}

// 系统消息留空：所有提示词内容由 templates/prompts/*.md 提供，避免代码内出现提示词字符串。

export class ConsolidationWorker {
    private readonly batchSize: number;
    private readonly reinforceTtl: number;
    private readonly defaultConfidence: number;
    private readonly retrospective?: RetrospectiveLog;
    private readonly workingMemoryHealthSnapshot?: () => WorkingMemoryHealthSnapshot | undefined;

    public constructor(
        private readonly workingMemory: WorkingMemoryStore,
        private readonly graph: MemoryGraphStore,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        options: ConsolidationWorkerOptions = {},
    ) {
        this.batchSize = options.batchSize ?? 32;
        this.reinforceTtl = options.reinforceTtlSeconds ?? 7 * 24 * 3600;
        this.defaultConfidence = options.defaultConfidence ?? 0.6;
        this.retrospective = options.retrospective;
        this.workingMemoryHealthSnapshot = options.workingMemoryHealthSnapshot;
    }

    /**
     * 处理一个用户当前到期的整合候选。
     * - 拉取工作记忆 Component 中 reviewAt <= now 的 episode；
     * - 逐条让 LLM 决策；按结果走三条通道。
     */
    public async drain(userId: string): Promise<ConsolidationRunResult> {
        const result: ConsolidationRunResult = {
            scanned: 0,
            reinforced: 0,
            consolidated: 0,
            discarded: 0,
            skipped: 0,
        };
        if (isWorkingMemoryCircuitCoolingDown(this.workingMemoryHealthSnapshot?.(), Date.now())) {
            return result;
        }
        let candidateIds: string[];
        try {
            candidateIds = await this.workingMemory.listConsolidationCandidates(
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
                const episode = await this.workingMemory.readEpisode(userId, id);
                if (!episode) {
                    result.skipped += 1;
                    continue;
                }
                const decision = await this.classify(episode);
                if (decision.decision === ConsolidationDecisionKind.Discard) {
                    // 回顾日志是 discard 证据；先写审计再删除热记忆，避免审计盘故障时静默丢失可复核样本。
                    await this.retrospective?.append({
                        kind: "discard",
                        userId,
                        episodeId: episode.episodeId,
                        rationale: decision.rationale,
                    });
                    await this.workingMemory.dropEpisode(userId, id);
                    result.discarded += 1;
                } else if (decision.decision === ConsolidationDecisionKind.Reinforce) {
                    await this.workingMemory.touchConcepts(userId, episode.concepts ?? []);
                    await this.workingMemory.reinforceEpisode(userId, id, this.reinforceTtl);
                    result.reinforced += 1;
                } else if (decision.decision === ConsolidationDecisionKind.Consolidate) {
                    await this.consolidateEpisode(episode, decision);
                    // 长期图写入成功后再落回顾证据；审计失败时保留热记忆候选，下一轮可重试或人工排查。
                    await this.retrospective?.append({
                        kind: "consolidate",
                        userId,
                        episodeId: episode.episodeId,
                        summary: decision.summary ?? episode.text.slice(0, 240),
                        symbols: decision.symbols ?? episode.concepts,
                        rationale: decision.rationale,
                    });
                    await this.workingMemory.dropEpisode(userId, id);
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
    public async classify(episode: EpisodeRecord): Promise<ConsolidationDecision> {
        const prompt = renderMemoryConsolidationPrompt({ episode: renderEpisodeBlock(episode) });
        const raw = await this.model.generate([{ role: ModelRole.User, content: prompt }]);
        return parseConsolidationDecision(raw);
    }

    /** Promote one working-memory episode to the CrystalComponent long-term graph with a memory_node + edge. */
    public async consolidateEpisode(episode: EpisodeRecord, decision: ConsolidationDecision): Promise<void> {
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
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
        return fallbackConsolidationDecision();
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    } catch {
        return fallbackConsolidationDecision();
    }
    if (!isRecord(parsed)) {
        return fallbackConsolidationDecision();
    }
    const decision = normaliseDecision(parsed.decision);
    if (!decision) {
        return fallbackConsolidationDecision();
    }
    const confidence = clamp01(readNumber(parsed.confidence));
    const summary =
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
            ? parsed.summary.trim().slice(0, 500)
            : undefined;
    const symbols = Array.isArray(parsed.symbols)
        ? parsed.symbols.filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 16)
        : undefined;
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 200) : "";
    return { decision, confidence, summary, symbols, rationale };
}

function fallbackConsolidationDecision(): ConsolidationDecision {
    // Bad maintenance output should drop the candidate for this pass, not crash the background chain.
    return { ...FALLBACK_CONSOLIDATION_DECISION };
}

function normaliseDecision(value: unknown): ConsolidationDecisionKind | undefined {
    if (typeof value !== "string") return undefined;
    const known = Object.values(ConsolidationDecisionKind) as string[];
    return known.includes(value) ? (value as ConsolidationDecisionKind) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
