export enum AgentChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
}

/**
 * EN: One pure short-term memory message for an agent.
 * ZH: 面向 agent 的一条纯短期记忆消息。
 */
export interface AgentMemory {
    role: AgentChatRole.System | AgentChatRole.User | AgentChatRole.Assistant;
    content: string;
}

/**
 * EN: A bounded, public result returned by one fixed collective member.
 * It deliberately excludes hidden reasoning and provider replay buffers.
 * ZH: 固定群体成员返回的有界公开结果；不包含隐藏推理或 provider replay 缓冲。
 */
export interface AgentReport {
    agentId: string;
    answer: string;
    evidence: string[];
    remaining: string[];
    steps: number;
}

export interface AgentRunControl {
    focusId: string;
    revision: number;
    cwd?: string;
    signal: AbortSignal;
    stream: boolean;
    onChunk(chunk: string): void;
}

export interface AgentInteractionRequest {
    focusId: string;
    revision: number;
    requestId: string;
    agentId: string;
    kind: 'ask' | 'confirm';
    data: unknown;
}

export type AgentInteractionResponse =
    | { kind: 'ask'; answers: Array<{ question: string; answer: string }> }
    | { kind: 'confirm'; approved: boolean };

export interface AgentRuntimeEvent {
    agentId: string;
    focusId: string;
    revision: number;
    type: 'action_start' | 'action_result';
    data: unknown;
}
