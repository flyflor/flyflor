import { event, RuntimeEventType, type EventSink } from "../../events/index.ts";
import type { MetricsConfig } from "../../config/index.ts";

/**
 * 性能指标采集：所有 perf 事件的统一发布入口。
 *
 * 设计：
 *   - 关闭 metrics 时所有方法变 no-op，主链路零成本；
 *   - 每个事件都带 elapsedMs（mark→measure）便于直方图后处理；
 *   - 不在此处聚合/降采样，CLI/管理面再做窗口统计。
 */
export class PerfMetrics {
    private readonly enabled: boolean;
    private readonly events: EventSink;

    public constructor(config: MetricsConfig, events: EventSink) {
        this.enabled = config.enabled;
        this.events = events;
    }

    /**
     * 标记一个起点；返回的 measure 函数闭包记录 elapsed 并发布事件。
     * 即便 metrics disabled 也要返回可调用的 measure，避免调用方 if-else 散落。
     */
    public mark<T extends Record<string, unknown>>(
        type: PerfEventType,
        baseline: T = {} as T,
        requestId?: string,
    ): (extra?: Record<string, unknown>) => void {
        if (!this.enabled) {
            return () => {};
        }
        const start = performance.now();
        return (extra) => {
            const elapsedMs = Math.max(0, Math.round((performance.now() - start) * 1000) / 1000);
            this.events.publish(event(type, { ...baseline, ...(extra ?? {}), elapsedMs }, requestId));
        };
    }

    /** 直接发布一条已知 elapsed 的事件（适用于调用方自己 timing 的情形）。 */
    public record(type: PerfEventType, payload: Record<string, unknown>, requestId?: string): void {
        if (!this.enabled) return;
        this.events.publish(event(type, payload, requestId));
    }
}

export type PerfEventType =
    | typeof RuntimeEventType.PerfTtfb
    | typeof RuntimeEventType.PerfBuildPrompt
    | typeof RuntimeEventType.PerfRouteLlm
    | typeof RuntimeEventType.PerfFastRouteEvaluated;
