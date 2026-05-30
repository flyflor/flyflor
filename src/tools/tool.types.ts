import type { BrainComponent } from "../brain";
import type { MemoryComponent } from "../memory";
import type { ArtifactWriterComponent } from "./artifact.writer.component";

/**
 * Describes JSON-like data exchanged through tool schemas and metadata.
 *
 * @usage Tool schemas use this instead of accepting arbitrary class instances.
 */
export type ToolJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ToolJsonValue[]
  | { readonly [key: string]: ToolJsonValue };

/**
 * Describes one JSON-schema-like property accepted by a tool.
 *
 * @property type - Primitive or container type accepted for the field.
 * @property description - Human-readable field purpose.
 * @property enum - Optional string enum accepted by the field.
 * @property items - Schema used when the property is an array.
 * @property properties - Nested object fields.
 * @property required - Required nested fields.
 * @property default - Optional default value.
 * @usage Tool definitions expose this to model providers and future validators.
 */
export interface ToolParameterSchema {
  readonly type: "string" | "number" | "boolean" | "array" | "object";
  readonly description: string;
  readonly enum?: readonly string[];
  readonly items?: ToolParameterSchema;
  readonly properties?: Readonly<Record<string, ToolParameterSchema>>;
  readonly required?: readonly string[];
  readonly default?: ToolJsonValue;
}

/**
 * Describes an object-shaped tool argument schema.
 *
 * @property type - Always `object`.
 * @property properties - Top-level tool input fields.
 * @property required - Required top-level fields.
 * @property additionalProperties - Whether unknown fields are accepted.
 * @usage ToolRegistry lists this schema for model-visible tool descriptions.
 */
export interface ToolSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolParameterSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/**
 * Describes whether a tool can be scheduled with other tool calls.
 *
 * @property mutability - Whether the tool only reads state or may mutate project/runtime state.
 * @property concurrency - Whether the orchestrator may run calls of this tool concurrently.
 * @usage ToolRegistry exposes this metadata so future tool loops keep read-only work parallel and mutating work serial.
 */
export interface ToolExecutionMetadata {
  readonly mutability: "read-only" | "mutating";
  readonly concurrency: "concurrent" | "serial";
}

/**
 * Describes a runtime tool definition.
 *
 * @property name - Stable tool name exposed to the model/runtime.
 * @property description - Human-readable purpose.
 * @property schema - JSON-schema-like input contract.
 * @property execution - Scheduling and mutation contract for the tool loop.
 * @usage ToolRegistry lists definitions before executing tools.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSchema;
  readonly execution: ToolExecutionMetadata;
}

/**
 * Describes the narrow signal interface tools need.
 *
 * @usage Keeps tools independent from the concrete SignalBus class.
 */
export interface ToolSignalPort {
  emit<TPayload = unknown>(signal: string, payload: TPayload): Promise<unknown>;
  ask<TPayload = unknown>(signal: string, payload: TPayload): Promise<boolean>;
}

/**
 * Describes execution context shared by tools.
 *
 * @property turnId - Runtime turn id that owns the tool call.
 * @property cwd - Working directory for filesystem and shell operations.
 * @property artifactDir - Directory where raw tool outputs are stored.
 * @property signalBus - Event and guard port.
 * @property memoryComponent - Memory component used by memory-aware tools.
 * @property brainComponent - Optional full-fidelity brain audit component.
 * @property artifactWriter - Artifact writer used to preserve raw outputs.
 * @property guardPolicy - Current guard behavior label, such as `auto`.
 * @property budget - Output budget for model-facing tool summaries.
 * @usage ToolModule creates this context for every tool call.
 */
export interface ToolContext {
  readonly turnId: string;
  readonly cwd: string;
  readonly artifactDir: string;
  readonly signalBus: ToolSignalPort;
  readonly memoryComponent: MemoryComponent;
  readonly brainComponent?: BrainComponent;
  readonly artifactWriter: ArtifactWriterComponent;
  readonly guardPolicy: string;
  readonly budget: {
    readonly outputChars: number;
  };
}

/**
 * Describes a runtime-visible optional plugin diagnostic.
 *
 * @property name - Stable plugin name being reported.
 * @property phase - Runtime phase that produced the diagnostic.
 * @property status - Human-readable availability or failure state.
 * @property available - Whether the optional plugin can be used directly.
 * @property turnId - Optional owning turn id for per-turn diagnostics.
 * @property conversationId - Optional owning conversation id for socket debug.
 * @property toolName - Optional tool adapter that produced the diagnostic.
 * @property command - Optional command checked for plugin availability.
 * @property reason - Optional unavailable or failed reason.
 * @property tools - Tool names contributed by the plugin manifest.
 * @usage Kernel and tool adapters emit this through `plugin.*` SignalBus events.
 */
export interface ToolPluginDiagnostic {
  readonly name: string;
  readonly phase: "startup" | "turn" | "tool";
  readonly status: "available" | "unavailable" | "failed";
  readonly available: boolean;
  readonly turnId?: string;
  readonly conversationId?: string;
  readonly toolName?: string;
  readonly command?: string;
  readonly reason?: string;
  readonly tools?: readonly string[];
}

