import type { AgentMemory } from '@/agent/brain/intelligence';
import type { ToolCall } from '@/tools';

/**
 * The three directions one turn can take after the callosal inspects it.
 * `Reply` means the protocol package was updated and the turn is already answered; `Chat` hands the
 * turn to the brain's direct reflex; `Execute` hands the distilled brief to the execution loop.
 */
export enum CallosalAction {
    Reply = 'reply',
    Chat = 'chat',
    Execute = 'execute',
}

/**
 * Optional context the agent passes alongside the raw turn text.
 */
export interface CallosalNavigateContext {
    history?: AgentMemory[];
}

/**
 * The scout decision: one cheap LLM look at the turn before any execution.
 * `investigation` records the scout's requested evidence calls verbatim — including calls the
 * investigation phase later refuses to run because they are not read-only.
 */
export interface CallosalDecision {
    needsTools: boolean;
    taskType: string;
    summary: string;
    investigation: ToolCall[];
}

/**
 * The distilled brief: the only context the execution phase needs to see.
 * Evidence is compressed from investigation results; the original long conversation never crosses
 * the callosal boundary into execution.
 */
export interface CallosalBrief {
    userIntent: string;
    taskType: string;
    needsTools: boolean;
    relatedFiles: string[];
    evidence: string[];
    instructions: string;
}

/**
 * The navigation outcome the agent branches on.
 */
export interface CallosalTurn {
    action: CallosalAction;
    content: string;
    reply?: string;
    decision?: CallosalDecision;
    brief?: CallosalBrief;
}

/**
 * Observability signals the callosal emits while it routes one turn.
 */
export type CallosalSignal =
    | { type: 'start'; turn: string }
    | { type: 'soul'; writes: string[] }
    | { type: 'scout'; decision: CallosalDecision }
    | { type: 'investigate'; evidence: string[] }
    | { type: 'distill'; brief: CallosalBrief };
