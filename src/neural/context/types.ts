import type { AgentMemory } from '@/agent/types';

export enum ContextPrompt {
    Ingest = 'INGEST',
    Settle = 'SETTLE',
}

/**
 * EN: Minimal intelligence surface used by Context.
 * ZH: Context 使用的最小 intelligence 接口面。
 */
export interface ContextIntelligence {
    completeText(messages: AgentMemory[]): Promise<string>;
}

export enum ContextIntent {
    Reply = 'reply',
    Research = 'research',
    Soul = 'soul',
}

/**
 * EN: One normalized reference item from turn understanding.
 * ZH: turn understanding 里的单条规范化引用项。
 */
export interface ContextReference {
    type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    value: string;
}

/**
 * EN: One parsed view of the user's current turn.
 * ZH: 对当前用户 turn 的一次解析视图。
 */
export interface TurnUnderstanding {
    userText: string;
    intent: ContextIntent;
    goal: string;
    constraints: string[];
    requestedOutput?: string;
    references: ContextReference[];
    knownDone: string[];
    openQuestions: string[];
    shouldInvestigate: boolean;
}

/**
 * EN: One durable summary saved after a completed turn.
 * ZH: 一次完成 turn 后保存的长期摘要。
 */
export interface CompletedSummary {
    goal: string;
    result: string;
    changedFiles: string[];
    decisions: string[];
    evidence: string[];
    remaining: string[];
    createdAt: number;
}

/**
 * EN: Input payload for settling a completed turn summary.
 * ZH: 用于 settle 完成 turn 摘要的输入载荷。
 */
export interface ContextSettleInput {
    user: string;
    assistant: string;
    completed: boolean;
    evidence?: string[];
    decisions?: string[];
    remaining?: string[];
}

export enum ContextTurnStatus {
    Working = 'working',
    Completed = 'completed',
}

export type ContextPauseKind = 'ask' | 'confirm';

export interface ContextScope {
    project?: string;
    root?: string;
    anchor?: string[];
}

export interface ContextPauseInput {
    kind: ContextPauseKind;
    prompt: string;
}

/**
 * EN: One tracked user turn with state, timestamps, and optional summary.
 * ZH: 一条被跟踪的用户 turn，包含状态、时间戳和可选摘要。
 */
export interface ContextTurn {
    id: string;
    understanding: TurnUnderstanding;
    status: ContextTurnStatus;
    summary?: CompletedSummary;
    assistantText?: string;
    paused?: boolean;
    pauseKind?: ContextPauseKind;
    pausePrompt?: string;
    scope?: ContextScope;
    createdAt: number;
    updatedAt: number;
}
