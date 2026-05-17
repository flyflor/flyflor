/**
 * Dream 模式 worker（README.md §12）：晶体层离线维护。
 *
 * 与 ConsolidationWorker 严格不重叠：
 *  - Consolidation 在 MemoryComponent→CrystalComponent 升格通道，处理"哪些 episode 应该被晶体化"；
 *  - Dream 完全运行在 CrystalComponent 长期层上，做三件事：
 *    1. drift-repair：修复已晶体化但产生漂移的 Gem（scope 错位 / 长期未验证 / 矛盾累积）；
 *    2. recall-reinforce：把近期 recallCount 极端值反映到 importance（热门拉高、冷门降级）；
 *    3. contradiction-audit：ANN 邻居中疑似冲突的二元对，让 LLM 决断弱侧并降权。
 *
 * 候选来自晶体图查询（dream.candidates.ts），不读 text；语义判断只由 LLM 在
 * memory.dream 提示词模板中产出结构化 JSON，本文件做 enum + JSON shape 校验。
 *
 * 红线（与 docs/boundaries.md 对齐）：
 *  - 零业务字符串匹配；
 *  - 任何 Gem 写入必须先 writeGemSnapshot；
 *  - protected = true 的 Gem 不参与 dream（候选层就过滤掉）；
 *  - 失败只发事件不抛错；
 *  - 无 native 依赖，bun --compile 安全。
 */

import { ModelRole, type ModelClient } from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { renderMemoryDreamPrompt } from "../../agent/prompts/index.ts";
import {
    collectDreamCandidates,
    DreamCandidateKind,
    type DreamCandidate,
} from "./dream.candidates.ts";
import { DreamActionKind, parseDreamDecisions, type DreamDecision } from "./dream.decisions.ts";
import type { MemoryGraphStore } from "./graph/types.ts";

export { DreamActionKind, parseDreamDecisions } from "./dream.decisions.ts";
export type { DreamDecision } from "./dream.decisions.ts";
export type { DreamCandidate } from "./dream.candidates.ts";

export interface DreamRunResult {
    scanned: number;
    driftRepaired: number;
    recallReinforced: number;
    contradictionsFlagged: number;
    reconsolidated: number;
    skipped: number;
}

export interface DreamWorker {
    /**
     * 跑一轮 dream pass。limit 是单批次送 LLM 的候选数上限。
     * userId 强制必填：dream 是 per-user 操作（用户记忆边界）。
     */
    runOnce(userId: string, limit?: number): Promise<DreamRunResult>;
}

/** No-op 实现：缺少晶体图 Component 或 ModelClient 时使用，保持依赖图稳定。 */
export class NullDreamWorker implements DreamWorker {
    public async runOnce(_userId: string, _limit?: number): Promise<DreamRunResult> {
        return zeroResult();
    }
}

export interface DreamWorkerOptions {
    /** 单 pass 候选上限（与 DREAM_THRESHOLDS.maxCandidatesPerPass 取小）。 */
    maxCandidates?: number;
    /** 注入 now（测试用）。 */
    now?: () => number;
}

export class DreamWorkerImpl implements DreamWorker {
    private readonly now: () => number;
    private readonly maxCandidates: number;

    public constructor(
        private readonly graph: MemoryGraphStore,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        options: DreamWorkerOptions = {},
    ) {
        this.now = options.now ?? (() => Date.now());
        this.maxCandidates = Math.max(1, options.maxCandidates ?? 24);
    }

