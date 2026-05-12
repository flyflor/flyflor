import { describe, expect, test } from "bun:test";
import { BlackboardMode, BlackboardTurnStatus } from "../src/protocol/contracts/index.ts";
import {
    decideRouteEscalation,
    nextEscalationCounters,
    RouteEscalationReason,
} from "../src/agent/runtime/route.escalation.ts";

describe("decideRouteEscalation", () => {
    test("watch 计数未到阈值时不升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.DirectWithWatch,
            consecutiveWatchTurns: 2,
            consecutiveBlackboardFailures: 0,
            watchThreshold: 3,
            failureThreshold: 2,
        });
        expect(r.escalated).toBe(false);
        expect(r.reason).toBe(RouteEscalationReason.None);
        expect(r.targetMode).toBe(BlackboardMode.DirectWithWatch);
    });

    test("watch 计数等于阈值升级到 blackboard", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.DirectWithWatch,
            consecutiveWatchTurns: 3,
            consecutiveBlackboardFailures: 0,
            watchThreshold: 3,
            failureThreshold: 2,
        });
        expect(r.escalated).toBe(true);
        expect(r.targetMode).toBe(BlackboardMode.Blackboard);
        expect(r.reason).toBe(RouteEscalationReason.WatchSaturation);
    });

    test("阈值为 0 时禁用 watch 升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.DirectWithWatch,
            consecutiveWatchTurns: 999,
            consecutiveBlackboardFailures: 0,
            watchThreshold: 0,
            failureThreshold: 2,
        });
        expect(r.escalated).toBe(false);
    });

    test("黑板失败累积到阈值，direct 模式也强制升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Direct,
            consecutiveWatchTurns: 0,
            consecutiveBlackboardFailures: 2,
            watchThreshold: 3,
            failureThreshold: 2,
        });
        expect(r.escalated).toBe(true);
        expect(r.targetMode).toBe(BlackboardMode.Blackboard);
        expect(r.reason).toBe(RouteEscalationReason.BlackboardFailureRetry);
    });

    test("失败优先于 watch（同时满足时给出 failure 原因）", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.DirectWithWatch,
            consecutiveWatchTurns: 5,
            consecutiveBlackboardFailures: 5,
            watchThreshold: 3,
            failureThreshold: 2,
        });
        expect(r.escalated).toBe(true);
        expect(r.reason).toBe(RouteEscalationReason.BlackboardFailureRetry);
    });

    test("blackboard 当前模式不再升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Blackboard,
            consecutiveWatchTurns: 999,
            consecutiveBlackboardFailures: 999,
            watchThreshold: 3,
            failureThreshold: 2,
        });
        expect(r.escalated).toBe(false);
    });
});

describe("nextEscalationCounters", () => {
    test("direct 清零 watch，保留 failure", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Direct,
            previousWatch: 5,
            previousFailure: 2,
        });
        expect(c).toEqual({ watch: 0, failure: 2, toolFailure: 0 });
    });

    test("direct-with-watch 自增 watch", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.DirectWithWatch,
            previousWatch: 1,
            previousFailure: 0,
        });
        expect(c).toEqual({ watch: 2, failure: 0, toolFailure: 0 });
    });

    test("blackboard converged 全部清零", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Blackboard,
            blackboardStatus: BlackboardTurnStatus.Converged,
            previousWatch: 9,
            previousFailure: 9,
        });
        expect(c).toEqual({ watch: 0, failure: 0, toolFailure: 0 });
    });

    test("blackboard needs-user 累计 failure", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Blackboard,
            blackboardStatus: BlackboardTurnStatus.NeedsUser,
            previousWatch: 0,
            previousFailure: 1,
        });
        expect(c).toEqual({ watch: 0, failure: 2, toolFailure: 0 });
    });

    test("blackboard failed 累计 failure", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Blackboard,
            blackboardStatus: BlackboardTurnStatus.Failed,
            previousWatch: 0,
            previousFailure: 0,
        });
        expect(c).toEqual({ watch: 0, failure: 1, toolFailure: 0 });
    });

    test("blackboard running 不动计数", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Blackboard,
            blackboardStatus: BlackboardTurnStatus.Running,
            previousWatch: 3,
            previousFailure: 1,
        });
        expect(c).toEqual({ watch: 3, failure: 1, toolFailure: 0 });
    });
});

