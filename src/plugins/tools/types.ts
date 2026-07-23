import type { ToolError, ToolRisk } from '@/core';

/**
 * EN: Wire protocol description of one tool exposed to the model.
 * ZH: 暴露给模型的单个工具的协议描述。
 */
export interface ToolProtocol {
    /** EN: Stable tool key derived from the atom class name. ZH: 由工具原子类名推导的稳定 key。 */
    key: string;
    /** EN: Tool name sent to the model. ZH: 发送给模型的工具名。 */
    name: string;
    /** EN: Prompt file backing this tool's description. ZH: 提供该工具描述的 prompt 文件。 */
    file: string;
    /** EN: Declared risk level of the tool. ZH: 工具声明的风险等级。 */
    risk: ToolRisk;
    /** EN: When 'inject', the runtime injects a working directory into calls. ZH: 为 'inject' 时，运行时会向调用注入工作目录。 */
    cwd?: 'inject';
    /** EN: JSON-schema-style parameter definition passed to the model. ZH: 传给模型的 JSON schema 风格参数定义。 */
    parameters: Record<string, unknown>;
}

/**
 * EN: Tool prompt package configuration loaded from `prompts/tools`.
 * ZH: 从 `prompts/tools` 加载的工具提示词包配置。
 */
export interface ToolPromptConfig {
    /** EN: Prompt package schema version. ZH: 提示词包的 schema 版本。 */
    version: number;
    /** EN: Human-readable package description. ZH: 可读的包描述。 */
    description: string;
    /** EN: Tool protocol entries declared by the package. ZH: 包声明的工具协议条目。 */
    tools: ToolProtocol[];
}

/**
 * EN: One model-requested tool call.
 * ZH: 模型请求的一次工具调用。
 */
export interface ActionRequest {
    /** EN: Unique call identifier used to match results back to requests. ZH: 用于将结果匹配回请求的唯一调用标识。 */
    id: string;
    /** EN: Name of the tool being invoked. ZH: 被调用的工具名。 */
    name: string;
    /** EN: Raw argument payload validated by the target atom. ZH: 由目标原子校验的原始参数载荷。 */
    arguments: Record<string, unknown>;
}

/**
 * EN: Normalized tool call result returned to the model loop.
 * ZH: 返回给模型循环的标准化工具调用结果。
 */
export interface ToolRunResult {
    /** EN: Whether the tool call succeeded. ZH: 工具调用是否成功。 */
    ok: boolean;
    /** EN: Echo of the invoked tool name. ZH: 回显的被调用工具名。 */
    name: string;
    /** EN: Success payload produced by the tool. ZH: 工具产出的成功载荷。 */
    data?: unknown;
    /** EN: Normalized failure details when `ok` is false. ZH: `ok` 为 false 时的标准化失败信息。 */
    error?: ToolError;
}

/**
 * EN: Persistable request/result pair for a tool call.
 * ZH: 可持久化的一次工具请求与结果。
 */
export interface ActionRecord {
    /** EN: The original tool call request. ZH: 原始工具调用请求。 */
    request: ActionRequest;
    /** EN: The normalized result of that request. ZH: 该请求对应的标准化结果。 */
    result: ToolRunResult;
}

/**
 * EN: One selectable option in an ask question.
 * ZH: ask 问题中的一个可选项。
 */
export interface AskOption {
    /** EN: Short option label shown to the user. ZH: 展示给用户的简短选项标签。 */
    label: string;
    /** EN: Optional explanation of the option. ZH: 选项的可选说明。 */
    description?: string;
    /** EN: Marks the model-preferred option. ZH: 标记模型推荐的选项。 */
    recommended?: boolean;
    /** EN: Marks the appended free-form "other" option. ZH: 标记追加的自由作答 "other" 选项。 */
    custom?: boolean;
}

/**
 * EN: One validated ask question with its candidate options.
 * ZH: 一个校验后的 ask 问题及其候选选项。
 */
export interface AskQuestion {
    /** EN: Question text shown to the user. ZH: 展示给用户的问题文本。 */
    question: string;
    /** EN: Candidate answers, including the appended custom option. ZH: 候选答案，包含追加的自定义选项。 */
    options: AskOption[];
}

/**
 * EN: Raw ask tool input as received from the model, before validation.
 * ZH: 从模型接收的、校验前的原始 ask 工具输入。
 */
export interface AskInput {
    /** EN: Raw questions payload; must be a non-empty array after validation. ZH: 原始 questions 载荷；校验后必须是非空数组。 */
    questions?: unknown;
}

/**
 * EN: Validated ask tool output handed to the interaction layer.
 * ZH: 交给交互层的校验后 ask 工具输出。
 */
export interface AskOutput {
    /** EN: Discriminator literal identifying ask output. ZH: 标识 ask 输出的判别字面量。 */
    kind: 'ask';
    /** EN: Validated questions to present to the user. ZH: 要呈现给用户的校验后问题。 */
    questions: AskQuestion[];
}

/**
 * EN: Raw confirm tool input as received from the model, before validation.
 * ZH: 从模型接收的、校验前的原始 confirm 工具输入。
 */
