/**
 * EN: Model-facing tool schema projected from a concrete Tool.
 * ZH: 由具体 Tool 投影出的面向模型的工具 schema。
 *
 * EN: Owned here so tool never imports model; shapes stay structurally compatible.
 * ZH: 放在 tool 域使 tool 永不 import model；形状与 model 侧结构兼容。
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** EN: One model-facing tool request id and argument bag. ZH: 面向模型的一次工具请求 id 与参数袋。 */
export interface ToolRequest {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * EN: Normalized tool result returned to Investigation replay.
 * ZH: 返回给 Investigation replay 的标准化工具结果。
 */
export interface ToolRunResult {
    name: string;
    data: unknown;
}

/** EN: One answer option for an Ask question. ZH: Ask 问题的一个候选回答。 */
export interface AskOption {
    label: string;
    description?: string;
    recommended?: boolean;
    custom?: boolean;
}

/** EN: One validated clarification question. ZH: 一条已校验的澄清问题。 */
export interface AskQuestion {
    question: string;
    options: AskOption[];
}

/** EN: Raw Ask tool arguments before validation. ZH: 校验前的 Ask 原始参数。 */
export interface AskInput {
    questions?: unknown;
}

/** EN: Validated Ask payload before cortical discharge. ZH: 皮层放电前的已校验 Ask 载荷。 */
export interface AskOutput {
    kind: 'ask';
    questions: AskQuestion[];
}

/** EN: Raw filesystem tool arguments before validation. ZH: 校验前的 filesystem 原始参数。 */
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

/** EN: Supported filesystem actions. ZH: 支持的文件系统动作。 */
export type FilesystemInputAction = 'read' | 'write' | 'edit' | 'delete';

/** EN: Validated filesystem result. ZH: 已校验的文件系统结果。 */
export type FilesystemOutput =
    | { action: 'read'; path: string; content: string; bytes: number; truncated: boolean }
    | { action: 'write'; path: string; bytes: number }
    | { action: 'edit'; path: string; replacements: number; bytes: number }
    | { action: 'delete'; path: string };

/** EN: Raw shell tool arguments before validation. ZH: 校验前的 shell 原始参数。 */
export interface ShellInput {
    cwd?: unknown;
    command?: unknown;
    args?: unknown;
    timeoutMs?: unknown;
}

/** EN: Explicit shell process data. ZH: 显式 shell 进程数据。 */
export interface ShellOutput {
    action: 'shell';
    cwd: string;
    command: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

/** EN: Raw execute tool arguments before validation. ZH: 校验前的 execute 原始参数。 */
export interface ExecuteInput {
    cwd?: unknown;
    mode?: unknown;
    maxConcurrency?: unknown;
    tasks?: unknown;
}

/** EN: Execute batch mode. ZH: execute 批处理模式。 */
export type ExecuteMode = 'serial' | 'parallel';

/** EN: One raw execute task before validation. ZH: 校验前的一条 execute 任务。 */
export interface ExecuteTaskInput {
    id?: unknown;
    runtime?: unknown;
    path?: unknown;
    args?: unknown;
    cwd?: unknown;
    env?: unknown;
    timeoutMs?: unknown;
}

/** EN: One completed execute task result. ZH: 一条已完成的 execute 任务结果。 */
export interface ExecuteTaskResult {
    id?: string;
    runtime: 'python' | 'sh';
    path: string;
    cwd: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    ok: boolean;
    durationMs: number;
}

/** EN: Validated execute batch result. ZH: 已校验的 execute 批结果。 */
export interface ExecuteOutput {
    action: 'execute';
    mode: ExecuteMode;
    cwd: string;
    total: number;
    success: number;
    failed: number;
    results: ExecuteTaskResult[];
}

/** EN: Raw task tool arguments before validation. ZH: 校验前的 task 原始参数。 */
export interface TaskInput {
    tasks?: unknown;
}

/** EN: One raw delegated task item before validation. ZH: 校验前的一条委派任务项。 */
export interface TaskItemInput {
    agent?: unknown;
    goal?: unknown;
}

/** EN: Validated task payload before cortical discharge. ZH: 皮层放电前的已校验 task 载荷。 */
export interface TaskOutput {
    tasks: Array<{ agent: string; goal: string }>;
}
