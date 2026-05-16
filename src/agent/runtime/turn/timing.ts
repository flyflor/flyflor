/**
 * Runtime turn timing helpers.
 *
 * Keeps wall-clock formatting consistent while leaving aggregation to
 * PerfMetrics/event consumers.
 */

export function elapsed(started: number): number {
    return Number((performance.now() - started).toFixed(3));
}
