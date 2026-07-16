/** ZH: 一次工具执行产生的具体效果。 EN: One concrete effect produced by a tool run. */
export interface ToolEffect {
    type: 'ask' | 'task' | 'read' | 'write' | 'delete' | 'execute';
    path?: string;
}

/** ZH: 成功的具体工具输出；失败原样 reject。 EN: Successful concrete tool output; failures reject unchanged. */
export interface ToolResult<T = unknown> {
    data: T;
    effects?: readonly ToolEffect[];
}

/**
 * ZH: 由 tool 域拥有的规范工具 schema；model 协议接受相同结构形状。
 * EN: Canonical tool schema owned by the tool domain; model protocols accept the same structural shape.
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** ZH: Tools 验证并执行前的一次模型工具调用。 EN: One model-emitted tool call before Tools validates and runs it. */
export interface ToolRequest {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * ZH: 返回给模型循环的标准化工具调用结果。
 * EN: Normalized tool call result returned to the model loop.
 */
export interface ToolRunResult {
    name: string;
    data: unknown;
    effects?: readonly ToolEffect[];
}

/** ZH: Ask 验证的一项回答选项。 EN: One answer option validated by Ask. */
export interface AskOption {
    label: string;
    description?: string;
    recommended?: boolean;
    custom?: boolean;
}

/** ZH: 一道已验证澄清问题及其回答选项。 EN: One validated clarification question with its answer options. */
export interface AskQuestion {
    question: string;
    options: AskOption[];
}

/** ZH: 验证前 Ask 的原始模型参数。 EN: Raw model arguments for Ask before validation. */
export interface AskInput {
    questions?: unknown;
}

/** ZH: 投影到交互回路的已验证 Ask 负载。 EN: Validated Ask payload projected into the interaction circuit. */
export interface AskOutput {
    kind: 'ask';
    questions: AskQuestion[];
}

/** ZH: 验证前 Filesystem 的原始模型参数。 EN: Raw model arguments for Filesystem before validation. */
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

/** ZH: 支持的文件系统读与变更动作。 EN: Supported filesystem mutations and reads. */
export type FilesystemInputAction = 'read' | 'write' | 'edit' | 'delete';

/** ZH: 按 action 判别的成功文件系统结果。 EN: Discriminated successful filesystem result by action. */
export type FilesystemOutput =
    | { action: 'read'; path: string; content: string; bytes: number; truncated: boolean }
    | { action: 'write'; path: string; bytes: number }
    | { action: 'edit'; path: string; replacements: number; bytes: number }
    | { action: 'delete'; path: string };

/** ZH: 验证前 Shell 的原始模型参数。 EN: Raw model arguments for Shell before validation. */
export interface ShellInput {
    cwd?: unknown;
    command?: unknown;
    args?: unknown;
    timeoutMs?: unknown;
}

/** ZH: 含非零退出与超时的显式 shell 进程数据。 EN: Explicit shell process data including non-zero exits and timeouts. */
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

/** ZH: 验证前 Execute 的原始模型参数。 EN: Raw model arguments for Execute before validation. */
export interface ExecuteInput {
    cwd?: unknown;
    mode?: unknown;
    maxConcurrency?: unknown;
    tasks?: unknown;
}

/** ZH: Execute 任务批次的执行顺序。 EN: Batch execution order for Execute tasks. */
export type ExecuteMode = 'serial' | 'parallel';

/** ZH: 验证前单个 Execute 任务的原始模型参数。 EN: Raw model arguments for one Execute task before validation. */
export interface ExecuteTaskInput {
    id?: unknown;
    runtime?: unknown;
    path?: unknown;
    args?: unknown;
    cwd?: unknown;
    env?: unknown;
    timeoutMs?: unknown;
}

/** ZH: 一个已完成 Execute 任务的显式结果。 EN: Explicit result for one completed Execute task. */
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

/** ZH: 含逐任务进程数据的 Execute 批次汇总结果。 EN: Aggregated Execute batch outcome with per-task process data. */
export interface ExecuteOutput {
    action: 'execute';
    mode: ExecuteMode;
    cwd: string;
    total: number;
    success: number;
    failed: number;
    results: ExecuteTaskResult[];
}

/** ZH: 验证前 Task 的原始模型参数。 EN: Raw model arguments for Task before validation. */
export interface TaskInput {
    tasks?: unknown;
}

/** ZH: 验证前单个 Task 子项的原始模型参数。 EN: Raw model arguments for one Task child before validation. */
export interface TaskItemInput {
    agent?: unknown;
    goal?: unknown;
}

/** ZH: 供 Synapse 派发的已验证纯委派描述。 EN: Validated pure delegation descriptions for Synapse dispatch. */
export interface TaskOutput {
    tasks: Array<{ agent: string; goal: string }>;
}
