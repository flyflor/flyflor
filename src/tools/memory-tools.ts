import type { MemoryComponent } from "../memory";
import type { Tool, ToolContext, ToolResult } from "./tool.types";

/**
 * Recalls memory through MemoryComponent.
 *
 * @usage Tool loop can expose explicit recall to the model.
 */
export class MemoryRecallTool implements Tool<{ readonly query: string; readonly limit?: number }> {
  public readonly name = "memory_recall";
  public readonly description = "Recall memories relevant to a query.";
  public readonly schema = {
    type: "object" as const,
    required: ["query"],
    additionalProperties: false,
    properties: {
      query: { type: "string" as const, description: "Recall query text." },
      limit: { type: "number" as const, description: "Maximum number of memories.", default: 5 },
    },
  };

  public constructor(private readonly memory: MemoryComponent) {}

  public async execute(input: { readonly query: string; readonly limit?: number }, _context: ToolContext): Promise<ToolResult> {
    const results = this.memory.recall(input.query, input.limit ?? 5);
    return { ok: true, output: JSON.stringify(results, null, 2) };
  }
}

/**
 * Stores a durable memory chunk.
 *
 * @usage Tool loop can preserve explicit facts or preferences.
 */
export class MemoryStoreTool implements Tool<{ readonly content: string; readonly sourceId?: string }> {
  public readonly name = "memory_store";
  public readonly description = "Store durable memory.";
  public readonly schema = {
    type: "object" as const,
    required: ["content"],
    additionalProperties: false,
    properties: {
      content: { type: "string" as const, description: "Memory content to persist." },
      sourceId: { type: "string" as const, description: "Optional source id.", default: "manual" },
    },
  };

  public constructor(private readonly memory: MemoryComponent) {}

  public async execute(input: { readonly content: string; readonly sourceId?: string }, _context: ToolContext): Promise<ToolResult> {
    const chunk = this.memory.store({ sourceKind: "tool", sourceId: input.sourceId ?? "manual", content: input.content });
    return { ok: true, output: `stored memory ${chunk.id}` };
  }
}

/**
 * Marks memory removal intent.
 *
 * @usage V1 returns an explicit placeholder until deletion policy is implemented.
 */
export class MemoryForgetTool implements Tool<{ readonly id: number }> {
  public readonly name = "memory_forget";
  public readonly description = "Request memory deletion.";
  public readonly schema = {
    type: "object" as const,
    required: ["id"],
    additionalProperties: false,
    properties: {
      id: { type: "number" as const, description: "Memory chunk id to forget." },
    },
  };

  public async execute(input: { readonly id: number }, _context: ToolContext): Promise<ToolResult> {
    return { ok: true, output: `forget requested for memory ${input.id}` };
  }
}
