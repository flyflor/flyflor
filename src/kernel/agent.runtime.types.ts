import type { ContextBuildResult } from "../context";
import type { ToolResult } from "../tools";

/**
 * Describes one inbound user turn.
 *
 * @property conversationId - Local continuity id; not a provider session id.
 * @property content - User message content.
 * @usage SocketServerService passes this to AgentRuntimeService.
 */
export interface AgentTurnInput {
  readonly conversationId: string;
  readonly content: string;
}

/**
 * Describes one completed agent turn.
 *
 * @property conversationId - Local continuity id.
 * @property turnId - Runtime-generated turn id.
 * @property assistantMessage - Final assistant text.
 * @property context - Context build diagnostics for the turn.
 * @property toolResults - Tool results executed during the turn.
 * @usage Socket responses and scenario tests inspect this result.
 */
export interface AgentTurnResult {
  readonly conversationId: string;
  readonly turnId: string;
  readonly assistantMessage: string;
  readonly context: ContextBuildResult;
  readonly toolResults: readonly ToolResult[];
}

/**
 * Describes optional dependencies for explicit runtime construction.
 *
 * @property projectRoot - Project root used by default ConfigService.
 * @usage Tests pass concrete services directly; the entrypoint can rely on defaults.
 */
export interface AgentRuntimeOptions {
  readonly projectRoot?: string;
}
