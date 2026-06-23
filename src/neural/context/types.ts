import type { AgentMemory } from '@/agent/memory';
import type { CallosumSignal } from '@/agent/brain/callosum';

export enum ContextPrompt {
    Ingest = 'INGEST',
    Settle = 'SETTLE',
}

export interface ContextIntelligence {
    completeText(messages: AgentMemory[]): Promise<string>;
}

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
}

export enum ContextTurnStatus {
    Working = 'working',
    Paused = 'paused',
    Completed = 'completed',
}

export interface ContextPause {
    kind: 'ask' | 'confirm';
    signal: CallosumSignal;
    data: unknown;
    messages: AgentMemory[];
    createdAt: number;
}

export interface ContextTurn {
    id: string;
    understanding: TurnUnderstanding;
    transcript: AgentMemory[];
    status: ContextTurnStatus;
    pending?: ContextPause;
    createdAt: number;
    updatedAt: number;
}