/**
 * Describes RTK command resolution without depending on installer internals.
 *
 * @property available - Whether a project-local RTK executable was found.
 * @property command - Absolute executable path when available.
 * @property reason - Diagnostic reason when resolution is unavailable or rejected.
 * @property configuredCommand - Command value read from local config.
 * @property checkedCandidates - Project-local executable paths inspected by the resolver.
 * @usage Tool adapters include this in unavailable or failed metadata.
 */
export interface RtkResolutionDiagnostic {
  readonly available: boolean;
  readonly command?: string;
  readonly reason?: string;
  readonly configuredCommand: string;
  readonly checkedCandidates: readonly string[];
}

/**
 * Describes one command output that may be filtered by RTK.
 *
 * @property command - Human-readable command label for diagnostics.
 * @property raw - Full raw command output.
 * @property rawArtifactPath - Artifact path preserving the raw command output.
 * @property eligible - Whether this command family should use RTK when available.
 * @usage ShellTool and GitTool pass this to the project-local RTK adapter after preserving raw output.
 */
export interface RtkFilterInput {
  readonly command: string;
  readonly raw: string;
  readonly rawArtifactPath: string;
  readonly eligible: boolean;
}

/**
 * Describes model-facing command output after optional RTK filtering.
 *
 * @property output - Bounded model-facing command output.
 * @property metadata - JSON-safe diagnostics for compression, plugin failures, and raw artifact drill-down.
 * @usage Tool results merge this metadata into their own execution metadata.
 */
export interface RtkFilterResult {
  readonly ok: boolean;
  readonly output: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Describes a structured tool execution result.
 *
 * @property ok - Whether execution succeeded.
 * @property output - Model-facing output, usually truncated or compressed.
 * @property artifactPath - Optional raw artifact path.
 * @property metadata - Tool-specific metadata.
 * @usage Runtime injects this result into the model and broadcasts it to socket clients.
 */
export interface ToolResult {
  readonly ok: boolean;
  readonly output: string;
  readonly artifactPath?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Represents a project tool.
 *
 * @typeParam TInput - Tool input shape.
 * @param input - Structured tool input.
 * @param context - Execution context with cwd, artifacts, and signals.
 * @returns Structured result for runtime and model context.
 * @usage Register implementations with `ToolRegistry`.
 */
export interface Tool<TInput = unknown> extends ToolDefinition {
  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}

/**
 * Describes one edit used by MultiEditTool.
 *
 * @property filePath - Project-relative or cwd-relative target file path.
 * @property oldText - Exact text expected in the file.
 * @property newText - Replacement text.
 * @usage MultiEditTool dry-runs all edits before writing any file.
 */
export interface MultiEditOperation {
  readonly filePath: string;
  readonly oldText: string;
  readonly newText: string;
}

/**
 * Describes input accepted by TaskTool for visible workmux child work.
 *
 * @property description - Short human-readable lane description.
 * @property prompt - Child Codex prompt or work assignment.
 * @property laneName - Optional explicit lane name.
 * @property branch - Optional git branch name for the child worktree.
 * @property ownedFiles - File globs the child is allowed to edit.
 * @property forbiddenFiles - File globs the child must not edit.
 * @property validationCommands - Commands the child should run before handoff.
 * @property handoffConditions - Conditions required before the coordinator reviews the lane.
 * @usage TaskTool converts this into a visible workmux request instead of spawning hidden background work.
 */
export interface TaskToolInput {
  readonly description: string;
  readonly prompt: string;
  readonly laneName?: string;
  readonly branch?: string;
  readonly ownedFiles?: readonly string[];
  readonly forbiddenFiles?: readonly string[];
  readonly validationCommands?: readonly string[];
  readonly handoffConditions?: readonly string[];
}

/**
 * Describes a visible workmux task request emitted by TaskTool.
 *
 * @property description - Short task description.
 * @property prompt - Child Codex prompt or work assignment.
 * @property laneName - Normalized lane name.
 * @property worktreePath - Project-relative worktree path.
 * @property branch - Suggested branch name.
 * @property launchMode - Required launch mode; current value is visible-cmux.
 * @property spawned - Whether TaskTool directly spawned the process.
 * @property ownedFiles - File globs owned by the requested lane.
 * @property forbiddenFiles - File globs forbidden to the requested lane.
 * @property validationCommands - Commands expected before handoff.
 * @property handoffConditions - Handoff requirements for coordinator review.
 * @usage A future coordinator subscriber can consume this request and launch cmux visibly.
 */
export interface WorkmuxTaskRequest {
  readonly description: string;
  readonly prompt: string;
  readonly laneName: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly launchMode: "visible-cmux";
  readonly spawned: false;
  readonly ownedFiles: readonly string[];
  readonly forbiddenFiles: readonly string[];
  readonly validationCommands: readonly string[];
  readonly handoffConditions: readonly string[];
}
