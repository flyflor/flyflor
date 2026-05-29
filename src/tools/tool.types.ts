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
 * Describes a first-phase object-shaped tool argument schema.
 *
 * @property type - Always `object` in v1.
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
 * Describes a runtime tool definition.
 *
 * @property name - Stable tool name exposed to the model/runtime.
 * @property description - Human-readable purpose.
 * @property schema - JSON-schema-like input contract.
 * @usage ToolRegistry lists definitions before executing tools.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSchema;
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
  readonly artifactWriter: ArtifactWriterComponent;
  readonly guardPolicy: string;
  readonly budget: {
    readonly outputChars: number;
  };
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
import type { MemoryComponent } from "../memory";
import type { ArtifactWriterComponent } from "./artifact-writer.component";
