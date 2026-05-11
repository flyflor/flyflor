/**
 * Dream Mode worker：海马体梦境模式（DESIGN.md §12）。
 *
 * 触发方式：
 *  - 由 BackgroundScheduler 在低活跃 tick 触发；
 *  - 也可由 RuntimeModule 在用户长时间静默时手动触发。
 *
 * 数据流（与 ConsolidationWorker 互补，不重叠）：
 *  - Consolidation 处理"到期 review 候选"，决策 reinforce / consolidate / discard；
 *  - Dream 处理"未 protected 的批量 episode"，决策 rewrite / discard / skip；
 *  - 二者使用不同 Redis 队列，互不踩踏：consolidation 走 ff:cq:{userId}，dream 走 ff:dream:{userId}。
 *
 * 设计约束（与 docs/boundaries.md 对齐）：
 *  - 零字符串匹配：所有动作判定来自 LLM 结构化 JSON，代码只校验 enum + JSON shape；
 *  - 提示词全部走 templates/prompts/memory.dream.md，源码内零提示词；
 *  - protected 候选直接 skip，绝不送入 LLM；
 *  - 失败只发事件不抛错（保持后台幂等）；
 *  - 无 native 依赖，bun --compile 安全。
 */

import { ModelRole, type ModelClient } from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { renderMemoryDreamPrompt } from "../prompts/index.ts";
import type { EpisodeRecord } from "../../neural/memory/redis.ts";

export interface DreamCandidate {
    userId: string;
    episodeId: string;
    /** 是否是 protected episode（identity core / 用户明确锁定）。protected 不参与重写。 */
    protected: boolean;
}

export interface DreamRunResult {
    consolidated: number;
    rewritten: number;
    discarded: number;
    skipped: number;
}

export interface DreamWorker {
    /** 入队一条候选；失败请抛出，由调用方决定降级。 */
    enqueue(candidate: DreamCandidate): Promise<void>;
    /** 拉取并处理至多 limit 条；返回结构化指标（无副作用 logger 化）。 */
    drain(userId: string, limit: number): Promise<DreamRunResult>;
}

/**
 * Dream worker 所需的最小记忆端口，便于测试用 fake 替换。
 * 真实实现由 RedisMemoryStore 满足（structural typing）。
 */
export interface DreamMemoryPort {
    enqueueDream(userId: string, episodeId: string): Promise<void>;
    popDreamCandidates(userId: string, limit: number): Promise<string[]>;
    readEpisode(userId: string, episodeId: string): Promise<EpisodeRecord | undefined>;
    rewriteEpisode(
        userId: string,
        episodeId: string,
        patch: { text?: string; concepts?: string[]; importance?: number; metadata?: Record<string, unknown> },
    ): Promise<boolean>;
    dropEpisode(userId: string, episodeId: string): Promise<void>;
}

/**
 * 默认 No-op 实现：返回零指标，不做任何工作。
 * 在没有 Redis 或 ModelClient 时使用，保持 RuntimeModule 依赖图稳定。
 */
export class NullDreamWorker implements DreamWorker {
    async enqueue(_candidate: DreamCandidate): Promise<void> {
        // intentional no-op
    }

    async drain(_userId: string, _limit: number): Promise<DreamRunResult> {
        return { consolidated: 0, rewritten: 0, discarded: 0, skipped: 0 };
    }
}

export const DreamActionKind = {
    Rewrite: "rewrite",
    Discard: "discard",
    Skip: "skip",
} as const;
export type DreamActionKind = (typeof DreamActionKind)[keyof typeof DreamActionKind];

export interface DreamDecision {
    episodeId: string;
    action: DreamActionKind;
    newText?: string;
    newConcepts?: string[];
    newImportance?: number;
}

export interface DreamWorkerOptions {
    /** 单批次送入 LLM 的最大 episode 数（默认 8）。 */
    batchSize?: number;
    /** rewrite 决策时单条 newText 的硬上限字符数（默认 600）。 */
    maxRewriteChars?: number;
}

export class DreamWorkerImpl implements DreamWorker {
    private readonly batchSize: number;
    private readonly maxRewriteChars: number;

    constructor(
        private readonly memory: DreamMemoryPort,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        options: DreamWorkerOptions = {},
    ) {
        this.batchSize = Math.max(1, options.batchSize ?? 8);
        this.maxRewriteChars = Math.max(64, options.maxRewriteChars ?? 600);
    }

    async enqueue(candidate: DreamCandidate): Promise<void> {
        if (!candidate || typeof candidate.episodeId !== "string" || candidate.episodeId.length === 0) {
            return;
        }
        if (candidate.protected) {
            // protected episode 永不参与 dream rewrite，连入队都跳过。
            return;
        }
        await this.memory.enqueueDream(candidate.userId, candidate.episodeId);
    }

