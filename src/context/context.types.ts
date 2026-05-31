import type { MemoryCheckpoint, MemoryFact, MemoryMessage, MemoryRecallResult, MemoryRetrievalTrace } from "../memory";
import type { MemoryArtifact, MemoryClaim, MemoryDecision, MemoryEntity, MemoryRelation, MemoryTask, MemoryTreeRecallItem } from "../memory";

/**
 * Enumerates the primary user intent classes used by runtime routing.
 *
 * @usage ContextIntentAnalyzerComponent returns one of these values before tools or model calls run.
 */
export type ContextIntentKind =
  | "chat"
  | "memory_fact"
  | "coding_inspection"
  | "code_edit"
  | "shell_request"
  | "recall_question"
  | "workmux_request";

/**
 * Enumerates semantic turn decisions produced by the model-backed decider.
 *
 * @usage Runtime uses this mode to choose context sources and visible tool groups without matching user text.
 */
export type TurnDecisionMode =
  | "direct_reply"
  | "clarify_reference"
  | "continue_task"
  | "investigate"
  | "code"
  | "memory_answer"
  | "refuse_or_block";

/**
 * Enumerates the context isolation policy derived from a model turn decision.
 *
 * @usage ContextBuilderService and brain diagnostics use this to prove when old task state is intentionally excluded.
 */
export type ContextPolicy =
  | "isolated"
  | "task_scoped"
  | "memory_scoped"
  | "project_scoped";

/**
 * Enumerates whether the model decision identified one write/reference target.
 *
 * @usage Runtime tool gating uses this audit field before exposing mutating project tools.
 */
export type TargetConfidence =
  | "none"
  | "ambiguous"
  | "unique";

/**
 * Enumerates model-selectable context source groups.
 *
 * @usage ContextBuilderService injects only the groups selected by the turn decision.
 */
export type ContextSourceGroup =
  | "current_user"
  | "recent_messages"
  | "checkpoint"
  | "memory_recall"
  | "structured_facts"
  | "knowledge_tree"
  | "runtime";

/**
 * Enumerates model-selectable tool groups.
 *
 * @usage AgentRuntimeService maps these groups to concrete model-visible tools.
 */
export type ToolVisibilityGroup =
  | "read_only"
  | "memory_read"
  | "memory_write"
  | "shell"
  | "edit"
  | "workmux"
  | "context"
  | "codegraph";

/**
 * Describes one clue extracted from recent local conversation state.
 *
 * @property id - Source message id.
 * @property role - Conversation role.
 * @property excerpt - Bounded message excerpt.
 * @property createdAt - Original message timestamp.
 * @usage TurnCluePacket carries these lines as evidence, not as a host-side intent decision.
 */
export interface TurnConversationClue {
  readonly id: string;
  readonly role: MemoryMessage["role"];
  readonly excerpt: string;
  readonly createdAt: number;
}

/**
 * Describes graph-aware memory evidence offered to the model decider.
 *
 * @property query - Current user input used as the recall query.
 * @property chunks - Ranked durable chunks.
 * @property facts - Ranked structured facts.
 * @property entities - Ranked graph entities.
 * @property relations - Traversed evidence relations.
 * @property claims - Ranked claims.
 * @property decisions - Ranked decisions.
 * @property tasks - Ranked task candidates.
 * @property artifacts - Ranked artifact references.
 * @property diagnostics - Scoring diagnostics for audit and prompt transparency.
 * @usage This is the knowledge-tree candidate set for "which thing" resolution.
 */
export interface TurnKnowledgeTreeClues {
  readonly query: string;
  readonly chunks: readonly MemoryRecallResult[];
  readonly facts: readonly MemoryFact[];
  readonly entities: readonly MemoryEntity[];
  readonly relations: readonly MemoryRelation[];
  readonly claims: readonly MemoryClaim[];
  readonly decisions: readonly MemoryDecision[];
  readonly tasks: readonly MemoryTask[];
  readonly artifacts: readonly MemoryArtifact[];
  readonly diagnostics: readonly MemoryTreeRecallItem[];
}

/**
 * Describes the structured clue packet sent to the LLM decider.
 *
 * @property conversationId - Local continuity id.
 * @property userInput - Exact current user text.
 * @property runtimeState - Runtime status supplied by the kernel.
 * @property recentConversation - Bounded recent messages with ids and timestamps.
 * @property checkpoint - Latest context checkpoint, when present.
 * @property knowledgeTree - Graph-aware recall candidates.
 * @property recoveryState - Last persisted recovery state.
 * @usage The host builds this packet but does not decide intent from its text.
 */
export interface TurnCluePacket {
  readonly conversationId: string;
  readonly userInput: string;
  readonly runtimeState?: string;
  readonly recentConversation: readonly TurnConversationClue[];
  readonly checkpoint?: MemoryCheckpoint;
  readonly knowledgeTree: TurnKnowledgeTreeClues;
  readonly recoveryState?: {
    readonly state: string;
    readonly payload: unknown;
    readonly updatedAt: number;
  };
}

/**
 * Describes one fact the model asks the runtime to store.
 *
 * @property namespace - Memory namespace for the fact.
 * @property subject - Subject being described.
 * @property predicate - Predicate or relation.
 * @property object - Object value.
 * @property confidence - Optional model confidence.
 * @usage Runtime stores these facts with turn provenance; it does not parse facts from user text.
 */
