/**
 * One tool invocation requested by the model.
 * `name` addresses a registered `FTool`; `input` is the raw JSON argument object before validation.
 */
export interface ToolCall {
    name: string;
    input: Record<string, unknown>;
}

/**
 * One executed tool call paired with its recorded (already truncated) result.
 * The pairing invariant — every call carries a result — is owned by the registry, not the loop.
 */
export interface ToolResult {
    name: string;
    input: Record<string, unknown>;
    ok: boolean;
    result: string;
}

/**
 * The parsed shape of one model reply under the Flyflor execution protocol.
 *
 * `final` carries the user-facing answer and ends the loop; `tool` carries the next batch of calls;
 * `invalid` means the reply matched neither contract and the loop should feed back a correction.
 */
export type ToolProtocolMessage =
    | { type: 'final'; text: string }
    | { type: 'tool'; calls: ToolCall[] }
    | { type: 'invalid'; reason: string };
