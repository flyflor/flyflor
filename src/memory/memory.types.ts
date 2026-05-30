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
  readonly reasons?: readonly string[];
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
  readonly trace?: boolean;
}

/**
 * Describes a named node in the working memory graph.
 *
 * @property id - Numeric SQLite id.
 * @property name - Stable entity name or graph reference label.
 * @property kind - Entity category such as project, preference, file, or value.
 * @property createdAt - Unix timestamp when the entity was first written.
 * @usage Tree recall starts graph traversal from query-matched entities.
 */
export interface MemoryEntity {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly createdAt: number;
}

/**
 * Describes input used to upsert a memory graph entity.
 *
 * @property name - Stable entity name.
 * @property kind - Entity category.
 * @usage Runtime extraction and tests create graph roots through this shape.
 */
export interface MemoryEntityInput {
  readonly name: string;
  readonly kind: string;
}

/**
 * Describes a weighted edge between memory graph references.
 *
 * @property id - Numeric SQLite id.
 * @property fromRef - Source graph reference such as entity:name, fact:id, or chunk:id.
 * @property toRef - Target graph reference.
 * @property kind - Relationship label.
 * @property weight - Ranking weight used by graph-neighborhood recall.
 * @property evidence - JSON or plain-text evidence that explains the edge.
 * @property createdAt - Unix timestamp when the relation was first written.
 * @usage MemoryComponent links facts, chunks, entities, and artifacts with these relations.
 */
export interface MemoryRelation {
  readonly id: number;
  readonly fromRef: string;
  readonly toRef: string;
  readonly kind: string;
  readonly weight: number;
  readonly evidence: string;
  readonly createdAt: number;
}

/**
 * Describes input used to upsert a graph relation.
 *
 * @property fromRef - Source graph reference.
 * @property toRef - Target graph reference.
 * @property kind - Relationship label.
 * @property weight - Optional ranking weight.
 * @property evidence - Optional JSON or plain-text evidence.
 * @usage Fact and chunk APIs call this to make recall traversable.
 */
export interface MemoryRelationInput {
  readonly fromRef: string;
  readonly toRef: string;
  readonly kind: string;
  readonly weight?: number;
  readonly evidence?: string;
}

/**
 * Describes one durable fact extracted into the working memory graph.
 *
 * @property id - Stable fact id.
 * @property namespace - Memory namespace such as project, global, or user_preference.
 * @property subject - Subject being described.
 * @property predicate - Relationship or property name.
 * @property object - Object value.
 * @property confidence - Confidence score from 0 to 1.
 * @property sourceKind - Source category that produced this fact.
 * @property sourceId - Source id for audit and replay.
 * @property createdAt - Unix timestamp when the fact was first written.
 * @property updatedAt - Unix timestamp when the fact was last changed.
 * @usage MemoryComponent stores deterministic facts here so recall can distinguish evidence from raw dialogue.
 */
