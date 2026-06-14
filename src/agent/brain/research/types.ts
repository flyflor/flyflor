import { ResearchStopReason, type ResearchEvidence } from '@/agent/research.types';

export { ResearchStopReason, type ResearchClarificationRequest, type ResearchEvidence } from '@/agent/research.types';

export interface ResearchRunResult {
    reason: ResearchStopReason;
}

export interface ResearchPlannerBase {
    summary: string;
    reason?: string;
}

export interface ResearchAskPlan extends ResearchPlannerBase {
    action: 'ask';
    question: string;
    options: Array<{
        id: string;
        label: string;
        description: string;
        recommended: boolean;
    }>;
}

export interface ResearchConfirmPlan extends ResearchPlannerBase {
    action: 'confirm';
    question: string;
    recommended: boolean;
}

export interface ResearchSearchPlan extends ResearchPlannerBase {
    action: 'search';
    query: string;
    roots?: string[];
    maxResults?: number;
}

export interface ResearchReadPlan extends ResearchPlannerBase {
    action: 'read';
    path: string;
    maxBytes?: number;
}

export interface ResearchSynthesizePlan extends ResearchPlannerBase {
    action: 'synthesize';
    answerPlan?: string;
}

export type ResearchPlan =
    | ResearchAskPlan
    | ResearchConfirmPlan
    | ResearchSearchPlan
    | ResearchReadPlan
    | ResearchSynthesizePlan;

export interface ResearchToolStartEvent {
    id: string;
    name: string;
    input: unknown;
}

export interface ResearchToolResultEvent {
    id: string;
    name: string;
    ok: boolean;
    data?: unknown;
    error?: string;
}

export interface ResearchSummaryEvent {
    summary: string;
    evidenceCount: number;
    pending: boolean;
}
