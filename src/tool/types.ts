/** EN: One concrete effect produced by a tool run. ZH: 一次工具执行产生的具体效果。 */
export interface ToolEffect {
    type: 'ask' | 'task' | 'read' | 'write' | 'delete' | 'execute';
    path?: string;
}

/** EN: Successful concrete tool output; failures reject unchanged. ZH: 成功的具体工具输出；失败原样 reject。 */
export interface ToolResult<T = unknown> {
    data: T;
    effects?: readonly ToolEffect[];
}

/**
 * EN: Canonical tool schema owned by the tool domain; model protocols accept the same structural shape.
 * ZH: 由 tool 域拥有的规范工具 schema；model 协议接受相同结构形状。
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ToolRequest {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * EN: Normalized tool call result returned to the model loop.
 * ZH: 返回给模型循环的标准化工具调用结果。
 */
export interface ToolRunResult {
    name: string;
    data: unknown;
    effects?: readonly ToolEffect[];
}

/** EN: One answer option validated by Ask. ZH: Ask 验证的一项回答选项。 */
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
    timedOut: boolean;
    ok: boolean;
    durationMs: number;
}

export interface ExecuteOutput {
    action: 'execute';
    mode: ExecuteMode;
    cwd: string;
    total: number;
    success: number;
    failed: number;
    results: ExecuteTaskResult[];
}

export interface TaskInput {
    tasks?: unknown;
}

export interface TaskItemInput {
    agent?: unknown;
    goal?: unknown;
}

export interface TaskOutput {
    tasks: Array<{ agent: string; goal: string }>;
}
