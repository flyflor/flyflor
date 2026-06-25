import type { ToolError, ToolRisk } from '@/core';

export interface ToolProtocol {
    key: string;
    name: string;
    file: string;
    risk: ToolRisk;
    parameters: Record<string, unknown>;
}

export interface ToolPromptConfig {
    version: number;
    description: string;
    tools: ToolProtocol[];
}

/**
 * EN: One model-requested tool call.
 * ZH: 模型请求的一次工具调用。
 */
export interface ActionRequest {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * EN: Normalized tool call result returned to the model loop.
 * ZH: 返回给模型循环的标准化工具调用结果。
 */
export interface ToolRunResult {
    ok: boolean;
    name: string;
    data?: unknown;
    error?: ToolError;
}

/**
 * EN: Persistable request/result pair for a tool call.
 * ZH: 可持久化的一次工具请求与结果。
 */
export interface ActionRecord {
    request: ActionRequest;
    result: ToolRunResult;
}

export interface AskInput {
    question?: unknown;
    options?: unknown;
}

export interface AskOutput {
    kind: 'ask';
    question: string;
    options: unknown;
}

export interface ConfirmInput {
    question?: unknown;
    recommended?: unknown;
}

export interface ConfirmOutput {
    kind: 'confirm';
    question: string;
    recommended: boolean;
}

export interface FilesystemInput {
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

export type FilesystemInputAction = 'list' | 'read' | 'write' | 'edit';

export interface FilesystemListEntry {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'other';
}

export type FilesystemOutput =
    | { action: 'list'; path: string; entries: FilesystemListEntry[] }
    | { action: 'read'; path: string; content: string; bytes: number; truncated: boolean }
    | { action: 'write'; path: string; bytes: number }
    | { action: 'edit'; path: string; replacements: number; bytes: number };

export interface ExecuteInput {
    cwd?: unknown;
    command?: unknown;
    args?: unknown;
    timeoutMs?: unknown;
}

export interface ExecuteOutput {
    action: 'execute';
    cwd: string;
    command: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
