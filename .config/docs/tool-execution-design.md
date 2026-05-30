# ToolModule 工具执行层设计

## 目标

ToolModule 是 coding agent 的执行层。它必须支持探索、读写、多点编辑、命令执行、记忆读写、上下文压缩、子代理、RTK 输出压缩和 CodeGraph 代码图增强。

所有工具必须是类或组件，不允许散落过程式函数。工具执行必须经过统一 registry、参数校验、guard、SignalBus 事件、artifact 记录、输出预算化。

## 非目标

- 第一阶段不做完整插件市场。
- 不把工具直接写进 `AgentRuntimeService`。
- 不绕过 guard 直接写文件或执行 shell。
- 不让 RTK 或 CodeGraph 成为 agent 启动硬依赖；缺失时必须有明确 fallback 或错误事件。

## 工具接口

每个工具实现同一最小接口：

- `name`：稳定工具名。
- `description`：给模型看的用途。
- `schema`：参数 schema。
- `execute(input, context)`：执行并返回结构化结果。

`ToolContext` 必须包含：

- `turnId`
- `cwd`
- `signalBus`
- `memoryComponent`
- `artifactWriter`
- `guardPolicy`
- `budget`

## 工具清单

`ReadTool` 读取文件片段。必须支持 offset/limit，避免一次读入超大文件。

`WriteTool` 创建或覆盖文件。必须经过 guard。默认禁止写 `.config/config.jsonc`，除非当前计划明确允许。

`EditTool` 单点编辑。必须检查 old text 唯一匹配或显式策略。

`MultiEditTool` Claude Code 风格多点编辑。所有 edit 必须先 dry-run 匹配，通过后一次性提交；任一失败则全部失败。

`GlobTool` 根据 glob 查文件。

`GrepTool` 基于 `rg` 搜索文本。`rg` 不存在才 fallback。

`ShellTool` 执行命令。默认经 guard，输出进入 RTK 压缩管线。

`GitTool` 负责 git status、diff、log、show 等。写操作必须经过 guard，禁止 destructive 命令默认执行。

`MemoryRecallTool` 从 MemoryComponent 召回记忆。

`MemoryStoreTool` 写入长期记忆。

`MemoryForgetTool` 删除或标记遗忘记忆。

`ContextCompactTool` 手动触发 checkpoint summary。

`TaskTool` OpenCode 风格子代理入口。第一阶段映射到 workmux/cmux lane，而不是隐藏后台 agent。

`RTKTool` 或 `RTKComponent` 压缩命令输出。它是 ShellTool 的输出管线增强，不替代命令执行。

`CodeGraphTool` 负责代码图索引与查询，包括 index、sync、search symbol、impact radius、buildContext、status。

## RTK 集成

RTK 用于压缩常见命令输出，提高模型读取效率。

策略：

- ShellTool 先执行真实命令。
- 原始 stdout/stderr 写入 `.config/memory/artifacts`。
- 如果 RTK 可用，用 RTK 生成压缩视图给模型。
- 如果 RTK 不可用，返回原始截断输出并标记 `compression=none`。
- 不允许只保存压缩输出而丢弃原始输出。

参考：`https://github.com/rtk-ai/rtk`。

## CodeGraph 集成

CodeGraph 用于增强探索能力，减少纯文本 grep 的盲扫成本。

策略：

- CodeGraph 索引缓存放在 `.config/codegraph`。
- CodeGraphTool 先尝试本地 CLI 或 TS API。
- 如果 CodeGraph 不可用，回退到 `rg`、glob、手工文件读取。
- CodeGraph 结果可以进入 memory，但 `.config/codegraph` 自身不是记忆权威源。

参考：`https://github.com/colbymchenry/codegraph`。

## 工具事件

工具必须通过 SignalBus 产生事件：

- `tool.call`
- `tool.result`
- `tool.error`
- `tool.artifact`
- `guard.ask`
- `guard.answer`

Socket 层只订阅并广播这些事件，不直接执行工具。

## 验收标准

- 每个工具都有 class、JSDoc、schema、结构化结果。
- ShellTool 能执行只读命令并产生 artifact。
- RTK 缺失不会阻断 ShellTool。
- MultiEditTool 能做到全成功或全失败。
- CodeGraphTool 可报告可用性；不可用时明确 fallback。
- 工具事件能在 WebSocket 测试页显示。
- MemoryForgetTool 必须真实删除指定 memory chunk 和向量数据。
- ContextCompactTool 必须真实写入 `context_checkpoints`，不能只返回占位文本。