export interface TurnDecisionFact {
  readonly namespace: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly confidence?: number;
}

/**
 * Describes one structured user intent decision.
 *
 * @property primary - Main intent class used for runtime routing.
 * @property confidence - Analyzer confidence from 0 to 1.
 * @property requiresProjectInspection - Whether read-only project evidence should be collected before answering.
 * @property projectPath - Project path explicitly identified in the user input, when present.
 * @property shellCommand - Shell command explicitly requested by the user, when present.
 * @property contextPolicy - Context isolation policy derived from the decision.
 * @property targetConfidence - Whether a single project/task target was identified.
 * @property writeTargetRoot - Absolute or cwd-compatible project root allowed for mutating model tools.
 * @property reasons - Short diagnostic reasons explaining the decision.
 * @property diagnosticSource - Source of the decision.
 * @property rawModelOutput - Raw model response when a model-backed analysis was attempted.
 * @usage Runtime records this in brain events and context diagnostics.
 */
export interface ContextIntentDecision {
  readonly decisionId: string;
  readonly primary: ContextIntentKind;
  readonly mode: TurnDecisionMode;
  readonly confidence: number;
  readonly requiresProjectInspection: boolean;
  readonly projectPath?: string;
  readonly shellCommand?: string;
  readonly contextPolicy: ContextPolicy;
  readonly targetConfidence: TargetConfidence;
  readonly writeTargetRoot?: string;
  readonly selectedTaskId?: string;
  readonly candidateTaskIds: readonly string[];
  readonly needsClarification: boolean;
  readonly clarifyingQuestion?: string;
  readonly contextSourcesToInject: readonly ContextSourceGroup[];
  readonly toolGroupsToExpose: readonly ToolVisibilityGroup[];
  readonly factsToStore: readonly TurnDecisionFact[];
  readonly reasons: readonly string[];
  readonly diagnosticSource: "model";
  readonly rawModelOutput?: string;
  readonly cluePacket: TurnCluePacket;
}

/**
 * Describes an intent analysis request from the runtime.
 *
 * @property conversationId - Local continuity id used to read recent context.
 * @property userInput - Current user message to classify.
 * @property excludeMessageId - Optional current message id to omit from recent context.
 * @usage Runtime asks ContextIntentAnalyzerComponent for this before evidence collection.
 */
export interface ContextIntentAnalysisInput {
  readonly conversationId: string;
  readonly userInput: string;
  readonly runtimeState?: string;
  readonly excludeMessageId?: string;
}

/**
 * Describes the model call used for intent analysis.
 *
 * @property model - Active model id.
 * @property messages - Intent prompt and recent conversation context.
 * @property userInput - Current user message being classified.
 * @usage ModelProvider implementations may use this for a non-streaming classification call.
 */
export interface ContextIntentModelRequest {
  readonly model: string;
  readonly messages: readonly ContextMessage[];
  readonly userInput: string;
  readonly cluePacket?: TurnCluePacket;
}

/**
 * Describes the required model-backed intent capability.
 *
 * @usage ContextIntentAnalyzerComponent fails the turn when this method is absent or fails.
 */
export interface ContextIntentModelClient {
  analyzeIntent?(request: ContextIntentModelRequest): Promise<string>;
}

/**
 * Describes one tool call echoed back to the model on an assistant message.
 *
 * @property id - Provider tool-call id used to pair the matching tool result.
 * @property name - Tool name requested by the model.
 * @property argumentsJson - Raw JSON arguments string emitted by the model.
 * @usage Carried on an assistant `ContextMessage` so the native OpenAI tool protocol round-trips.
 */
export interface ContextToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

/**
 * Describes one model-facing context message.
 *
 * @property role - Model message role used by the provider adapter.
 * @property content - Text content assembled from templates, prompts, memory, or conversation tail.
 * @property toolCalls - Tool calls requested by an assistant turn, preserved for native protocol replay.
 * @property toolCallId - Provider tool-call id this `tool` message answers; required for native tool results.
 * @usage ContextBuilderService returns these messages for AgentRuntimeService.
 */
export interface ContextMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCalls?: readonly ContextToolCall[];
  readonly toolCallId?: string;
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
  readonly intent?: ContextIntentDecision;
}

/**
 * Describes a completed model context.
 *
 * @property messages - Stable ordered messages passed to the model provider.
 * @property recall - Memory recall items injected into the context.
 * @property checkpoint - Latest persisted context checkpoint when available.
 * @property recentMessages - Recent local conversation messages preserved verbatim.
 * @property facts - Structured facts recalled for the current query.
 * @property retrievalTrace - Latest retrieval trace created while building this context.
 * @property estimatedChars - Approximate character budget used by the context.
 * @property intent - Structured intent diagnostic injected into this context.
 * @usage Runtime uses this object for provider calls and diagnostic socket events.
 */
export interface ContextBuildResult {
  readonly messages: readonly ContextMessage[];
  readonly recall: readonly MemoryRecallResult[];
  readonly checkpoint?: MemoryCheckpoint;
  readonly recentMessages: readonly MemoryMessage[];
  readonly facts: readonly MemoryFact[];
  readonly retrievalTrace?: MemoryRetrievalTrace;
  readonly estimatedChars: number;
  readonly intent?: ContextIntentDecision;
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
