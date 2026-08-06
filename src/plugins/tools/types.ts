import type { ToolError, ToolRisk } from '@/core';

export interface ToolProtocol {
    key: string;
    name: string;
    file: string;
    risk: ToolRisk;
    cwd?: 'inject';
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

export interface AskOption {
    label: string;
    description?: string;
    recommended?: boolean;
    custom?: boolean;
}

export interface AskQuestion {
    question: string;
    options: AskOption[];
}

export interface AskInput {
    questions?: unknown;
}

export interface AskOutput {
    kind: 'ask';
    questions: AskQuestion[];
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
    offsetLines?: unknown;
    limitLines?: unknown;
    limitBytes?: unknown;
    content?: unknown;
    oldText?: unknown;
    newText?: unknown;
}

export type FilesystemInputAction = 'read' | 'write' | 'edit' | 'delete';

export type FilesystemOutput =
    | { action: 'read'; path: string; content: string; bytes: number; truncated: boolean }
    | { action: 'write'; path: string; bytes: number }
    | { action: 'edit'; path: string; replacements: number; bytes: number }
    | { action: 'delete'; path: string };

export interface ShellInput {
    cwd?: unknown;
    command?: unknown;
    args?: unknown;
    timeoutMs?: unknown;
}

export interface ShellOutput {
    action: 'shell';
    cwd: string;
    command: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
}

export interface ExecuteInput {
    cwd?: unknown;
    mode?: unknown;
    maxConcurrency?: unknown;
    tasks?: unknown;
}

export type ExecuteMode = 'serial' | 'parallel';

export interface ExecuteTaskInput {
    id?: unknown;
    runtime?: unknown;
    path?: unknown;
    args?: unknown;
    cwd?: unknown;
    env?: unknown;
    timeoutMs?: unknown;
}

export interface ExecuteTaskResult {
    id?: string;
    runtime: 'python' | 'sh';
    path: string;
    cwd: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
    ok: boolean;
    durationMs: number;
}

export interface ExecuteOutput {
    action: 'execute';
    mode: ExecuteMode;
    maxConcurrency: number;
    cwd: string;
    total: number;
    success: number;
    failed: number;
    results: ExecuteTaskResult[];
}
