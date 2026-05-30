import type { Tool, ToolContext, ToolResult } from "./tool.types";

/**
 * Represents optional RTK output compression.
 *
 * @usage ShellTool integration can use this component once RTK is installed locally.
 */
export class RTKComponent {
  /**
   * Checks whether RTK is available in PATH.
   *
   * @returns True when `rtk` can be found.
   * @usage Tests use this to report fallback behavior.
   */
  public isAvailable(): boolean {
    return Bun.spawnSync(["/bin/zsh", "-lc", "command -v rtk >/dev/null"]).exitCode === 0;
  }
}

/**
 * Queries CodeGraph or reports fallback status.
 *
 * @usage Improves exploration when `codegraph` is available; does not block core runtime.
 */
export class CodeGraphTool implements Tool<{ readonly action: "status" | "index" | "search"; readonly query?: string }> {
  public readonly name = "codegraph";
  public readonly description = "Query optional CodeGraph index status and search.";
  public readonly schema = {
    type: "object" as const,
    required: ["action"],
    additionalProperties: false,
    properties: {
      action: { type: "string" as const, description: "CodeGraph action.", enum: ["status", "index", "search"] },
      query: { type: "string" as const, description: "Optional search query." },
    },
  };

  public async execute(input: { readonly action: "status" | "index" | "search"; readonly query?: string }, context: ToolContext): Promise<ToolResult> {
    const available = Bun.spawnSync(["/bin/zsh", "-lc", "command -v codegraph >/dev/null"], { cwd: context.cwd }).exitCode === 0;
    if (!available) {
      return { ok: true, output: "codegraph unavailable; fallback to rg/glob/read", metadata: { fallback: true } };
    }
    const proc = Bun.spawnSync(["codegraph", input.action, input.query ?? ""], { cwd: context.cwd });
    return { ok: proc.exitCode === 0, output: (proc.stdout.toString() || proc.stderr.toString()).slice(0, 8000) };
  }
}

/**
 * Triggers context compaction.
 *
 * @usage Persists deterministic checkpoint summaries through MemoryComponent.
 */
export class ContextCompactTool implements Tool<{ readonly conversationId: string; readonly reason?: string; readonly limit?: number }> {
  public readonly name = "context_compact";
  public readonly description = "Request a context checkpoint compaction.";
  public readonly schema = {
    type: "object" as const,
    required: ["conversationId"],
    additionalProperties: false,
    properties: {
      conversationId: { type: "string" as const, description: "Conversation id to compact." },
      reason: { type: "string" as const, description: "Optional compaction reason." },
      limit: { type: "number" as const, description: "Maximum recent messages to summarize.", default: 20 },
    },
  };

  public async execute(input: { readonly conversationId: string; readonly reason?: string; readonly limit?: number }, context: ToolContext): Promise<ToolResult> {
    const messages = context.memoryComponent.recentMessages(input.conversationId, input.limit ?? 20);
    const summary = [
      `reason=${input.reason ?? "manual"}`,
      ...messages.map((message) => `- ${message.role}: ${message.content.slice(0, 240)}`),
    ].join("\n");
    const checkpoint = context.memoryComponent.storeCheckpoint({
      conversationId: input.conversationId,
      summary: summary || "reason=manual\n- No messages to summarize.",
      sourceMessageIds: messages.map((message) => message.id),
    });
    return {
      ok: true,
      output: `stored context checkpoint ${checkpoint.id}`,
      metadata: { checkpointId: checkpoint.id, sourceCount: checkpoint.sourceMessageIds.length },
    };
  }
}

/**
 * Requests a visible workmux child task.
 *
 * @usage V1 refuses hidden background work and points callers to cmux/workmux lanes.
 */
export class TaskTool implements Tool<{ readonly description: string; readonly prompt: string }> {
  public readonly name = "task";
  public readonly description = "Request a visible workmux child task.";
  public readonly schema = {
    type: "object" as const,
    required: ["description", "prompt"],
    additionalProperties: false,
    properties: {
      description: { type: "string" as const, description: "Short visible workmux task description." },
      prompt: { type: "string" as const, description: "Prompt to hand to the child Codex lane." },
    },
  };

  public async execute(input: { readonly description: string; readonly prompt: string }, _context: ToolContext): Promise<ToolResult> {
    return { ok: true, output: `workmux task requested: ${input.description}\n${input.prompt}` };
  }
}
