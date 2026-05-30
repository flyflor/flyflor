import type { MemoryCheckpoint, MemoryMessage, MemoryRecallResult } from "../memory";

/**
 * Describes one model-facing context message.
 *
 * @property role - Model message role used by the provider adapter.
 * @property content - Text content assembled from templates, prompts, memory, or conversation tail.
 * @usage ContextBuilderService returns these messages for AgentRuntimeService.
 */
export interface ContextMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

/**
 * Describes a request to build one no-session model context.
 *
 * @property conversationId - Local continuity id used to read recent messages and checkpoints.
 * @property userInput - Current user text for memory recall and final model input.
 * @property runtimeState - Optional runtime status injected before conversation tail.
 * @property excludeMessageId - Optional message id to omit from recent tail when it is also the current user input.
 * @usage AgentRuntimeService creates this input for every user turn.
 */
export interface ContextBuildInput {
  readonly conversationId: string;
  readonly userInput: string;
  readonly runtimeState?: string;
  readonly excludeMessageId?: string;
}

/**
 * Describes a completed model context.
 *
 * @property messages - Stable ordered messages passed to the model provider.
 * @property recall - Memory recall items injected into the context.
 * @property checkpoint - Latest persisted context checkpoint when available.
 * @property recentMessages - Recent local conversation messages preserved verbatim.
 * @property estimatedChars - Approximate character budget used by the context.
 * @usage Runtime uses this object for provider calls and diagnostic socket events.
 */
export interface ContextBuildResult {
  readonly messages: readonly ContextMessage[];
  readonly recall: readonly MemoryRecallResult[];
  readonly checkpoint?: MemoryCheckpoint;
  readonly recentMessages: readonly MemoryMessage[];
  readonly estimatedChars: number;
}

/**
 * Describes a summary checkpoint produced from older context.
 *
 * @property conversationId - Local continuity id summarized by the checkpoint.
 * @property summary - Anchored Markdown summary.
 * @property sourceMessageIds - Message ids used to produce the summary.
 * @usage Future compaction jobs will persist this shape into `context_checkpoints`.
 */
export interface ContextCheckpoint {
  readonly conversationId: string;
  readonly summary: string;
  readonly sourceMessageIds: readonly string[];
}
