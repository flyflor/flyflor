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
