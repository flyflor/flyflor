import type { AgentChatMessage } from '../intelligence';
import type { InvestigationObservation, InvestigationObserveRequest } from '@/plugins/tools';

export interface BrainInvestigationHypothesis {
    goal: string;
    supporting_evidence: string[];
    missing_evidence: string[];
    confidence: number;
}

export interface BrainInvestigationState {
    explicit_requests: string[];
    implicit_goals: string[];
    constraints: string[];
    unknowns: string[];
    hypotheses: BrainInvestigationHypothesis[];
    evidence: string[];
    information_needed: string[];
    next_question: string;
    confidence: number;
    observe_requests?: InvestigationObserveRequest[];
}

export interface BrainInvestigationRequest {
    content: string;
    context: AgentChatMessage[];
}

export interface BrainInvestigationResult {
    state: BrainInvestigationState;
    observations: InvestigationObservation[];
}
