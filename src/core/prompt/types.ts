/**
 * EN: PromptSource interface declaration.
 * ZH: PromptSource interface 声明。
 */
export interface PromptSource {
    path: string;
    key?: string;
}

/**
 * EN: PromptBlock interface declaration.
 * ZH: PromptBlock interface 声明。
 */
export interface PromptBlock {
    namespace: 'flyflor';
    name: string;
    key: string;
    payload: Record<string, unknown>;
    body: string;
    source: PromptSource;
    enabled: boolean;
}

/**
 * EN: PromptBlockMap type declaration.
 * ZH: PromptBlockMap type 声明。
 */
export type PromptBlockMap = Record<string, PromptBlock>;
