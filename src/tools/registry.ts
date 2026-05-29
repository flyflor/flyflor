import type { Tool, ToolContext, ToolResult } from "./tool.types";

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
   * @usage ToolModule registers all v1 tools during startup.
   */
  public register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Lists registered tools.
   *
   * @returns Tool definitions without executable internals.
   * @usage Context builders expose this to the model.
   */
  public list(): readonly { readonly name: string; readonly description: string; readonly schema: Tool["schema"] }[] {
    return [...this.tools.values()].map((tool) => ({ name: tool.name, description: tool.description, schema: tool.schema }));
  }

  /**
   * Executes one registered tool.
   *
   * @param name - Registered tool name.
   * @param input - Structured tool input.
   * @param context - Tool execution context.
   * @returns Tool execution result.
   * @usage AgentRuntimeService uses this during tool loops.
   */
  public async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    await context.signalBus.emit("tool.call", { name, input });
    try {
      const result = await tool.execute(input, context);
      await context.signalBus.emit("tool.result", { name, result });
      return result;
    } catch (error) {
      await context.signalBus.emit("tool.error", { name, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
