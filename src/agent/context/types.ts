/**
 * EN: One normalized reference item from turn understanding.
 * ZH: turn understanding 里的单条规范化引用项。
 */
export interface Reference {
    type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    value: string;
}

export type Intent = 'reply' | 'research' | 'soul';
export type PauseKind = 'ask' | 'confirm';
export type TurnStatus = 'working' | 'completed';

export interface Pause {
    kind: PauseKind;
    prompt: string;
}

export interface Ingest {
    text: string;
}

export interface Settle {
    assistant: string;
    evidence?: string[];
    decisions?: string[];
    remaining?: string[];
}

/**
 * EN: One durable summary saved after a completed turn.
 * ZH: 一次完成 turn 后保存的长期摘要。
 */
export interface Summary {
    goal: string;
    result: string;
    changedFiles: string[];
    decisions: string[];
    evidence: string[];
    remaining: string[];
    createdAt: number;
}

/**
 * EN: A concise briefing of the current turn understanding handed to one agent.
 * This is not a conversation transcript; it is the organism's current grasp of
 * user intent, scoped for the receiving agent.
 * ZH: 交给某个 agent 的当前 turn 理解简报。它不是对话原文，而是生命体对接收
 * agent 范围的当前意图理解。
 */
export interface AgentBrief {
    turnId: string;
    intent: Intent;
    goal: string;
    persona?: string;
    constraints: string[];
    refs: Reference[];
    cwd?: string;
    recentSummaries: Summary[];
}

/**
 * EN: One note inside an agent's private memory cache.
 * ZH: agent 私有记忆缓存中的一条笔记。
 */
export interface MemoryNote {
    id: string;
    content: string;
    source: 'brief' | 'observation' | 'reflection';
    ts: number;
}

/**
 * EN: One tracked user turn. Acts as both the in-flight understanding and the
 * durable record after settlement, decided by `status`.
 * ZH: 一条被跟踪的用户 turn。既是进行中的理解视图,也靠 status 成为落地后的持久记录。
 */
export interface Turn {
    id: string;
    user: string;
    intent: Intent;
    goal: string;
    cwd?: string;
    constraints: string[];
    output?: string;
    refs: Reference[];
    done: string[];
    open: string[];
    investigate: boolean;
    status: TurnStatus;
    summary?: Summary;
    assistant?: string;
    pause?: Pause;
    ts: number;
    updated?: number;
}
