import type { MemoryChunk, MemoryRecallResult } from "../memory";

/**
 * Describes a persisted scope record in scope.db.
 *
 * @property id - Stable scope id.
 * @property name - Human-readable scope name.
 * @property codename - Unique codename used as the scope key.
 * @property namespace - Memory namespace prefix for scope facts.
 * @property keywords - JSON array of trigger keywords.
 * @property constitution - Markdown constitution definition.
 * @property status - Scope lifecycle status.
 * @property createdAt - Unix timestamp in milliseconds.
 * @property updatedAt - Unix timestamp in milliseconds.
 * @usage ScopeStore manages these rows in scope.db.
 */
export interface ScopeRecord {
  readonly id: string;
  readonly name: string;
  readonly codename: string;
  readonly namespace: string;
  readonly keywords: readonly string[];
  readonly constitution: string;
  readonly status: "active" | "archived";
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Describes input used to create or update a scope record.
 *
 * @property name - Human-readable scope name.
 * @property codename - Unique scope codename.
 * @property namespace - Memory namespace for this scope.
 * @property keywords - Trigger keywords for activation.
 * @property constitution - Markdown constitution.
 * @usage ScopeService writes this when creating a scope.
 */
export interface ScopeInput {
  readonly name: string;
  readonly codename: string;
  readonly namespace: string;
  readonly keywords: readonly string[];
  readonly constitution: string;
}

/**
 * Describes one scope keyword detection result.
 *
 * @property conversationId - Conversation where keywords were found.
 * @property turnId - Turn where keywords were detected.
 * @property keywords - Detected keywords.
 * @property matchedScopeIds - Matching scope ids.
 * @usage Emitted as `scope.detected` signal payload.
 */
export interface ScopeDetectedPayload {
  readonly conversationId: string;
  readonly turnId: string;
  readonly keywords: readonly string[];
  readonly matchedScopeIds: readonly string[];
}

/**
 * Describes a scope activation event.
 *
 * @property conversationId - Conversation where scope was activated.
 * @property scopeId - Activated scope id.
 * @property scopeName - Scope name for UI display.
 * @property loadedAt - Unix timestamp in milliseconds.
 * @usage Emitted as `scope.activated` signal payload.
 */
export interface ScopeActivatedPayload {
  readonly conversationId: string;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly loadedAt: number;
}

/**
 * Describes a scope codename nomination before user confirmation.
 *
 * @property namespace - Topic namespace.
 * @property codename - Proposed codename.
 * @property mentionCount - Times this topic has been mentioned.
 * @property firstMentionedAt - Unix timestamp of first mention.
 * @property lastMentionedAt - Unix timestamp of most recent mention.
 * @usage Emitted as `scope.candidate.nominated` signal payload.
 */
export interface ScopeCandidatePayload {
  readonly namespace: string;
  readonly codename: string;
  readonly mentionCount: number;
  readonly firstMentionedAt: number;
  readonly lastMentionedAt: number;
}

/**
 * Describes a scope creation result.
 *
 * @property scopeId - New scope id.
 * @property codename - Scope codename.
 * @property namespace - Scope namespace.
 * @property dbPath - Absolute scope.db path.
 * @property createdAt - Unix timestamp in milliseconds.
 * @usage Emitted as `scope.created` signal payload.
 */
export interface ScopeCreatedPayload {
  readonly scopeId: string;
  readonly codename: string;
  readonly namespace: string;
  readonly dbPath: string;
  readonly createdAt: number;
}

/**
 * Describes scope recall result for context injection.
 *
 * @property scopeId - Source scope id.
 * @property chunks - Ranked recall results from scope-specific memory.
 * @usage ScopeService returns this to ContextBuilder when a scope is active.
 */
export interface ScopeRecallResult {
  readonly scopeId: string;
  readonly scopeName: string;
  readonly chunks: readonly MemoryRecallResult[];
}
