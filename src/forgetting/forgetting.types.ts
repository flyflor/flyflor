/**
 * Describes the trigger source for a forgetting cycle.
 *
 * @usage Emitted as `forgetting.cycle.started` signal payload.
 */
export type ForgettingTrigger = "timer" | "compaction" | "recovery";

/**
 * Describes a forgetting cycle start event.
 *
 * @property cycleId - Unique cycle id.
 * @property triggeredBy - What triggered this cycle.
 * @property startedAt - Unix timestamp in milliseconds.
 * @usage Emitted as `forgetting.cycle.started` signal payload.
 */
export interface ForgettingCycleStarted {
  readonly cycleId: string;
  readonly triggeredBy: ForgettingTrigger;
  readonly startedAt: number;
}

/**
 * Describes a chunk compaction result.
 *
 * @property chunkId - Original chunk id.
 * @property originalLength - Original content character count.
 * @property compactedLength - Compressed content character count.
 * @property summary - LLM-generated summary that replaces the original.
 * @usage Emitted as `forgetting.chunk.compacted` signal payload.
 */
export interface ForgettingChunkCompacted {
  readonly chunkId: number;
  readonly originalLength: number;
  readonly compactedLength: number;
  readonly summary: string;
}

/**
 * Describes a chunk importance decay result.
 *
 * @property chunkId - Chunk id.
 * @property previousImportance - Importance before decay.
 * @property newImportance - Importance after decay.
 * @property ageHours - Chunk age in hours.
 * @usage Emitted as `forgetting.chunk.faded` signal payload.
 */
export interface ForgettingChunkFaded {
  readonly chunkId: number;
  readonly previousImportance: number;
  readonly newImportance: number;
  readonly ageHours: number;
}

/**
 * Describes a fact confidence decay result.
 *
 * @property factId - Fact id.
 * @property previousConfidence - Confidence before decay.
 * @property newConfidence - Confidence after decay.
 * @property ageHours - Fact age in hours.
 * @usage Emitted as `forgetting.fact.aged` signal payload.
 */
export interface ForgettingFactAged {
  readonly factId: string;
  readonly previousConfidence: number;
  readonly newConfidence: number;
  readonly ageHours: number;
}

/**
 * Describes a Gem drift result.
 *
 * @property gemId - Gem id.
 * @property gemName - Gem name.
 * @property previousSummary - Summary before drift.
 * @property newSummary - Summary after LLM-applied drift.
 * @usage Emitted as `forgetting.gem.drifted` signal payload.
 */
export interface ForgettingGemDrifted {
  readonly gemId: string;
  readonly gemName: string;
  readonly previousSummary: string;
  readonly newSummary: string;
}

/**
 * Describes forgetting cycle completion statistics.
 *
 * @property cycleId - Cycle id.
 * @property chunksCompacted - Number of chunks compacted.
 * @property chunksFaded - Number of chunks with decayed importance.
 * @property factsAged - Number of facts with aged confidence.
 * @property gemsDrifted - Number of gems that underwent semantic drift.
 * @property elapsedMs - Total cycle duration in milliseconds.
 * @usage Emitted as `forgetting.cycle.completed` signal payload.
 */
export interface ForgettingCycleCompleted {
  readonly cycleId: string;
  readonly chunksCompacted: number;
  readonly chunksFaded: number;
  readonly factsAged: number;
  readonly gemsDrifted: number;
  readonly elapsedMs: number;
}
