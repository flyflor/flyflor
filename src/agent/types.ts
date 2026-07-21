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
 * EN: One stimulus handed to an agent: what was said, who said it, and the
 * stimulus it grew from. Session-less: identity is only the speaker id.
 * ZH: 交给 agent 的一条刺激:说了什么、谁说的、它源自哪条刺激。
 * 无 session:身份只有 speaker id。
 */
export interface AgentInput {
    text: string;
    speakerId: string;
    stimulusId?: string;
    /** Attention relation selected by Awareness; absent means a new turn. */
    relation?: 'same' | 'new';
    targetTurnId?: string;
    signal?: AbortSignal;
}
