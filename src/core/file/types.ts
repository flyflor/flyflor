export type FileData = string | Record<string, unknown> | undefined;

export interface FileEntity<TData = FileData> {
    path: string;
    data: TData;
}

export interface FileWriteOptions {
    createDirectories?: boolean;
}