export interface MemoryFact {
  readonly id: string;
  readonly namespace: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence: number;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Describes input used to upsert one working-memory fact.
 *
 * @property namespace - Memory namespace where the fact belongs.
 * @property subject - Subject being described.
 * @property predicate - Relationship or property name.
 * @property object - Object value.
 * @property confidence - Optional confidence score.
 * @property sourceKind - Source category that produced the fact.
 * @property sourceId - Source id for audit and replay.
 * @usage Runtime stores model-selected project facts, preferences, and confirmed decisions through this shape.
 */
export interface MemoryFactInput {
  readonly namespace: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence?: number;
  readonly sourceKind: string;
  readonly sourceId: string;
}

/**
 * Describes a durable claim with explicit verification status.
 *
 * @property id - Stable claim id.
 * @property namespace - Memory namespace where the claim belongs.
 * @property claim - Claim text.
 * @property status - Verification status such as open, confirmed, contradicted, or stale.
 * @property evidence - JSON or plain-text evidence references.
 * @property sourceKind - Source category that produced this claim.
 * @property sourceId - Source id for audit and replay.
 * @property createdAt - Unix timestamp when the claim was first written.
 * @property updatedAt - Unix timestamp when the claim was last changed.
 * @usage Tree recall includes claims as non-fact assertions with provenance.
 */
export interface MemoryClaim {
  readonly id: string;
  readonly namespace: string;
  readonly claim: string;
  readonly status: string;
  readonly evidence: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Describes input used to upsert a durable claim.
 *
 * @property namespace - Memory namespace where the claim belongs.
 * @property claim - Claim text.
 * @property status - Verification status.
 * @property evidence - Optional JSON or plain-text evidence references.
 * @property sourceKind - Source category that produced this claim.
 * @property sourceId - Source id for audit and replay.
 * @usage Extraction code records uncertain statements through this shape.
 */
export interface MemoryClaimInput {
  readonly namespace: string;
  readonly claim: string;
  readonly status: string;
  readonly evidence?: string;
  readonly sourceKind: string;
  readonly sourceId: string;
}

/**
 * Describes a durable decision and its rationale.
 *
 * @property id - Stable decision id.
 * @property namespace - Memory namespace where the decision belongs.
 * @property decision - Decision text.
 * @property rationale - Rationale or tradeoff summary.
 * @property status - Lifecycle status such as active, superseded, or rejected.
 * @property sourceKind - Source category that produced this decision.
 * @property sourceId - Source id for audit and replay.
 * @property createdAt - Unix timestamp when the decision was first written.
 * @property updatedAt - Unix timestamp when the decision was last changed.
 * @usage Context construction can recover current architectural decisions.
 */
export interface MemoryDecision {
  readonly id: string;
  readonly namespace: string;
  readonly decision: string;
  readonly rationale: string;
  readonly status: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Describes input used to upsert a durable decision.
 *
 * @property namespace - Memory namespace where the decision belongs.
 * @property decision - Decision text.
 * @property rationale - Rationale or tradeoff summary.
 * @property status - Optional lifecycle status.
 * @property sourceKind - Source category that produced this decision.
 * @property sourceId - Source id for audit and replay.
 * @usage Runtime records explicit project decisions through this shape.
 */
export interface MemoryDecisionInput {
  readonly namespace: string;
  readonly decision: string;
  readonly rationale: string;
  readonly status?: string;
  readonly sourceKind: string;
  readonly sourceId: string;
}

/**
 * Describes a durable task tracked in working memory.
 *
 * @property id - Stable task id.
 * @property namespace - Memory namespace where the task belongs.
 * @property title - Task title.
 * @property status - Task state such as open, in_progress, blocked, or done.
 * @property evidence - JSON or plain-text evidence references.
 * @property sourceKind - Source category that produced this task.
 * @property sourceId - Source id for audit and replay.
 * @property createdAt - Unix timestamp when the task was first written.
 * @property updatedAt - Unix timestamp when the task was last changed.
 * @usage Recovery and handoff flows recall unfinished work from this table.
 */
export interface MemoryTask {
  readonly id: string;
  readonly namespace: string;
  readonly title: string;
  readonly status: string;
  readonly evidence: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Describes input used to upsert a durable task.
 *
 * @property namespace - Memory namespace where the task belongs.
 * @property title - Task title.
 * @property status - Task state.
 * @property evidence - Optional JSON or plain-text evidence references.
 * @property sourceKind - Source category that produced this task.
 * @property sourceId - Source id for audit and replay.
 * @usage Runtime records unfinished user and agent work through this shape.
 */
export interface MemoryTaskInput {
  readonly namespace: string;
  readonly title: string;
  readonly status: string;
  readonly evidence?: string;
  readonly sourceKind: string;
  readonly sourceId: string;
}

/**
 * Describes an artifact indexed by working memory.
 *
 * @property id - Stable artifact id.
 * @property kind - Artifact category such as tool-output or model-delta.
 * @property path - Project-relative or profile-relative artifact path.
 * @property sourceKind - Source category that produced this artifact.
 * @property sourceId - Source id for audit and replay.
 * @property bytes - Artifact byte count.
 * @property createdAt - Unix timestamp when the artifact was indexed.
 * @property metadata - JSON or plain-text metadata.
 * @usage Tree recall returns artifacts as evidence without loading large file bodies.
 */
export interface MemoryArtifact {
  readonly id: string;
  readonly kind: string;
  readonly path: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly bytes: number;
  readonly createdAt: number;
  readonly metadata: string;
}

/**
 * Describes input used to index one memory artifact.
 *
 * @property kind - Artifact category.
 * @property path - Project-relative or profile-relative artifact path.
 * @property sourceKind - Source category that produced this artifact.
 * @property sourceId - Source id for audit and replay.
 * @property bytes - Artifact byte count.
 * @property metadata - Optional JSON-safe metadata.
 * @usage Tool and brain bridges can index artifacts for later evidence recall.
 */
export interface MemoryArtifactInput {
  readonly kind: string;
  readonly path: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly bytes: number;
  readonly metadata?: unknown;
}

/**
 * Describes one ranked item inside tree recall diagnostics.
 *
 * @property ref - Graph reference for the item.
 * @property score - Combined recall score.
 * @property reasons - Ranking signals that selected the item.
 * @property evidenceRefs - Related graph references used as evidence.
 * @usage Retrieval traces persist these items so the recall path is explainable.
 */
export interface MemoryTreeRecallItem {
  readonly ref: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

/**
 * Describes conflicts found while answering a query.
 *
 * @property key - Stable conflict key, usually namespace/subject/predicate.
 * @property factIds - Fact ids that disagree.
 * @property objects - Distinct object values for the same key.
 * @usage Recall exposes stale or contradictory facts instead of silently picking one.
 */
export interface MemoryConflict {
  readonly key: string;
  readonly factIds: readonly string[];
  readonly objects: readonly string[];
}

/**
 * Describes the structured tree recall result for one query.
 *
 * @property query - User question or internal recall query.
 * @property chunks - Ranked chunk recall results.
 * @property facts - Ranked structured facts.
 * @property entities - Query-matched or graph-neighborhood entities.
 * @property relations - Traversed graph relations.
 * @property claims - Ranked claims relevant to the query.
 * @property decisions - Ranked decisions relevant to the query.
 * @property tasks - Ranked tasks relevant to the query.
 * @property artifacts - Ranked artifact references relevant to the query.
 * @property conflicts - Conflicting fact groups encountered during recall.
 * @property diagnostics - Ranked refs and scoring reasons.
 * @usage Context and tests use this API when they need graph-aware evidence, not just chunks.
 */
export interface MemoryTreeRecallResult {
  readonly query: string;
  readonly chunks: readonly MemoryRecallResult[];
  readonly facts: readonly MemoryFact[];
  readonly entities: readonly MemoryEntity[];
  readonly relations: readonly MemoryRelation[];
  readonly claims: readonly MemoryClaim[];
  readonly decisions: readonly MemoryDecision[];
  readonly tasks: readonly MemoryTask[];
  readonly artifacts: readonly MemoryArtifact[];
  readonly conflicts: readonly MemoryConflict[];
  readonly diagnostics: readonly MemoryTreeRecallItem[];
}

/**
 * Describes one persisted retrieval trace.
 *
 * @property id - Stable trace id.
 * @property conversationId - Optional local continuity id.
 * @property query - User question or internal recall query.
 * @property strategy - Retrieval strategy label.
 * @property resultIds - Memory chunk or fact ids returned to context.
 * @property diagnostics - Human-readable or JSON diagnostics explaining recall.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage ContextBuilderService writes these so debug UI can explain why memory was recalled.
 */
export interface MemoryRetrievalTrace {
  readonly id: string;
  readonly conversationId?: string;
  readonly query: string;
  readonly strategy: string;
  readonly resultIds: readonly string[];
  readonly diagnostics: string;
  readonly createdAt: number;
}

/**
 * Describes durable recovery state stored in memory.db.
 *
 * @property key - Recovery key such as active-turn or startup-scan.
 * @property state - Recovery state label.
 * @property payload - JSON-safe state payload.
 * @property updatedAt - Unix timestamp in milliseconds.
 * @usage Runtime uses this with brain.db to resume or explain interrupted work.
 */
export interface MemoryRecoveryState {
  readonly key: string;
  readonly state: string;
  readonly payload: unknown;
  readonly updatedAt: number;
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
