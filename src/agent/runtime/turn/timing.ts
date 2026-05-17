/**
 * Runtime turn timing helpers.
 *
 * Keeps wall-clock formatting consistent while leaving aggregation to
 * PerfMetrics/event consumers.
 */
import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";

@Component()
export class TurnTiming extends Runtime {
    public elapsed(started: number): number {
        return Number((performance.now() - started).toFixed(3));
    }
}

const defaultTurnTiming = new TurnTiming();

export function elapsed(started: number): number {
    return defaultTurnTiming.elapsed(started);
}
