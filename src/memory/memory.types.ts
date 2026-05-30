/**
 * Describes a canonical conversation message persisted by MemoryComponent.
 *
 * @property id - Stable message id.
 * @property role - Message role in the local conversation log.
 * @property content - Markdown or plain text message body.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage Runtime writes every no-session turn before rebuilding context.
 */
export interface MemoryMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly createdAt: number;
}

/**
 * Describes a durable memory chunk stored in `memory.db`.
 *
 * @property id - Numeric row id used by SQLite and sqlite-vec.
 * @property sourceKind - Source category such as conversation, tool, or summary.
 * @property sourceId - Source-specific id.
 * @property content - Canonical Markdown content.
 * @property importance - Ranking signal used during recall.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage Memory recall returns these chunks as provenance-backed context.
 */
export interface MemoryChunk {
  readonly id: number;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly content: string;
  readonly importance: number;
  readonly createdAt: number;
}

/**
 * Describes one memory recall item returned to ContextModule.
 *
 * @property chunk - Recalled memory chunk.
 * @property score - Combined semantic and heuristic score.
 * @usage Context builders inject these values into the memory recall section.
 */
export interface MemoryRecallResult {
  readonly chunk: MemoryChunk;
  readonly score: number;
}

/**
 * Describes a memory store request.
 *
 * @property sourceKind - Source category for provenance.
 * @property sourceId - Source-specific id.
 * @property content - Markdown content to persist.
 * @property importance - Optional ranking signal.
 * @usage Runtime, tools, and tests call `MemoryComponent.store`.
 */
export interface MemoryStoreInput {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly content: string;
  readonly importance?: number;
}

/**
 * Describes options that guide memory recall for one user question.
 *
 * @property conversationId - Optional conversation id used to prefer local continuity.
 * @property sourceKinds - Optional durable memory source kinds allowed in the result.
 * @property excludeQuestionLike - Whether question-like chunks should be filtered out.
 * @usage Context builders pass this so recall follows the question intent instead of blindly returning vector topK.
 */
export interface MemoryRecallOptions {
  readonly conversationId?: string;
  readonly sourceKinds?: readonly string[];
  readonly excludeQuestionLike?: boolean;
}

/**
 * Describes a persisted context checkpoint.
 *
 * @property id - Stable checkpoint id.
 * @property conversationId - Local conversation id summarized by the checkpoint.
 * @property summary - Anchored Markdown summary.
 * @property sourceMessageIds - Message ids that produced the summary.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage Context builders inject the latest checkpoint before recent tail messages.
 */
export interface MemoryCheckpoint {
  readonly id: string;
  readonly conversationId: string;
  readonly summary: string;
  readonly sourceMessageIds: readonly string[];
  readonly createdAt: number;
}

/**
 * Describes a checkpoint store request.
 *
 * @property conversationId - Local conversation id being summarized.
 * @property summary - Anchored Markdown summary to persist.
 * @property sourceMessageIds - Message ids used to generate the summary.
 * @usage ContextCompactTool stores deterministic summaries through this input.
 */
export interface MemoryCheckpointInput {
  readonly conversationId: string;
  readonly summary: string;
  readonly sourceMessageIds: readonly string[];
}
