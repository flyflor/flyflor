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

import { BlackboardMode, BlackboardTurnStatus } from "../../../protocol/contracts/index.ts";
import type { BlackboardTurnStatus as BlackboardTurnStatusType } from "../../../protocol/contracts/index.ts";

export const RouteEscalationReason = {
    None: "none",
    WatchSaturation: "watch-saturation",
    BlackboardFailureRetry: "blackboard-failure-retry",
    ToolFailureSaturation: "tool-failure-saturation",
    ContextPressure: "context-pressure",
} as const;
export type RouteEscalationReason = (typeof RouteEscalationReason)[keyof typeof RouteEscalationReason];

export interface RouteEscalationInput {
    currentMode: BlackboardMode;
    consecutiveWatchTurns: number;
    consecutiveBlackboardFailures: number;
    consecutiveToolFailureTurns?: number;
    contextPressureRatio?: number;
    watchThreshold: number;
    failureThreshold: number;
    toolFailureThreshold?: number;
    contextPressureTrigger?: number;
}

export interface RouteEscalationDecision {
    escalated: boolean;
    targetMode: BlackboardMode;
    reason: RouteEscalationReason;
}

export function decideRouteEscalation(input: RouteEscalationInput): RouteEscalationDecision {
    const watchActive = input.watchThreshold > 0;
    const failureActive = input.failureThreshold > 0;
    const toolThreshold = input.toolFailureThreshold ?? 0;
    const pressureTrigger = input.contextPressureTrigger ?? 0;
    const toolActive = toolThreshold > 0;
    const pressureActive = pressureTrigger > 0;
    const toolTurns = input.consecutiveToolFailureTurns ?? 0;
    const pressureRatio = input.contextPressureRatio ?? 0;
    const isWatchOrDirect =
        input.currentMode === BlackboardMode.DirectWithWatch || input.currentMode === BlackboardMode.Direct;

    if (pressureActive && isWatchOrDirect && pressureRatio >= pressureTrigger) {
        return {
            escalated: true,
            targetMode: BlackboardMode.Blackboard,
            reason: RouteEscalationReason.ContextPressure,
        };
    }

    if (failureActive && isWatchOrDirect && input.consecutiveBlackboardFailures >= input.failureThreshold) {
        return {
            escalated: true,
            targetMode: BlackboardMode.Blackboard,
            reason: RouteEscalationReason.BlackboardFailureRetry,
        };
    }

    if (toolActive && isWatchOrDirect && toolTurns >= toolThreshold) {
        return {
            escalated: true,
            targetMode: BlackboardMode.Blackboard,
            reason: RouteEscalationReason.ToolFailureSaturation,
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
 * 给定一轮的实际 mode + blackboard 终态 + 工具失败率，返回更新后的 snapshot 计数。
 * direct → watch 清零；direct-with-watch → 增 watch；blackboard 收敛 → 全部清零。
 * 工具失败计数：本轮失败率 ≥ trigger 时 +1，否则清零（一旦本轮稳住即视为复位）。
 */
export function nextEscalationCounters(input: {
    actualMode: BlackboardMode;
    blackboardStatus?: BlackboardTurnStatusType;
    previousWatch: number;
    previousFailure: number;
    previousToolFailure?: number;
    /** 本轮 MCP 工具失败率（0..1）；无调用时传 0。 */
    toolFailureRatio?: number;
    /** 本轮工具失败计入的阈值；通常等于配置 toolFailureRatioTrigger。 */
    toolFailureRatioTrigger?: number;
}): { watch: number; failure: number; toolFailure: number } {
    const previousToolFailure = input.previousToolFailure ?? 0;
    const trigger = input.toolFailureRatioTrigger ?? 0;
    const toolFailure =
        trigger > 0 && (input.toolFailureRatio ?? 0) >= trigger ? previousToolFailure + 1 : 0;

    if (input.actualMode === BlackboardMode.Direct) {
        return { watch: 0, failure: input.previousFailure, toolFailure };
    }
    if (input.actualMode === BlackboardMode.DirectWithWatch) {
        return { watch: input.previousWatch + 1, failure: input.previousFailure, toolFailure };
    }
    if (input.blackboardStatus === BlackboardTurnStatus.Converged) {
        return { watch: 0, failure: 0, toolFailure: 0 };
    }
    if (
        input.blackboardStatus === BlackboardTurnStatus.NeedsUser ||
        input.blackboardStatus === BlackboardTurnStatus.Failed
    ) {
        return { watch: 0, failure: input.previousFailure + 1, toolFailure };
    }
    return { watch: input.previousWatch, failure: input.previousFailure, toolFailure };
}
