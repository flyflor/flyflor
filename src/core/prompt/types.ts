export interface PromptSource {
    path: string;
    key?: string;
}

export interface PromptBlock {
    namespace: 'flyflor';
    name: string;
    key: string;
    payload: Record<string, unknown>;
    body: string;
    source: PromptSource;
    enabled: boolean;
}

export type PromptBlockMap = Record<string, PromptBlock>;
