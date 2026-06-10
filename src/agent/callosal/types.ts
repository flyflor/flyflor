import type { AgentMemory } from '@/agent/brain/intelligence';

export enum CallosalAction {
    REMEMBER = 'remember',
    DIALOGUE = 'dialogue',
    RESEARCH = 'research',
}

export interface CallosalNavigateContext {
    history?: AgentMemory[];
}

export interface CallosalBrief {
    userIntent: string;
    taskType: CallosalAction;
    needsTools: boolean;
    relatedFiles: string[];
    evidence: string[];
    instructions: string;
}

export interface CallosalTurn {
    // 进展方向
    action: CallosalAction;

    // 摘要
    content: string;
}
