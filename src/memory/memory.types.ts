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
