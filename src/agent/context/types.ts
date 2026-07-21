/**
 * EN: One normalized reference item from turn understanding.
 * ZH: turn understanding 里的单条规范化引用项。
 */
export interface Reference {
    type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    value: string;
}

export type Intent = 'reply' | 'research' | 'coordinate';
export type PauseKind = 'ask' | 'confirm';
export type TurnStatus = 'working' | 'waiting' | 'suspended' | 'completed';

export interface Pause {
    id: string;
    kind: PauseKind;
    prompt: string;
}

export interface Ingest {
    text: string;
    speakerId: string;
    stimulusId?: string;
}

export interface Settle {
    assistant: string;
    evidence?: string[];
    decisions?: string[];
    remaining?: string[];
}

/**
 * EN: One compact outcome kept inside the bounded working set.
 * ZH: 有界工作集内保留的一条紧凑 outcome。
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
    done: string[];
    open: string[];
    workspace: TurnBrief[];
}

/**
 * EN: A semantic projection of one Turn kept in the bounded working set.
 * ZH: 有界工作集里一个 Turn 的语义投影。
 */
export interface TurnBrief {
    turnId: string;
    intent: Intent;
    goal: string;
    constraints: string[];
    refs: Reference[];
    cwd?: string;
    done: string[];
    open: string[];
    outcome?: Summary;
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

export interface TurnDraft {
    intent: Intent;
    goal: string;
    cwd?: string;
    constraints: string[];
    output?: string;
    refs: Reference[];
    done: string[];
    open: string[];
    investigate: boolean;
}

/**
 * EN: One tracked semantic turn. Its lifecycle state determines whether it is
 * foreground, waiting, suspended, or completed inside the bounded workspace.
 * ZH: 一条被跟踪的语义 turn。生命周期状态决定它在有界工作空间中是前台、等待、
 * 挂起还是完成。
 */
export interface Turn extends TurnDraft {
    id: string;
    speakerId: string;
    stimulusId?: string;
    status: TurnStatus;
    summary?: Summary;
    pause?: Pause;
    ts: number;
    updated?: number;
}
