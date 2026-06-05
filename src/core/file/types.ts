import type { PromptBlockMap } from '@/core/prompt';

export type FileData = string | Record<string, unknown> | undefined;

export interface FileEntity<TData = FileData> {
    path: string;
    data: TData;
    blocks: PromptBlockMap;
}

export interface FileWriteOptions {
    createDirectories?: boolean;
}
