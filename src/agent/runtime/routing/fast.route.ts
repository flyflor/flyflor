import { BlackboardMode } from "../../../protocol/contracts/index.ts";
import type { RoutingConfig } from "../../../config/index.ts";
import type { RuntimeBlackboardRouteDecision } from "../blackboard/route.ts";

/**
 * fastRoute：在调用 LLM 路由器之前的纯指标短路。
 *
 * 严禁字符串/正则/关键词匹配（见 docs/boundaries.md "业务语义零字符串匹配"）；
 * 只允许使用：
 *   1. 上一轮模型显式给出的 nextRouteHint（结构化输出，age 内有效）；
 *   2. 当前 message embedding 与上一轮 message embedding 的余弦相似度；
 *   3. 估算 token 数（根据字符数粗算，仅作资源指标）。
 *
 * 命中后返回 RuntimeBlackboardRouteDecision（mode=Direct），
 * 主链路跳过 route LLM 调用，预期 60-70% 的轻量请求 bypass。
 */

export interface FastRouteSnapshot {
    /** 上一轮模型最终给出的下一步路由提示，由 RuntimeModule 在 turn end 时记录。 */
    nextRouteHint?: BlackboardMode;
    /** 上一轮记录的 wall-clock 时间戳（ms）。 */
    recordedAt: number;
    /** 上一轮 message embedding（与当前 message embedding 维度相同）。 */
    embedding?: number[];
    /** 上一轮实际命中的 mode，用于相似消息复用。 */
    lastMode: BlackboardMode;
    /** 当前 (channel, chatId, user) 维度，连续命中 direct-with-watch 的轮数。 */
    consecutiveWatchTurns?: number;
    /** 黑板未收敛（NeedsUser / Failed / MaxRoundsReached）连续轮数。 */
    consecutiveBlackboardFailures?: number;
    /**
     * 上一轮 MCP 工具调用失败率达到 toolFailureRatioTrigger 的连续轮数。
     * 用于「工具反复失败」语义升级信号；零字符匹配，仅用 ok 计数。
     */
    consecutiveToolFailureTurns?: number;
}

export interface FastRouteInput {
    config: RoutingConfig;
    snapshot?: FastRouteSnapshot;
    nowMs: number;
    currentEmbedding?: number[];
    /** 当前 message text 长度，用于估算 token 数（粗算 4 chars/token）。 */
    messageChars: number;
}

export interface FastRouteResult {
    /** 是否短路成功。 */
    bypass: boolean;
    /** 命中原因（结构化常量字符串，便于事件审计），未命中时为 reason。 */
    reason: FastRouteReason;
    /** 命中时携带 cosine 相似度等指标，便于事件采集；未命中时为 undefined。 */
    metrics?: { similarity?: number; estimatedTokens?: number };
}

export const FastRouteReason = {
    Disabled: "disabled",
    NoSnapshot: "no-snapshot",
    HintExpired: "hint-expired",
    HintNotDirect: "hint-not-direct",
    SimilarityBelowThreshold: "similarity-below-threshold",
    BudgetExceeded: "budget-exceeded",
    BypassByHint: "bypass-by-hint",
    BypassBySimilarity: "bypass-by-similarity",
    BypassByBudget: "bypass-by-budget",
} as const;
export type FastRouteReason = (typeof FastRouteReason)[keyof typeof FastRouteReason];

/**
 * Runtime fast-route owner.
 *
 * Production code should hold this class; the exported functions below are
 * compatibility shims for tests and older public imports.
 */
export class FastRouteEvaluator {
    public evaluate(input: FastRouteInput): FastRouteResult {
        const { config, snapshot, nowMs, currentEmbedding, messageChars } = input;

        if (!config.fastRouteEnabled) {
            return { bypass: false, reason: FastRouteReason.Disabled };
        }

        // 资源指标 1：token 预算超低（短消息）→ 一定 bypass。
        const estimatedTokens = Math.ceil(Math.max(0, messageChars) / 4);
        if (estimatedTokens > 0 && estimatedTokens < config.routeBypassTokenBudget) {
            return {
                bypass: true,
                reason: FastRouteReason.BypassByBudget,
                metrics: { estimatedTokens },
            };
        }

        if (!snapshot) {
            return { bypass: false, reason: FastRouteReason.NoSnapshot };
        }

        // 资源指标 2：上一轮模型 hint 仍有效 → 直接 bypass。
        const age = nowMs - snapshot.recordedAt;
        if (snapshot.nextRouteHint === BlackboardMode.Direct && age >= 0 && age < config.routeHintTtlMs) {
            return { bypass: true, reason: FastRouteReason.BypassByHint, metrics: { estimatedTokens } };
        }

        // 资源指标 3：当前 vs 上一轮 embedding 相似度高，且上一轮就是 direct → 复用结论。
        if (currentEmbedding && snapshot.embedding && snapshot.lastMode === BlackboardMode.Direct) {
            const similarity = this.cosineSimilarity(currentEmbedding, snapshot.embedding);
            if (similarity > config.similarityBypassThreshold) {
                return {
                    bypass: true,
                    reason: FastRouteReason.BypassBySimilarity,
                    metrics: { similarity, estimatedTokens },
                };
            }
            return {
                bypass: false,
                reason: FastRouteReason.SimilarityBelowThreshold,
                metrics: { similarity, estimatedTokens },
            };
        }

        if (snapshot.nextRouteHint && snapshot.nextRouteHint !== BlackboardMode.Direct) {
            return { bypass: false, reason: FastRouteReason.HintNotDirect, metrics: { estimatedTokens } };
        }
        return { bypass: false, reason: FastRouteReason.HintExpired, metrics: { estimatedTokens } };
    }

    /**
     * 命中 fastRoute 时直接构造 direct 路由决策，跳过 LLM 调用。
     */
    public buildBypassDecision(reason: FastRouteReason): RuntimeBlackboardRouteDecision {
        return {
            mode: BlackboardMode.Direct,
            score: 0,
            reason: `fastroute:${reason}`,
            signals: [],
            needsReflectionCandidate: false,
            blackboardContract: {
                contradictions: [],
                evidence: [],
                mode: "normal",
                policyReason: "fastroute-bypass",
            },
            workers: [],
            raw: "",
        };
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length === 0 || b.length === 0 || a.length !== b.length) {
            return 0;
        }
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < a.length; i += 1) {
            const av = a[i] ?? 0;
            const bv = b[i] ?? 0;
            dot += av * bv;
            magA += av * av;
            magB += bv * bv;
        }
        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }
}

export const fastRouteEvaluator = new FastRouteEvaluator();

export function evaluateFastRoute(input: FastRouteInput): FastRouteResult {
    return fastRouteEvaluator.evaluate(input);
}

export function buildBypassDecision(reason: FastRouteReason): RuntimeBlackboardRouteDecision {
    return fastRouteEvaluator.buildBypassDecision(reason);
}
