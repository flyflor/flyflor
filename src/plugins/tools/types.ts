import type { ToolError, ToolMetadata } from '@/core';

export enum ToolName {
    Ask = 'ask',
    Confirm = 'confirm',
    Filesystem = 'filesystem',
}

export enum FilesystemAction {
    List = 'list',
    Read = 'read',
    Write = 'write',
    Edit = 'edit',
}

export interface ActionRequest {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolRunResult {
    ok: boolean;
    name: string;
    data?: unknown;
    error?: ToolError;
}

export interface ActionRecord {
    request: ActionRequest;
    result: ToolRunResult;
}

export interface AskToolInput {
    question?: unknown;
    options?: unknown;
}

export interface AskToolOutput {
    kind: 'ask';
    question: string;
    options: unknown;
}

export interface ConfirmToolInput {
    question?: unknown;
    recommended?: unknown;
}

export interface ConfirmToolOutput {
    kind: 'confirm';
    question: string;
    recommended: boolean;
}

export interface FilesystemToolInput {
    action?: unknown;
    cwd?: unknown;
    path?: unknown;
    depth?: unknown;
    offsetLines?: unknown;
    limitLines?: unknown;
    limitBytes?: unknown;
    content?: unknown;
    oldText?: unknown;
    newText?: unknown;
}

export interface FilesystemListEntry {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'other';
}

export type FilesystemToolOutput =
    | { action: FilesystemAction.List; path: string; entries: FilesystemListEntry[] }
    | { action: FilesystemAction.Read; path: string; content: string; bytes: number; truncated: boolean }
    | { action: FilesystemAction.Write; path: string; bytes: number }
    | { action: FilesystemAction.Edit; path: string; replacements: number; bytes: number };

export type ToolClassMetadata = ToolMetadata & { className: string };
