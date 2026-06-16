import type { AgentMemory } from '@/agent/memory';

export enum ContextIntent {
    Reply = 'reply',
    Research = 'research',
    Soul = 'soul',
}

export interface ContextReference {
    type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    value: string;
}

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

export interface CompletedSummary {
    goal: string;
    result: string;
    changedFiles: string[];
    decisions: string[];
    evidence: string[];
    remaining: string[];
    createdAt: number;
}

export interface ContextSettleInput {
    user: string;
    assistant: string;
    completed: boolean;
    working: AgentMemory[];
}
