import { randomUUID } from "node:crypto";
import type { Tool, ToolContext, ToolDefinition, ToolParameterSchema, ToolResult, ToolSchema } from "./tool.types";

/**
 * Registers and executes project tools.
 *
 * @usage Runtime owns a registry instance and calls `execute` for model-requested tools.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /**
   * Adds a tool implementation to the registry.
   *
   * @param tool - Tool implementation.
   * @returns This registry for chaining.
   * @usage ToolModule registers all built-in tools during startup.
   */
  public register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      return this;
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Lists registered tools.
   *
   * @returns Tool definitions without executable internals.
   * @usage Context builders expose this to the model.
   */
  public list(): readonly ToolDefinition[] {
    return [...this.tools.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        execution: tool.execution,
      }));
  }

  /**
   * Executes one registered tool.
   *
   * @param name - Registered tool name.
   * @param input - Structured tool input.
   * @param context - Tool execution context.
   * @param providerCallId - Optional model tool-call id; used as the audit/signal id so brain audit aligns with the native protocol.
   * @returns Tool execution result.
   * @usage AgentRuntimeService uses this during tool loops.
   */
  public async execute(name: string, input: unknown, context: ToolContext, providerCallId?: string): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const toolCallId = providerCallId ?? randomUUID();
    const startedAt = Date.now();
    await context.signalBus.emit("tool.call", { id: toolCallId, turnId: context.turnId, name, input });
    await context.signalBus.emit("tool.started", { id: toolCallId, turnId: context.turnId, name, input, startedAt });
    context.brainComponent?.upsertToolCall({
      id: toolCallId,
      turnId: context.turnId,
      toolName: name,
      input,
      status: "running",
      startedAt,
    });
    try {
      const validationError = this.validateInput(tool.schema, input);
      if (validationError) {
        const result = { ok: false, output: `tool input invalid: ${validationError}` };
        const completedAt = Date.now();
        context.brainComponent?.upsertToolCall({
          id: toolCallId,
          turnId: context.turnId,
          toolName: name,
          input,
          status: "failed",
          output: result.output,
          error: validationError,
          startedAt,
          completedAt,
        });
        await context.signalBus.emit("tool.result", { id: toolCallId, turnId: context.turnId, name, result });
        await context.signalBus.emit("tool.failed", { id: toolCallId, turnId: context.turnId, name, error: validationError, completedAt });
        return result;
      }
      const result = await tool.execute(input, context);
      const completedAt = Date.now();
      context.brainComponent?.upsertToolCall({
        id: toolCallId,
        turnId: context.turnId,
        toolName: name,
        input,
        status: result.ok ? "completed" : "failed",
        output: result.output,
        artifactPath: result.artifactPath,
        error: result.ok ? undefined : result.output,
        startedAt,
        completedAt,
        metadata: this.safeMetadata(result.metadata),
      });
      await context.signalBus.emit("tool.result", { id: toolCallId, turnId: context.turnId, name, result });
      await context.signalBus.emit(result.ok ? "tool.completed" : "tool.failed", {
        id: toolCallId,
        turnId: context.turnId,
        name,
        result,
        completedAt,
      });
      return result;
    } catch (error) {
      const completedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      context.brainComponent?.upsertToolCall({
        id: toolCallId,
        turnId: context.turnId,
        toolName: name,
        input,
        status: "failed",
        error: message,
        startedAt,
        completedAt,
      });
      await context.signalBus.emit("tool.error", { id: toolCallId, turnId: context.turnId, name, error: message });
      await context.signalBus.emit("tool.failed", { id: toolCallId, turnId: context.turnId, name, error: message, completedAt });
      throw error;
    }
  }

  /**
   * Validates one tool input against the tool's schema.
   *
   * @param schema - Tool schema declared by the implementation.
   * @param input - Unknown runtime input from model or inline command.
   * @returns Validation error text or undefined when valid.
   * @usage Keeps all tools behind the same lightweight validation gate.
   */
  private validateInput(schema: ToolSchema, input: unknown): string | undefined {
    if (!isPlainObject(input)) {
      return "input must be an object";
    }
    for (const key of schema.required ?? []) {
      if (!(key in input)) {
        return `missing required property ${key}`;
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(input)) {
        if (!(key in schema.properties)) {
          return `unknown property ${key}`;
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (!(key in input)) {
        continue;
      }
      const error = this.validateValue(propertySchema, input[key], key);
      if (error) {
        return error;
      }
    }
    return undefined;
  }

  /**
   * Converts arbitrary tool metadata into a JSON-safe shallow record for brain audit storage.
   *
   * @param metadata - Tool result metadata.
   * @returns JSON-safe metadata record.
   * @usage BrainComponent accepts JSON payloads; this avoids leaking complex class instances.
   */
  private safeMetadata(metadata: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
    if (!metadata) {
      return undefined;
    }
    return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        return [key, value];
      }
      return [key, JSON.stringify(value)];
    }));
  }

  /**
   * Validates one nested schema value.
   *
   * @param schema - Property schema.
   * @param value - Unknown value supplied for this property.
   * @param path - Human-readable property path.
   * @returns Validation error text or undefined when valid.
   * @usage Supports the subset of schema constructs used by current built-in tools.
   */
  private validateValue(schema: ToolParameterSchema, value: unknown, path: string): string | undefined {
    if (!matchesType(schema.type, value)) {
      return `${path} must be ${schema.type}`;
    }
    if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
      return `${path} must be one of ${schema.enum.join(", ")}`;
    }
    if (schema.type === "array" && schema.items) {
      const list = value as unknown[];
      for (let index = 0; index < list.length; index += 1) {
        const error = this.validateValue(schema.items, list[index], `${path}[${index}]`);
        if (error) {
          return error;
        }
      }
    }
    if (schema.type === "object") {
      const objectValue = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in objectValue)) {
          return `missing required property ${path}.${key}`;
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (!(key in objectValue)) {
          continue;
        }
        const error = this.validateValue(childSchema, objectValue[key], `${path}.${key}`);
        if (error) {
          return error;
        }
      }
    }
    return undefined;
  }
}

/**
 * Checks whether a value is a non-array object.
 *
 * @param value - Unknown value.
 * @returns True when value is a plain object-like record.
 * @usage Tool input validation only accepts object inputs at the top level.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks whether a value matches a tool schema primitive type.
 *
 * @param type - Schema type name.
 * @param value - Unknown value.
 * @returns True when the runtime value matches the schema type.
 * @usage Keeps ToolRegistry validation dependency-free and fast.
 */
function matchesType(type: ToolParameterSchema["type"], value: unknown): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
}