export interface ConfirmInput {
    /** EN: Raw question payload; must be a non-empty string after validation. ZH: 原始问题载荷；校验后必须是非空字符串。 */
    question?: unknown;
    /** EN: Raw recommended flag; must be a boolean after validation. ZH: 原始 recommended 标记；校验后必须是布尔值。 */
    recommended?: unknown;
}

/**
 * EN: Validated confirm tool output handed to the interaction layer.
 * ZH: 交给交互层的校验后 confirm 工具输出。
 */
export interface ConfirmOutput {
    /** EN: Discriminator literal identifying confirm output. ZH: 标识 confirm 输出的判别字面量。 */
    kind: 'confirm';
    /** EN: Validated confirmation question text. ZH: 校验后的确认问题文本。 */
    question: string;
    /** EN: Whether the model recommends approving the action. ZH: 模型是否建议批准该操作。 */
    recommended: boolean;
}

/**
 * EN: Raw filesystem tool input as received from the model, before validation.
 * ZH: 从模型接收的、校验前的原始 filesystem 工具输入。
 */
export interface FilesystemInput {
    /** EN: Raw action selector; must be read/write/edit/delete after validation. ZH: 原始操作选择器；校验后必须是 read/write/edit/delete。 */
    action?: unknown;
    /** EN: Raw working-directory override for relative paths. ZH: 相对路径使用的原始工作目录覆盖项。 */
    cwd?: unknown;
    /** EN: Raw target file path. ZH: 原始目标文件路径。 */
    path?: unknown;
    /** EN: Raw zero-based start line for read; defaults to 0. ZH: read 使用的原始起始行（从 0 开始）；默认为 0。 */
    offsetLines?: unknown;
    /** EN: Raw maximum line count for read; defaults to 200. ZH: read 的原始最大行数；默认为 200。 */
    limitLines?: unknown;
    /** EN: Raw maximum byte count for read; defaults to 20000. ZH: read 的原始最大字节数；默认为 20000。 */
    limitBytes?: unknown;
    /** EN: Raw file content for write. ZH: write 使用的原始文件内容。 */
    content?: unknown;
    /** EN: Raw search text for edit. ZH: edit 使用的原始查找文本。 */
    oldText?: unknown;
    /** EN: Raw replacement text for edit. ZH: edit 使用的原始替换文本。 */
    newText?: unknown;
}

/**
 * EN: Filesystem actions supported by the filesystem atom.
 * ZH: filesystem 原子支持的操作类型。
 */
export type FilesystemInputAction = 'read' | 'write' | 'edit' | 'delete';

/**
 * EN: Discriminated filesystem tool output, one variant per action.
 * ZH: filesystem 工具的可判别输出，每种 action 对应一个变体。
 */
export type FilesystemOutput =
    /** EN: Read result with content, byte count, and truncation flag. ZH: read 结果，含内容、字节数与截断标记。 */
    | { action: 'read'; path: string; content: string; bytes: number; truncated: boolean }
    /** EN: Write result with written byte count. ZH: write 结果，含写入字节数。 */
    | { action: 'write'; path: string; bytes: number }
    /** EN: Edit result with replacement count and new byte count. ZH: edit 结果，含替换次数与新字节数。 */
    | { action: 'edit'; path: string; replacements: number; bytes: number }
    /** EN: Delete result carrying only the removed path. ZH: delete 结果，仅携带被删除路径。 */
    | { action: 'delete'; path: string };

/**
 * EN: Raw shell tool input as received from the model, before validation.
 * ZH: 从模型接收的、校验前的原始 shell 工具输入。
 */
export interface ShellInput {
    /** EN: Raw working directory; defaults to the process cwd. ZH: 原始工作目录；默认取进程 cwd。 */
    cwd?: unknown;
    /** EN: Raw command to execute. ZH: 待执行的原始命令。 */
    command?: unknown;
    /** EN: Raw argument list; scalars are stringified. ZH: 原始参数列表；标量会被字符串化。 */
    args?: unknown;
    /** EN: Raw timeout in milliseconds; clamped to 1000–120000, default 30000. ZH: 原始超时毫秒数；会被钳制到 1000–120000，默认 30000。 */
    timeoutMs?: unknown;
}

/**
 * EN: Shell tool output capturing one finished command run.
 * ZH: 记录一次命令执行结果的 shell 工具输出。
 */
export interface ShellOutput {
    /** EN: Discriminator literal identifying shell output. ZH: 标识 shell 输出的判别字面量。 */
    action: 'shell';
    /** EN: Working directory the command ran in. ZH: 命令执行时的工作目录。 */
    cwd: string;
    /** EN: Command that was executed. ZH: 被执行的命令。 */
    command: string;
    /** EN: Arguments passed to the command. ZH: 传给命令的参数。 */
    args: string[];
    /** EN: Process exit code; null when the process failed to spawn. ZH: 进程退出码；进程启动失败时为 null。 */
    exitCode: number | null;
    /** EN: Captured standard output. ZH: 捕获的标准输出。 */
    stdout: string;
    /** EN: Captured standard error. ZH: 捕获的标准错误。 */
    stderr: string;
    /** EN: Whether the run was killed for exceeding its timeout. ZH: 本次执行是否因超时被终止。 */
    timedOut: boolean;
}

