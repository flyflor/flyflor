import { CttlLoopGuardReason } from "../protocol/contracts/index.ts";
import type {
    CttlJsonObject,
    CttlLoopGuardDecision,
    CttlLoopGuardEvent,
    CttlLoopGuardOptions,
    CttlLoopGuardSnapshot,
} from "./types.ts";

const DEFAULT_MAX_CALLS = 16;
const DEFAULT_MAX_UNKNOWN_TOOL_REPEATS = 2;
const DEFAULT_MAX_REPEATED_CALLS = 3;
const DEFAULT_MAX_FAILED_CALL_REPEATS = 2;

export class CttlLoopGuard {
    private totalCalls = 0;
    private readonly unknownToolCounts = new Map<string, number>();
    private readonly callRepeatCounts = new Map<string, number>();
    private readonly failedCallRepeatCounts = new Map<string, number>();
    private readonly options: Required<CttlLoopGuardOptions>;

    public constructor(options: CttlLoopGuardOptions = {}) {
        this.options = {
            maxCalls: options.maxCalls ?? DEFAULT_MAX_CALLS,
            maxFailedCallRepeats: options.maxFailedCallRepeats ?? DEFAULT_MAX_FAILED_CALL_REPEATS,
            maxRepeatedCalls: options.maxRepeatedCalls ?? DEFAULT_MAX_REPEATED_CALLS,
            maxUnknownToolRepeats: options.maxUnknownToolRepeats ?? DEFAULT_MAX_UNKNOWN_TOOL_REPEATS,
        };
    }

    public inspect(event: CttlLoopGuardEvent): CttlLoopGuardDecision {
        this.totalCalls += 1;
        if (this.totalCalls > this.options.maxCalls) {
            return {
                allow: false,
                message: `CTTL loop stopped after ${this.options.maxCalls} tool calls.`,
                reason: CttlLoopGuardReason.MaxCallsExceeded,
            };
        }
        if (event.knownToolNames && !event.knownToolNames.has(event.toolName)) {
            return this.recordUnknownTool(event.toolName);
        }
        const callKey = this.callKey(event.toolName, event.input);
        const repeated = this.increment(this.callRepeatCounts, callKey);
        if (repeated > this.options.maxRepeatedCalls) {
            return {
                allow: false,
                message: `CTTL loop stopped repeated call ${event.toolName}.`,
                reason: CttlLoopGuardReason.RepeatedCallNoProgress,
            };
        }
        if (event.ok === false) {
            const failed = this.increment(this.failedCallRepeatCounts, callKey);
            if (failed > this.options.maxFailedCallRepeats) {
                return {
                    allow: false,
                    message: `CTTL loop stopped repeated failed call ${event.toolName}.`,
                    reason: CttlLoopGuardReason.FailedCallRepeat,
                };
            }
        }
        return { allow: true };
    }

    public snapshot(): CttlLoopGuardSnapshot {
        return {
            callRepeatCounts: Object.fromEntries(this.callRepeatCounts),
            failedCallRepeatCounts: Object.fromEntries(this.failedCallRepeatCounts),
            totalCalls: this.totalCalls,
            unknownToolCounts: Object.fromEntries(this.unknownToolCounts),
        };
    }

    public reset(): void {
        this.totalCalls = 0;
        this.unknownToolCounts.clear();
        this.callRepeatCounts.clear();
        this.failedCallRepeatCounts.clear();
    }

    private recordUnknownTool(toolName: string): CttlLoopGuardDecision {
        const count = this.increment(this.unknownToolCounts, toolName);
        if (count > this.options.maxUnknownToolRepeats) {
            return {
                allow: false,
                message: `CTTL loop stopped repeated unknown tool ${toolName}.`,
                reason: CttlLoopGuardReason.UnknownToolRepeat,
            };
        }
        return { allow: true };
    }

    private increment(map: Map<string, number>, key: string): number {
        const next = (map.get(key) ?? 0) + 1;
        map.set(key, next);
        return next;
    }

    private callKey(toolName: string, input: CttlJsonObject | undefined): string {
        return `${toolName}:${stableJson(input ?? {})}`;
    }
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(",")}}`;
}

