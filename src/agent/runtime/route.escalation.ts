/**
 * direct-with-watch 升级器（纯函数）。
 *
 * 资源指标驱动（零字符串匹配）：
 *   - 输入：当前 LLM 路由模式、本会话最近的 watch / failure 计数、阈值；
 *   - 输出：可选 escalation —— 把当前模式强制升格为 BlackboardMode.Blackboard。
 *
 * 触发条件（任一即升级）：
 *   1. 当前模式是 DirectWithWatch，且 consecutiveWatchTurns >= watchThreshold；
 *   2. 当前模式是 Direct 或 DirectWithWatch，且 consecutiveBlackboardFailures >= failureThreshold
 *      （上一轮黑板已经在 NeedsUser/Failed/MaxRoundsReached，连续 N 轮没消化，强制再开一次黑板做 contradiction-audit）。
 *
 * 设计约束：
 *   - 阈值 ≤ 0 时禁用对应通道；
 *   - 不读字符串、不调 LLM；
 *   - 调用方持有计数（FastRouteSnapshot），本函数无副作用。
 */

import { BlackboardMode, BlackboardTurnStatus } from "../../protocol/contracts/index.ts";
import type { BlackboardTurnStatus as BlackboardTurnStatusType } from "../../protocol/contracts/index.ts";

export const RouteEscalationReason = {
    None: "none",
    WatchSaturation: "watch-saturation",
    BlackboardFailureRetry: "blackboard-failure-retry",
} as const;
export type RouteEscalationReason =
    (typeof RouteEscalationReason)[keyof typeof RouteEscalationReason];

export interface RouteEscalationInput {
    currentMode: BlackboardMode;
    consecutiveWatchTurns: number;
    consecutiveBlackboardFailures: number;
    watchThreshold: number;
    failureThreshold: number;
}

export interface RouteEscalationDecision {
    escalated: boolean;
    targetMode: BlackboardMode;
    reason: RouteEscalationReason;
}

export function decideRouteEscalation(input: RouteEscalationInput): RouteEscalationDecision {
    const watchActive = input.watchThreshold > 0;
    const failureActive = input.failureThreshold > 0;
    const isWatchOrDirect =
        input.currentMode === BlackboardMode.DirectWithWatch ||
        input.currentMode === BlackboardMode.Direct;

    if (
        failureActive &&
        isWatchOrDirect &&
        input.consecutiveBlackboardFailures >= input.failureThreshold
    ) {
        return {
            escalated: true,
            targetMode: BlackboardMode.Blackboard,
            reason: RouteEscalationReason.BlackboardFailureRetry,
        };
    }

    if (
        watchActive &&
        input.currentMode === BlackboardMode.DirectWithWatch &&
        input.consecutiveWatchTurns >= input.watchThreshold
    ) {
        return {
            escalated: true,
            targetMode: BlackboardMode.Blackboard,
            reason: RouteEscalationReason.WatchSaturation,
        };
    }

    return {
        escalated: false,
        targetMode: input.currentMode,
        reason: RouteEscalationReason.None,
    };
}

/**
 * 给定一轮的实际 mode + blackboard 终态，返回更新后的 snapshot 计数。
 * direct → 全部清零；direct-with-watch → 增 watch 计数；blackboard 失败 → 增 failure 计数；
 * blackboard 收敛 → 全部清零。
 */
export function nextEscalationCounters(input: {
    actualMode: BlackboardMode;
    blackboardStatus?: BlackboardTurnStatusType;
    previousWatch: number;
    previousFailure: number;
}): { watch: number; failure: number } {
    if (input.actualMode === BlackboardMode.Direct) {
        return { watch: 0, failure: input.previousFailure };
    }
    if (input.actualMode === BlackboardMode.DirectWithWatch) {
        return { watch: input.previousWatch + 1, failure: input.previousFailure };
    }
    // blackboard
    if (input.blackboardStatus === BlackboardTurnStatus.Converged) {
        return { watch: 0, failure: 0 };
    }
    if (
        input.blackboardStatus === BlackboardTurnStatus.NeedsUser ||
        input.blackboardStatus === BlackboardTurnStatus.Failed
    ) {
        return { watch: 0, failure: input.previousFailure + 1 };
    }
    return { watch: input.previousWatch, failure: input.previousFailure };
}