    public async runOnce(userId: string, limit?: number): Promise<DreamRunResult> {
        if (typeof userId !== "string" || userId.length === 0) return zeroResult();
        const cap = Math.min(this.maxCandidates, limit && limit > 0 ? limit : this.maxCandidates);
        const nowMs = this.now();

        let candidates: DreamCandidate[];
        try {
            candidates = await collectDreamCandidates(this.graph, { userId, nowMs });
        } catch (err) {
            this.publishFailure(userId, "collect", err);
            return zeroResult();
        }
        candidates = candidates.slice(0, cap);
        const result = zeroResult();
        result.scanned = candidates.length;
        if (candidates.length === 0) {
            this.publishCompleted(userId, result);
            return result;
        }

        let raw: string;
        try {
            const prompt = renderMemoryDreamPrompt({
                userId,
                candidates: renderCandidatesBlock(candidates),
            });
            raw = await this.model.generate([{ role: ModelRole.User, content: prompt }]);
        } catch (err) {
            this.publishFailure(userId, "llm", err);
            result.skipped = candidates.length;
            return result;
        }

        const decisions = parseDreamDecisions(raw);
        const byId = new Map<string, DreamDecision>(decisions.map((d) => [d.candidateId, d]));
        for (const cand of candidates) {
            const dec = byId.get(cand.candidateId);
            if (!dec) {
                result.skipped += 1;
                continue;
            }
            try {
                const applied = await this.applyDecision(userId, cand, dec, nowMs);
                if (applied === "drift") result.driftRepaired += 1;
                else if (applied === "recall") result.recallReinforced += 1;
                else if (applied === "contradiction") result.contradictionsFlagged += 1;
                else if (applied === "reconsolidation") result.reconsolidated += 1;
                else result.skipped += 1;
            } catch (err) {
                this.publishFailure(userId, "apply", err);
                result.skipped += 1;
            }
        }
        this.publishCompleted(userId, result);
        return result;
    }

    private async applyDecision(
        userId: string,
        candidate: DreamCandidate,
        decision: DreamDecision,
        nowMs: number,
    ): Promise<"drift" | "recall" | "contradiction" | "reconsolidation" | "skip"> {
        if (decision.action === DreamActionKind.Skip) return "skip";

        if (decision.action === DreamActionKind.DriftRepair) {
            if (candidate.kind !== DreamCandidateKind.GemDrift) return "skip";
            // 红线：写入前必须先快照。
            const snapId = await this.graph.writeGemSnapshot(
                {
                    id: candidate.gemId,
                    userId,
                    summary: candidate.summary,
                    symbols: candidate.symbols,
                    embedding: [],
                    confidence: candidate.signals.confidence ?? 0,
                    support: 0,
                    protected: false,
                    updatedAt: nowMs,
                },
                `dream-drift-repair:${nowMs}`,
                nowMs,
            );
            const ok = await this.graph.applyGemDriftRepair({
                gemId: candidate.gemId,
                nowMs,
                newSummary: decision.newSummary,
                newSymbols: decision.newSymbols,
                newStatus: decision.newStatus,
                scopeNote: decision.scopeNote,
                confidenceMultiplier: decision.confidenceMultiplier,
            });
            if (ok) {
                this.events.publish(
                    event(RuntimeEventType.MemoryDriftRepaired, {
                        userId,
                        gemId: candidate.gemId,
                        snapshotId: snapId,
                        newStatus: decision.newStatus,
                    }),
                );
                return "drift";
            }
            return "skip";
        }

        if (decision.action === DreamActionKind.RecallReinforce) {
            if (candidate.kind !== DreamCandidateKind.Recall) return "skip";
            const ok = await this.graph.applyMemoryReinforce({
                table: candidate.target.table,
                id: candidate.target.id,
                importanceMultiplier: decision.importanceMultiplier,
                nowMs,
            });
            if (ok) {
                this.events.publish(
                    event(RuntimeEventType.MemoryRecallReinforced, {
                        userId,
                        table: candidate.target.table,
                        id: candidate.target.id,
                        importanceMultiplier: decision.importanceMultiplier,
                    }),
                );
                return "recall";
            }
            return "skip";
        }

        if (decision.action === DreamActionKind.ContradictionAudit) {
            if (candidate.kind !== DreamCandidateKind.ContradictionPair) return "skip";
            const targets: Array<{ side: "left" | "right"; ref: { table: "memory_node" | "gem"; id: string } }> = [];
            if (decision.weaker === "left" || decision.weaker === "both") {
                targets.push({ side: "left", ref: candidate.left });
            }
            if (decision.weaker === "right" || decision.weaker === "both") {
                targets.push({ side: "right", ref: candidate.right });
            }
            const m = decision.confidenceMultiplier ?? 0.7;
            const delta = decision.contradictionDelta ?? 1;
            const relate = decision.relate ?? true;
            let appliedAny = false;
            for (const t of targets) {
                const other = t.side === "left" ? candidate.right : candidate.left;
                const ok = await this.graph.applyContradictionAudit({
                    table: t.ref.table,
                    id: t.ref.id,
                    confidenceMultiplier: m,
                    contradictionDelta: delta,
                    nowMs,
                    relateWith: relate ? { table: other.table, id: other.id } : undefined,
                });
                if (ok) appliedAny = true;
            }
            if (appliedAny) {
                this.events.publish(
                    event(RuntimeEventType.MemoryContradictionFlagged, {
                        userId,
                        left: candidate.left,
                        right: candidate.right,
                        weaker: decision.weaker,
                        cosine: candidate.cosine,
                    }),
                );
                return "contradiction";
            }
            return "skip";
        }

        if (decision.action === DreamActionKind.Reconsolidation) {
            if (candidate.kind !== DreamCandidateKind.ContradictionPair) return "skip";
            // 资源指标短路：至少一侧 contradictionCount ≥ 1 或 cosine ≥ 0.85，避免在弱信号上做合并。
            const lc = candidate.signalsLeft.contradictionCount ?? 0;
            const rc = candidate.signalsRight.contradictionCount ?? 0;
            if (lc < 1 && rc < 1 && candidate.cosine < 0.85) return "skip";
            const ok = await this.graph.applyReconsolidation({
                left: { table: candidate.left.table, id: candidate.left.id },
                right: { table: candidate.right.table, id: candidate.right.id },
                winner: decision.winner,
                nowMs,
                mergedSummary: decision.mergedSummary,
                mergedSymbols: decision.mergedSymbols,
                scopeNote: decision.scopeNote,
            });
            if (ok) {
                this.events.publish(
                    event(RuntimeEventType.MemoryReconsolidated, {
                        userId,
                        left: candidate.left,
                        right: candidate.right,
                        winner: decision.winner,
                        cosine: candidate.cosine,
                    }),
                );
                return "reconsolidation";
            }
            return "skip";
        }

        return "skip";
    }

