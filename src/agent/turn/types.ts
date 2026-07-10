export type TurnMode = 'reply' | 'research' | 'soul' | 'coordinate';

export type TurnStatus = 'active' | 'paused' | 'completed' | 'failed';

export type InteractionKind = 'ask' | 'confirm';

export interface Reference {
    type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    value: string;
}

/**
 * EN: One model-derived understanding of the latest user input.
 * ZH: 模型对最新用户输入形成的一次结构化理解。
 */
export interface Perception {
    mode: TurnMode;
    goal: string;
    cwd?: string;
    constraints: string[];
    references: Reference[];
}

export interface TurnInteraction {
    id: string;
    kind: InteractionKind;
    prompt: string;
}

export interface TurnSnapshot {
    id: string;
    input: string;
    mode: TurnMode;
    goal: string;
    cwd?: string;
    constraints: string[];
    references: Reference[];
    status: TurnStatus;
    answer: string;
    evidence: string[];
    interaction?: TurnInteraction;
    error?: string;
    createdAt: number;
    updatedAt: number;
}
