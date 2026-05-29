import { Component } from "../di";
import type { MemoryMessage } from "../memory";
import type { ContextCheckpoint } from "./context.types";

/**
 * Produces anchored summaries for older conversation tails.
 *
 * @usage V1 uses this for deterministic checkpoint text; future versions can replace internals with model distillation.
 */
@Component()
export class ContextCompressorComponent {
  /**
   * Creates a compact checkpoint from local messages.
   *
   * @param conversationId - Local continuity id being summarized.
   * @param messages - Messages selected for compaction.
   * @returns Checkpoint containing Markdown summary and source message ids.
   * @usage Context compaction tools and future memory jobs persist this result.
   */
  public compact(conversationId: string, messages: readonly MemoryMessage[]): ContextCheckpoint {
    const sourceMessageIds = messages.map((message) => message.id);
    const summary = messages
      .map((message) => `- ${message.role}: ${message.content.slice(0, 240)}`)
      .join("\n");
    return {
      conversationId,
      summary: summary || "- No messages to summarize.",
      sourceMessageIds,
    };
  }
}
