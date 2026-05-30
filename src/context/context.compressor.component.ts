import { Component } from "../di";
import type { MemoryMessage } from "../memory";
import type { ContextCheckpoint, ContextMessage } from "./context.types";

/**
 * Produces anchored summaries for older conversation tails.
 *
 * @usage Runtime uses this for deterministic checkpoint text; model distillation can replace internals behind the same contract.
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
  public compact(conversationId: string, messages: readonly MemoryMessage[], reason = "manual"): ContextCheckpoint {
    const sourceMessageIds = messages.map((message) => message.id);
    const summary = this.renderSummary(reason, messages.map((message) => ({
      role: message.role,
      content: message.content,
      sourceId: message.id,
    })));
    return {
      conversationId,
      summary: summary || "- No messages to summarize.",
      sourceMessageIds,
    };
  }

  /**
   * Creates a compact checkpoint from model-facing messages.
   *
   * @param conversationId - Local continuity id being summarized.
   * @param messages - Model-facing messages selected for compaction.
   * @param sourceMessageIds - Stable synthetic ids for the summarized messages.
   * @param reason - Runtime reason for the compaction event.
   * @returns Checkpoint containing Markdown summary and source ids.
   * @usage Mid-turn budget guards compact transient tool-loop context through this method.
   */
  public compactContextMessages(
    conversationId: string,
    messages: readonly ContextMessage[],
    sourceMessageIds: readonly string[],
    reason: string,
  ): ContextCheckpoint {
    const summary = this.renderSummary(reason, messages.map((message, index) => ({
      role: message.role,
      content: message.content,
      sourceId: sourceMessageIds[index] ?? `context:${index}`,
    })));
    return {
      conversationId,
      summary: summary || "- No messages to summarize.",
      sourceMessageIds,
    };
  }

  /**
   * Renders a stable compaction summary with protected anchors.
   *
   * @param reason - Runtime reason for compaction.
   * @param entries - Messages or model context entries selected for compaction.
   * @returns Markdown checkpoint summary.
   * @usage Keeps tool boundaries and important coding anchors visible after compaction.
   */
  private renderSummary(reason: string, entries: readonly SummaryEntry[]): string {
    if (entries.length === 0) {
      return `reason=${reason}\n- No messages to summarize.`;
    }
    return [
      `reason=${reason}`,
      ...entries.map((entry) => [
        `- source=${entry.sourceId} role=${entry.role}`,
        `  excerpt=${entry.content.replace(/\s+/g, " ").slice(0, 360)}`,
        `  anchors=${this.extractAnchors(entry.content).join(", ") || "none"}`,
      ].join("\n")),
    ].join("\n");
  }

  /**
   * Extracts coding and audit anchors that must survive compaction.
   *
   * @param content - Message or tool result text.
   * @returns Ordered unique anchors.
   * @usage Summaries preserve paths, symbols, requirements, decisions, tasks, conflicts, artifacts, and tool ids.
   */
  private extractAnchors(content: string): readonly string[] {
    const anchors = [
      ...content.matchAll(/\btool_call_id=[^\s]+/g),
      ...content.matchAll(/\btool=[^\s]+/g),
      ...content.matchAll(/\bstatus=(?:ok|failed)\b/g),
      ...content.matchAll(/(?:artifactPath|artifact|path)=\S+/g),
      ...content.matchAll(/(?:\/|\.\/|\.\.\/)?(?:src|app|lib|packages|components|pages|tests|test|config|prompts|sql|\.config)\/[a-zA-Z0-9_./@-]+/g),
      ...content.matchAll(/\b[A-Z][A-Za-z0-9_]*(?:Component|Service|Tool|Provider|Module|Repository|Repo|Interface|Enum|Type)\b/g),
      ...content.matchAll(/\b(?:must|requirement|decision|task|todo|conflict|必须|需求|决定|任务|冲突)[^.\n。]{0,120}/gi),
      ...content.matchAll(/\b[a-f0-9]{8}-[a-f0-9-]{12,}\b/gi),
      ...content.matchAll(/https?:\/\/[^\s)]+/g),
      ...content.matchAll(/\b(?:port|端口)\s*[:=]?\s*\d{2,5}\b/gi),
    ].map((match) => match[0]);
    return [...new Set(anchors)].slice(0, 24);
  }
}

/**
 * Describes one message-like entry selected for summary rendering.
 *
 * @property role - Original message role.
 * @property content - Full text content used for anchor extraction.
 * @property sourceId - Stable source id included in checkpoint output.
 * @usage Internal helper shape shared by memory and model-message compaction.
 */
interface SummaryEntry {
  readonly role: string;
  readonly content: string;
  readonly sourceId: string;
}
