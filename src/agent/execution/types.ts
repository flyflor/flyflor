import type { ToolCall, ToolResult } from '@/tools';

/**
 * Enumerable exit reasons — every loop termination carries exactly one.
 * `Final` is the model's natural end (plain assistant text with no tool calls).
 * `Ask` / `Confirm` are terminal tool exits that hand the turn back to the user.
 * `MaxIterations` / `ParseFailure` / `Error` are budget and fault exits.
 */
export type ExecutionReason = 'final' | 'ask' | 'confirm' | 'max-iterations' | 'parse-failure' | 'error';

/**
 * One tool call that was actually executed and recorded.
 * The pairing invariant (every call → result) is the registry's contract, not the loop's.
 */
export interface ExecutedToolCall {
    name: string;
    input: Record<string, unknown>;
    ok: boolean;
    result: string;
}

/**
 * The typed result of one execution run — the agent branches on `ok` and `reason`.
 * `toolCalls` carries the full execution trace for diagnostics.
 */
export interface ExecutionResult {
    ok: boolean;
    text: string;
    reason: ExecutionReason;
    toolCalls: ExecutedToolCall[];
}

/**
 * Observability signals emitted while the execution loop runs.
 */
export type ExecutionSignal =
    | { type: 'start'; brief: string }
    | { type: 'sample'; messages: unknown[] }
    | { type: 'parse'; message: unknown }
    | { type: 'tool'; calls: ToolCall[] }
    | { type: 'result'; record: ToolResult }
    | { type: 'done'; result: ExecutionResult };
