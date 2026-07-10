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
 * EN: One isolated unit of coordinated work.
 * ZH: 多 Agent 协调中的一个隔离工作单元。
 */
export interface Assignment {
    profile: string;
    goal: string;
    persona?: string;
    constraints: string[];
    cwd?: string;
    context: string;
}

export interface Outcome {
    answer: string;
    evidence: string[];
}

export enum AgentEventType {
    ModelRequest = 'model_request',
    ActionStart = 'action_start',
    ActionResult = 'action_result',
}
