import type { AskToolData, CodeGraphToolData, ConfirmToolData, ReadFileToolData } from '@/plugins/tools';

export enum ResearchStopReason {
    Answered = 'answered',
    NeedsUser = 'needs_user',
    ToolError = 'tool_error',
    MaxTurns = 'max_turns',
}

export interface ResearchEvidence {
    id: string;
    tool: string;
    summary: string;
    data: CodeGraphToolData | ReadFileToolData | unknown;
}

export type ResearchClarificationRequest = AskToolData | ConfirmToolData;

export interface PendingResearch {
    originalUserContent: string;
    workingDirectory?: string;
    summary: string;
    evidence: ResearchEvidence[];
    clarification: ResearchClarificationRequest;
    awaiting: 'ask' | 'confirm';
}
