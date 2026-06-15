import type { AgentChatRole } from './memory';

/**
 * One tool call requested by the model inside an assistant turn.
 * `arguments` is the parsed object form; the raw streamed JSON string lives only inside the protocol
 * adapter during accumulation and never reaches working memory.
 */
export interface AgentToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * One assembled mental input that also carries the model's tool requests for a turn.
 * It is the assistant-role member of `AgentMemory`; `content` keeps the visible text so the text-only
 * protocol adapters can project it unchanged. `reasoning` carries provider thinking text that some models
 * (e.g. DeepSeek thinking mode) require replayed alongside the tool calls on the next request.
 */
export interface AgentToolCallMemory {
    role: AgentChatRole.Assistant;
    content: string;
    toolCalls: AgentToolCall[];
    reasoning?: string;
}

/**
 * One tool result fed back to the model after a tool runs.
 * `content` is the model-visible rendering; `isError` marks a failed call so the model can recover.
 */
export interface AgentToolResultMemory {
    role: AgentChatRole.Tool;
    content: string;
    toolCallId: string;
    toolName: string;
    isError: boolean;
}

/**
 * One in-flight research task awaiting user clarification.
 * Stored on `Memory` so a follow-up user message can resume the same investigation instead of routing anew.
 */
export interface PendingResearch {
    request: string;
    clarification?: string;
    summary?: string;
}
