/**
 * Describes one local runtime process recorded in the monthly brain database.
 *
 * @property id - Stable runtime-session id created on process/component construction.
 * @property startedAt - Unix timestamp in milliseconds when the local runtime started.
 * @property projectRoot - Absolute project root used by this process.
 * @property metadata - JSON-safe runtime metadata such as provider and config path.
 * @usage BrainComponent writes this once so later audit rows can be grouped by local process.
 */
export interface BrainRuntimeSessionInput {
  readonly id: string;
  readonly startedAt: number;
  readonly projectRoot: string;
  readonly metadata?: BrainJsonRecord;
}

/**
 * Describes one audited agent turn.
 *
 * @property id - Runtime turn id.
 * @property runtimeSessionId - Local runtime session that owns this turn.
 * @property conversationId - Local continuity id.
 * @property status - Lifecycle state such as running, completed, failed, or interrupted.
 * @property startedAt - Unix timestamp in milliseconds when the turn started.
 * @property completedAt - Optional completion timestamp.
 * @property error - Optional failure text.
 * @property metadata - JSON-safe provider, model, and runtime metadata.
 * @usage AgentRuntimeService writes this before model work starts and updates it at terminal states.
 */
export interface BrainTurnInput {
  readonly id: string;
  readonly runtimeSessionId: string;
  readonly conversationId: string;
  readonly status: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly error?: string;
  readonly metadata?: BrainJsonRecord;
}

/**
 * Describes a visible message preserved by the biography database.
 *
 * @property id - Stable message id.
 * @property turnId - Turn that produced or consumed the message.
 * @property conversationId - Local continuity id.
 * @property role - Message role.
 * @property content - Full visible message content.
 * @property visibleReasoning - Optional provider-exposed reasoning summary; hidden chain-of-thought is never required.
 * @property createdAt - Unix timestamp in milliseconds.
 * @property metadata - JSON-safe message metadata.
 * @usage Runtime writes user, assistant, tool, and system-visible audit messages here without compression.
 */
export interface BrainMessageInput {
  readonly id: string;
  readonly turnId: string;
  readonly conversationId: string;
  readonly role: "system" | "user" | "assistant" | "tool" | "event";
  readonly content: string;
  readonly visibleReasoning?: string;
  readonly createdAt: number;
  readonly metadata?: BrainJsonRecord;
}

/**
 * Describes one event row in the brain audit stream.
 *
 * @property turnId - Optional owning turn id.
 * @property conversationId - Optional local continuity id.
 * @property type - Event type such as `tool.started` or `context.ready`.
 * @property payload - JSON-safe event payload.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage SignalBus mirroring and runtime lifecycle code store every observable event through this shape.
 */
export interface BrainEventInput {
  readonly turnId?: string;
  readonly conversationId?: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt?: number;
}

/**
 * Describes one audited tool call.
 *
 * @property id - Stable tool call id from the model or runtime.
 * @property turnId - Turn that requested the tool.
 * @property toolName - Registered tool name.
 * @property input - Tool input payload.
 * @property status - Tool lifecycle state.
 * @property output - Optional model-facing output.
 * @property artifactPath - Optional raw artifact path.
 * @property error - Optional failure text.
 * @property startedAt - Unix timestamp in milliseconds.
 * @property completedAt - Optional completion timestamp.
 * @property metadata - JSON-safe execution metadata.
 * @usage ToolRuntime and AgentRuntimeService store tool evidence here for audit and replay.
 */
export interface BrainToolCallInput {
  readonly id: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly status: string;
  readonly output?: string;
  readonly artifactPath?: string;
  readonly error?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly metadata?: BrainJsonRecord;
}

/**
 * Describes one recovery point for crash, network loss, or process restart handling.
 *
 * @property id - Stable recovery point id.
 * @property turnId - Optional owning turn id.
 * @property conversationId - Optional local continuity id.
 * @property state - Recovery state label.
 * @property payload - JSON-safe recovery payload.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage Runtime writes these before and after critical operations so recovery scan can explain last known state.
 */
export interface BrainRecoveryPointInput {
  readonly id: string;
  readonly turnId?: string;
  readonly conversationId?: string;
  readonly state: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/**
 * Describes the startup recovery report produced from brain and memory state.
 *
 * @property interruptedTurns - Turns left running in the latest monthly brain database.
 * @property interruptedTools - Tool calls left running in the latest monthly brain database.
 * @property latestRecoveryState - Latest recovery state label when present.
 * @usage Socket debug and runtime startup events expose this report for human review.
 */
export interface BrainRecoveryReport {
  readonly interruptedTurns: readonly BrainInterruptedTurn[];
  readonly interruptedTools: readonly BrainInterruptedTool[];
  readonly latestRecoveryState?: string;
}

/**
 * Describes one interrupted turn found during recovery scanning.
 *
 * @property id - Turn id.
 * @property conversationId - Local continuity id.
 * @property startedAt - Turn start timestamp.
 * @property status - Persisted non-terminal status.
 * @usage BrainRecoveryReport lists these so runtime can mark or resume them deliberately.
 */
export interface BrainInterruptedTurn {
  readonly id: string;
  readonly conversationId: string;
  readonly startedAt: number;
  readonly status: string;
}

/**
 * Describes one interrupted tool call found during recovery scanning.
 *
 * @property id - Tool call id.
 * @property turnId - Owning turn id.
 * @property toolName - Registered tool name.
 * @property startedAt - Tool start timestamp.
 * @property status - Persisted non-terminal status.
 * @usage Recovery reports these as interrupted rather than silently retrying side effects.
 */
export interface BrainInterruptedTool {
  readonly id: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly startedAt: number;
  readonly status: string;
}

/**
 * Describes JSON-safe metadata stored in brain tables.
 *
 * @usage Public brain inputs accept this for caller-controlled metadata while payload fields may store unknown values.
 */
export interface BrainJsonRecord {
  readonly [key: string]: string | number | boolean | null | readonly BrainJsonRecord[] | BrainJsonRecord;
}