/**
 * EN: Raw execute tool input as received from the model, before validation.
 * ZH: 从模型接收的、校验前的原始 execute 工具输入。
 */
export interface ExecuteInput {
    /** EN: Raw batch working directory; defaults to the process cwd. ZH: 原始批次工作目录；默认取进程 cwd。 */
    cwd?: unknown;
    /** EN: Raw scheduling mode; defaults to serial. ZH: 原始调度模式；默认为 serial。 */
    mode?: unknown;
    /** EN: Raw parallel concurrency cap; defaults to the task count. ZH: 原始并行并发上限；默认为任务数。 */
    maxConcurrency?: unknown;
    /** EN: Raw task list; must be a non-empty array after validation. ZH: 原始任务列表；校验后必须是非空数组。 */
    tasks?: unknown;
}

/**
 * EN: Task scheduling modes supported by the execute atom.
 * ZH: execute 原子支持的任务调度模式。
 */
export type ExecuteMode = 'serial' | 'parallel';

/**
 * EN: Raw per-task execute input as received from the model, before validation.
 * ZH: 从模型接收的、校验前的单任务原始 execute 输入。
 */
export interface ExecuteTaskInput {
    /** EN: Raw caller-chosen task label. ZH: 调用方指定的原始任务标签。 */
    id?: unknown;
    /** EN: Raw script runtime; must be python or sh. ZH: 原始脚本运行时；必须是 python 或 sh。 */
    runtime?: unknown;
    /** EN: Raw script path, absolute or relative to the task cwd. ZH: 原始脚本路径，可为绝对路径或相对任务 cwd。 */
    path?: unknown;
    /** EN: Raw argument list; scalars are stringified. ZH: 原始参数列表；标量会被字符串化。 */
    args?: unknown;
    /** EN: Raw per-task working-directory override. ZH: 原始的单任务工作目录覆盖项。 */
    cwd?: unknown;
    /** EN: Raw extra environment variables for the task process. ZH: 传给任务进程的原始额外环境变量。 */
    env?: unknown;
    /** EN: Raw per-task timeout in milliseconds; clamped to 1000–120000, default 30000. ZH: 原始单任务超时毫秒数；会被钳制到 1000–120000，默认 30000。 */
    timeoutMs?: unknown;
}

/**
 * EN: Normalized result of one executed task.
 * ZH: 单个已执行任务的规范化结果。
 */
export interface ExecuteTaskResult {
    /** EN: Caller-chosen task label, when provided. ZH: 调用方指定的任务标签（若提供）。 */
    id?: string;
    /** EN: Script runtime used by the task. ZH: 任务使用的脚本运行时。 */
    runtime: 'python' | 'sh';
    /** EN: Resolved absolute script path. ZH: 解析后的脚本绝对路径。 */
    path: string;
    /** EN: Resolved working directory the task ran in. ZH: 任务执行时解析后的工作目录。 */
    cwd: string;
    /** EN: Arguments passed to the script. ZH: 传给脚本的参数。 */
    args: string[];
    /** EN: Process exit code; null when the process failed to spawn. ZH: 进程退出码；进程启动失败时为 null。 */
    exitCode: number | null;
    /** EN: Captured standard output. ZH: 捕获的标准输出。 */
    stdout: string;
    /** EN: Captured standard error or the spawn failure message. ZH: 捕获的标准错误，或进程启动失败的信息。 */
    stderr: string;
    /** EN: Whether the task was killed for exceeding its timeout. ZH: 任务是否因超时被终止。 */
    timedOut: boolean;
    /** EN: Whether the task exited with code 0 and did not time out. ZH: 任务是否以退出码 0 结束且未超时。 */
    ok: boolean;
    /** EN: Wall-clock duration of the task in milliseconds. ZH: 任务的墙钟耗时（毫秒）。 */
    durationMs: number;
}

/**
 * EN: Execute tool output aggregating one finished task batch.
 * ZH: 聚合一个已完成任务批次的 execute 工具输出。
 */
export interface ExecuteOutput {
    /** EN: Discriminator literal identifying execute output. ZH: 标识 execute 输出的判别字面量。 */
    action: 'execute';
    /** EN: Scheduling mode the batch ran with. ZH: 批次实际使用的调度模式。 */
    mode: ExecuteMode;
    /** EN: Resolved batch working directory. ZH: 解析后的批次工作目录。 */
    cwd: string;
    /** EN: Total number of tasks in the batch. ZH: 批次中的任务总数。 */
    total: number;
    /** EN: Number of tasks that succeeded. ZH: 成功的任务数。 */
    success: number;
    /** EN: Number of tasks that failed. ZH: 失败的任务数。 */
    failed: number;
    /** EN: Per-task results in submission order. ZH: 按提交顺序排列的逐任务结果。 */
    results: ExecuteTaskResult[];
}
