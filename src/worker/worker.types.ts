import type { ContextMessage, ToolVisibilityGroup } from "../context";
import type { ToolExecutionMetadata, ToolResult } from "../tools";

/**
 * Describes a request to spawn a worker agent.
 *
 * @property workerId - Unique worker run id.
 * @property agentProfile - Registered agent profile name.
 * @property prompt - Task description for the worker.
 * @property parentTurnId - Parent turn that spawned this worker.
 * @property parentConversationId - Parent conversation for audit continuity.
 * @usage Emitted as `worker.spawn` signal payload.
 */
export interface WorkerSpawnPayload {
  readonly workerId: string;
  readonly agentProfile: string;
  readonly prompt: string;
  readonly parentTurnId: string;
  readonly parentConversationId: string;
  readonly background?: boolean;
}

/**
 * Describes one worker execution step.
 *
 * @property stepNumber - One-based step index.
 * @property toolCall - Tool name and input used in this step.
 * @property result - Tool execution result.
 * @usage Emitted as `worker.step` signal payload.
 */
export interface WorkerStepPayload {
  readonly workerId: string;
  readonly stepNumber: number;
  readonly toolCall: { readonly name: string; readonly input: unknown };
  readonly result: ToolResult;
}

/**
 * Describes a completed worker execution.
 *
 * @property workerId - Worker run id.
 * @property agentProfile - Agent profile used.
 * @property summary - Final worker output summary.
 * @property toolResults - Tool results produced during execution.
 * @property stepsUsed - Number of tool-calling steps executed.
 * @property completedAt - Unix timestamp in milliseconds.
 * @usage Emitted as `worker.completed` signal payload.
 */
export interface WorkerCompletedPayload {
  readonly workerId: string;
  readonly agentProfile: string;
  readonly summary: string;
  readonly toolResults: readonly ToolResult[];
  readonly stepsUsed: number;
  readonly completedAt: number;
}

/**
 * Describes a failed worker execution.
 *
 * @property workerId - Worker run id.
 * @property error - Human-readable failure message.
 * @property failedAt - Unix timestamp in milliseconds.
 * @usage Emitted as `worker.failed` signal payload.
 */
export interface WorkerFailedPayload {
  readonly workerId: string;
  readonly error: string;
  readonly failedAt: number;
}

/**
 * Describes the terminal worker result used by foreground spawns.
 *
 * @property workerId - Worker run id.
 * @property status - Terminal worker state.
 * @property summary - Completed worker summary when successful.
 * @property error - Failure message when unsuccessful.
 * @property settledAt - Unix timestamp in milliseconds.
 * @usage Emitted as `worker.settled` after `worker.completed` or `worker.failed`.
 */
export interface WorkerSettledPayload {
  readonly workerId: string;
  readonly status: "completed" | "failed";
  readonly summary?: string;
  readonly error?: string;
  readonly settledAt: number;
}

/**
 * Describes a queued worker waiting for capacity.
 *
 * @property workerId - Worker run id.
 * @property position - Queue position (1-based).
 * @usage Emitted as `worker.queued` signal payload.
 */
export interface WorkerQueuedPayload {
  readonly workerId: string;
  readonly position: number;
}

/**
 * Describes a worker result injected into the parent turn.
 *
 * @property parentTurnId - Parent turn that spawned the worker.
 * @property workerId - Worker run id.
 * @property summary - Worker output summary visible to the parent model.
 * @usage Emitted as `worker.result.injected` signal payload.
 */
export interface WorkerResultInjectedPayload {
  readonly parentTurnId: string;
  readonly workerId: string;
  readonly summary: string;
}

/**
 * Describes an active or in-progress worker record tracked by WorkerService.
 *
 * @property workerId - Worker run id.
 * @property profileName - Agent profile used.
 * @property status - Current worker status.
 * @property startedAt - Unix timestamp in milliseconds.
 * @usage Internal tracking; not emitted as a signal.
 */
export interface WorkerRecord {
  readonly workerId: string;
  readonly profileName: string;
  readonly status: "running" | "queued" | "completed" | "failed";
  readonly startedAt: number;
}

/**
 * Describes the context injected into a worker before its model loop starts.
 *
 * @property systemPrompt - Resolved agent system prompt.
 * @property toolDefinitions - Tool definitions visible to the worker.
 * @property messages - Initial model-facing messages.
 * @property maxSteps - Maximum tool-calling steps.
 * @usage WorkerService builds this context from the agent profile.
 */
export interface WorkerRunContext {
  readonly systemPrompt: string;
  readonly toolDefinitions: readonly WorkerToolDefinition[];
  readonly messages: readonly ContextMessage[];
  readonly maxSteps: number;
}

/**
 * Describes a simplified tool definition for worker visibility.
 *
 * @property name - Tool name.
 * @property description - Tool purpose.
 * @property schema - JSON-schema-like input contract.
 * @usage A subset of ToolDefinition used for worker profile resolution.
 */
export interface WorkerToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
  readonly execution: ToolExecutionMetadata;
}