    private publishCompleted(userId: string, result: DreamRunResult): void {
        this.events.publish(event(RuntimeEventType.MemoryDreamCompleted, { userId, ...result }));
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

function zeroResult(): DreamRunResult {
    return { scanned: 0, driftRepaired: 0, recallReinforced: 0, contradictionsFlagged: 0, reconsolidated: 0, skipped: 0 };
}

/** 把候选集合渲染成 LLM 可读的紧凑文本块；不包含任何业务语义指令。 */
export function renderCandidatesBlock(candidates: DreamCandidate[]): string {
    return candidates
        .map((c) => {
            if (c.kind === DreamCandidateKind.GemDrift) {
                return [
                    `- candidateId: ${c.candidateId}`,
                    `  kind: method-drift`,
                    `  gemId: ${c.gemId}`,
                    `  symbols: ${JSON.stringify(c.symbols)}`,
                    `  signals: ${JSON.stringify(c.signals)}`,
                    `  summary: ${oneLine(c.summary)}`,
                ].join("\n");
            }
            if (c.kind === DreamCandidateKind.Recall) {
                return [
                    `- candidateId: ${c.candidateId}`,
                    `  kind: recall`,
                    `  target: ${c.target.table}:${c.target.id}`,
                    `  bucket: ${c.bucket}`,
                    `  symbols: ${JSON.stringify(c.symbols)}`,
                    `  signals: ${JSON.stringify(c.signals)}`,
                    `  summary: ${oneLine(c.summary)}`,
                ].join("\n");
            }
            return [
                `- candidateId: ${c.candidateId}`,
                `  kind: contradiction-pair`,
                `  cosine: ${c.cosine}`,
                `  left: ${c.left.table}:${c.left.id}`,
                `  leftSummary: ${oneLine(c.left.summary)}`,
                `  leftSignals: ${JSON.stringify(c.signalsLeft)}`,
                `  right: ${c.right.table}:${c.right.id}`,
                `  rightSummary: ${oneLine(c.right.summary)}`,
                `  rightSignals: ${JSON.stringify(c.signalsRight)}`,
            ].join("\n");
        })
        .join("\n");
}

function oneLine(text: string): string {
    return text.slice(0, 400).replace(/\s+/g, " ").trim();
}