describe("decideRouteEscalation – semantic signals", () => {
    test("工具失败累积到阈值，direct 模式强制升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Direct,
            consecutiveWatchTurns: 0,
            consecutiveBlackboardFailures: 0,
            consecutiveToolFailureTurns: 2,
            watchThreshold: 3,
            failureThreshold: 2,
            toolFailureThreshold: 2,
        });
        expect(r.escalated).toBe(true);
        expect(r.reason).toBe(RouteEscalationReason.ToolFailureSaturation);
    });

    test("toolFailureThreshold=0 禁用工具失败升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Direct,
            consecutiveWatchTurns: 0,
            consecutiveBlackboardFailures: 0,
            consecutiveToolFailureTurns: 99,
            watchThreshold: 3,
            failureThreshold: 2,
            toolFailureThreshold: 0,
        });
        expect(r.escalated).toBe(false);
    });

    test("contextPressureRatio ≥ trigger 立即升级（优先级高于其他信号）", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Direct,
            consecutiveWatchTurns: 0,
            consecutiveBlackboardFailures: 5,
            consecutiveToolFailureTurns: 5,
            contextPressureRatio: 1.2,
            watchThreshold: 3,
            failureThreshold: 2,
            toolFailureThreshold: 2,
            contextPressureTrigger: 1,
        });
        expect(r.escalated).toBe(true);
        expect(r.reason).toBe(RouteEscalationReason.ContextPressure);
    });

    test("contextPressureTrigger=0 禁用上下文压力升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Direct,
            consecutiveWatchTurns: 0,
            consecutiveBlackboardFailures: 0,
            contextPressureRatio: 999,
            watchThreshold: 3,
            failureThreshold: 2,
            contextPressureTrigger: 0,
        });
        expect(r.escalated).toBe(false);
    });

    test("blackboard 当前模式工具失败也不再升级", () => {
        const r = decideRouteEscalation({
            currentMode: BlackboardMode.Blackboard,
            consecutiveWatchTurns: 0,
            consecutiveBlackboardFailures: 0,
            consecutiveToolFailureTurns: 999,
            contextPressureRatio: 999,
            watchThreshold: 3,
            failureThreshold: 2,
            toolFailureThreshold: 2,
            contextPressureTrigger: 1,
        });
        expect(r.escalated).toBe(false);
    });
});

describe("nextEscalationCounters – tool failure", () => {
    test("本轮工具失败率 ≥ trigger 累加 toolFailure", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Direct,
            previousWatch: 0,
            previousFailure: 0,
            previousToolFailure: 1,
            toolFailureRatio: 0.6,
            toolFailureRatioTrigger: 0.5,
        });
        expect(c.toolFailure).toBe(2);
    });

    test("本轮工具稳定（失败率 < trigger）清零 toolFailure", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Direct,
            previousWatch: 0,
            previousFailure: 0,
            previousToolFailure: 5,
            toolFailureRatio: 0,
            toolFailureRatioTrigger: 0.5,
        });
        expect(c.toolFailure).toBe(0);
    });

    test("trigger=0 时 toolFailure 始终为 0", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Direct,
            previousWatch: 0,
            previousFailure: 0,
            previousToolFailure: 9,
            toolFailureRatio: 1,
            toolFailureRatioTrigger: 0,
        });
        expect(c.toolFailure).toBe(0);
    });

    test("blackboard 收敛清零 toolFailure", () => {
        const c = nextEscalationCounters({
            actualMode: BlackboardMode.Blackboard,
            blackboardStatus: BlackboardTurnStatus.Converged,
            previousWatch: 5,
            previousFailure: 5,
            previousToolFailure: 5,
            toolFailureRatio: 1,
            toolFailureRatioTrigger: 0.5,
        });
        expect(c).toEqual({ watch: 0, failure: 0, toolFailure: 0 });
    });
});