    async drain(userId: string, limit: number): Promise<DreamRunResult> {
        const result: DreamRunResult = { consolidated: 0, rewritten: 0, discarded: 0, skipped: 0 };
        const cap = Math.min(Math.max(0, limit), this.batchSize);
        if (cap === 0) return result;

        let ids: string[];
        try {
            ids = await this.memory.popDreamCandidates(userId, cap);
        } catch (err) {
            this.publishFailure(userId, "pop-candidates", err);
            return result;
        }
        if (ids.length === 0) return result;

        const episodes: EpisodeRecord[] = [];
        for (const id of ids) {
            try {
                const ep = await this.memory.readEpisode(userId, id);
                if (ep) episodes.push(ep);
                else result.skipped += 1;
            } catch (err) {
                this.publishFailure(userId, "read-episode", err);
                result.skipped += 1;
            }
        }
        if (episodes.length === 0) return result;

        let raw: string;
        try {
            const prompt = renderMemoryDreamPrompt({
                userId,
                episodes: renderDreamEpisodeBlock(episodes),
            });
            raw = await this.model.generate([{ role: ModelRole.User, content: prompt }]);
        } catch (err) {
            this.publishFailure(userId, "llm-call", err);
            // LLM 失败时所有未处理的 episode 计为 skipped；候选已经从 Redis pop 出来不会再次处理，
            // 但 dream 是有损通道，丢失 ≤ batch 条 episode 的影响在可容忍范围内。
            result.skipped += episodes.length;
            return result;
        }

        const decisions = parseDreamDecisions(raw, this.maxRewriteChars);
        const byId = new Map(decisions.map((d) => [d.episodeId, d] as const));
        for (const ep of episodes) {
            const decision = byId.get(ep.episodeId);
            if (!decision) {
                result.skipped += 1;
                continue;
            }
            try {
                if (decision.action === DreamActionKind.Discard) {
                    await this.memory.dropEpisode(userId, ep.episodeId);
                    result.discarded += 1;
                } else if (decision.action === DreamActionKind.Rewrite) {
                    const ok = await this.memory.rewriteEpisode(userId, ep.episodeId, {
                        text: decision.newText,
                        concepts: decision.newConcepts,
                        importance: decision.newImportance,
                    });
                    if (ok) {
                        result.rewritten += 1;
                    } else {
                        result.skipped += 1;
                    }
                } else {
                    result.skipped += 1;
                }
            } catch (err) {
                this.publishFailure(userId, "apply-decision", err);
                result.skipped += 1;
            }
        }
        this.events.publish(
            event(RuntimeEventType.MemoryDreamCompleted, {
                userId,
                scanned: episodes.length,
                ...result,
            }),
        );
        return result;
    }

    private publishFailure(userId: string, stage: string, err: unknown): void {
        this.events.publish(
            event(RuntimeEventType.MemoryDreamFailed, {
                userId,
                stage,
                error: String(err),
            }),
        );
    }
}

export const DREAM_QUEUE_KEY_TEMPLATE = "ff:dream:{userId}";

export function dreamQueueKey(userId: string): string {
    return DREAM_QUEUE_KEY_TEMPLATE.replace("{userId}", userId);
}

function renderDreamEpisodeBlock(episodes: EpisodeRecord[]): string {
    return episodes
        .map((ep) =>
            [
                `- episodeId: ${ep.episodeId}`,
                `  importance: ${ep.importance.toFixed(2)}`,
                `  concepts: ${JSON.stringify(ep.concepts ?? [])}`,
                `  sourceKind: ${ep.sourceKind}`,
                `  text: ${ep.text.slice(0, 800).replace(/\s+/g, " ").trim()}`,
            ].join("\n"),
        )
        .join("\n");
}

export function parseDreamDecisions(raw: string, maxRewriteChars: number): DreamDecision[] {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
        return [];
    }
    if (!isRecord(parsed)) return [];
    const list = (parsed as { decisions?: unknown }).decisions;
    if (!Array.isArray(list)) return [];
    const out: DreamDecision[] = [];
    for (const entry of list) {
        if (!isRecord(entry)) continue;
        const episodeId = typeof entry.episodeId === "string" ? entry.episodeId.trim() : "";
        if (episodeId.length === 0) continue;
        const action = normaliseDreamAction(entry.action);
        if (!action) continue;
        const decision: DreamDecision = { episodeId, action };
        if (action === DreamActionKind.Rewrite) {
            const text = typeof entry.newText === "string" ? entry.newText.trim() : "";
            if (text.length === 0) {
                // rewrite 缺少新文本 → 退化为 skip
                decision.action = DreamActionKind.Skip;
            } else {
                decision.newText = text.slice(0, maxRewriteChars);
                if (Array.isArray(entry.newConcepts)) {
                    decision.newConcepts = entry.newConcepts
                        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
                        .map((s) => s.trim().toLowerCase())
                        .slice(0, 16);
                }
                if (
                    typeof entry.newImportance === "number" &&
                    Number.isFinite(entry.newImportance)
                ) {
                    decision.newImportance = clamp01(entry.newImportance);
                }
            }
        }
        out.push(decision);
    }
    return out;
}

function normaliseDreamAction(value: unknown): DreamActionKind | undefined {
    if (typeof value !== "string") return undefined;
    const known = Object.values(DreamActionKind) as string[];
    return known.includes(value) ? (value as DreamActionKind) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

