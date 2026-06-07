# TOOLS-PLAN

状态：仅为计划中的架构设计。本文档描述的执行层尚未实现。

本文档替代上一版工具运行时方案。旧方案把执行层过度拆成了 `ToolRegistry`、`ToolOrchestrator`、
`PermissionService`、`ProcessSessionService`、`PatchService` 和新的 `src/tool` 领域。Flyflor 不应该先长出
一个通用工具平台，而应该先长出大脑反射循环。

## 核心心智模型

Flyflor 正在被构建成类智能生命体的运行时，而不是一组 agent 工具函数。

当前目录模型已经暗示了正确设计：

```txt
IPC / Socket stimulus
  -> Synapse
  -> Agent
  -> Brain
  -> Reflection
      -> model signal
      -> tool impulse
      -> confirm interrupt
      -> child-agent investigation
      -> tool result signal
      -> continued thought
  -> Agent outward signal
  -> Socket / IPC
```

对象含义：

- `Brain` 是 turn owner。它拥有上下文组装、reflection 启动、成功上下文提交，以及失败或取消时的回滚。
- `Reflection` 是大脑内的一次神经反射弧。它是单个 turn 的执行层。
- `Synapse` 把外部刺激路由到 active agent。
- `Socket` 和 `IPC` 是外部信号边界。它们传输信号，不拥有交互语义。
- `PacketService` 只拥有字节 framing：8-byte big-endian length-prefixed JSON。
- `FTool` 对象是 reflection 可以触发的动作末梢。
- `task` 是多 agent 认知。它会启动多个 `src/agent` 实例做并行调查与综合。

重要命名规则：

- `confirm` 表示动作权限确认。
- `ask` 表示未来智能体缺少信息时的认知询问。
- 权限绝不能建模成 `ask`。

## 当前仓库现实

已有优势：

- IOC 构造已经集中在 `src/core/ioc/container.ts`。
- Prompt 文件已经是 path-bound `FileService` 对象。
- Prompt protocol blocks 已经会被解析成 `<flyflor:xxx>` JSONC blocks。
- `Brain.transformer()` 已经保持“只有成功完成才提交上下文”的不变量。
- `FSocket` 已经把流输出限制在发起请求的 socket，并追加 `streamEnd`。
- `src/plugins/tools` 已经存在，适合作为内核工具区域，但当前文件为空。
- 根目录 `./plugins` 已经存在，是外部能力的占位目录。

当前缺口：

- `IntelligenceTurn` 只有文本。
- `Brain` 没有 reflection loop。
- `Agent` 对外信号只有文本。
- `SocketEvent` 尚无 tool、confirm、task、cancel 信号。
- 没有 `FTool` scope。
- 没有外部插件 bridge。
- `task` 目前只是 prompt 意图，不是运行时多 agent 操作。
- `rtk` 和 `codegraph` 尚未通过 `./plugins` 安装或桥接。

## 执行层目标

第一目标：

- 在 `src/agent/brain/reflection.ts` 增加 `Reflection` 对象。
- 将 `Intelligence` 升级为结构化模型事件，同时保持文本兼容。
- 增加 `FTool` 和 `@Tool()` 作为最小 core scope。
- 在 `src/plugins/tools` 下以内核 `FTool` 对象实现内置 read/write/exec 工具。
- 为 write/execute 动作加入 `confirm` 中断。
- 将 `task` 实现为 foreground 多 agent 只读调查。
- 为 `./plugins/rtk` 和 `./plugins/codegraph` 增加小型外部插件桥。

第一阶段非目标：

- 不创建 `src/tool`。
- 不增加 `ToolRegistry`、`ToolOrchestrator`、`PermissionService`、`ProcessSessionService` 或 `PatchService`。
- 不实现通用 MCP。
- 不实现 browser-use 或 computer-use。
- 不允许子 agent 写文件。
- 不实现 background subagents。
- 不实现 `ask`。
- 不把外部插件脚本或二进制编进 Flyflor Bun 二进制。

## Reflection 设计

`Reflection` 由 `Brain` 按 turn 创建。

职责：

- 基于 system prompt、已有 context 和当前用户内容构建模型输入。
- 为当前 turn 暴露模型可见工具 schema。
- 消费结构化 `Intelligence` 事件。
- 立即向外流式输出 text delta。
- 执行工具调用。
- 当动作需要权限时在 `confirm` 处暂停。
- 在 inbound confirm 结果到达后恢复。
- 把工具结果追加进当前模型 turn。
- 通过 `task` 工具启动子 agent。
- 父 turn 取消时取消 provider stream、工具和子 agent。
- 把最终 assistant text 返回给 `Brain`，由 `Brain` 提交上下文。

内部事件词汇：

- `turnStart`
- `modelTextDelta`
- `modelToolCall`
- `toolStart`
- `toolDelta`
- `toolEnd`
- `toolError`
- `confirmRequested`
- `confirmResolved`
- `taskStart`
- `taskAgentStart`
- `taskAgentEnd`
- `taskEnd`
- `turnEnd`
- `turnError`
- `turnCancelled`

实现风格：

- 用 RxJS 表达 turn 事件流。
- 所有 turn-local 状态留在 `Reflection`。
- 长生命周期 agent context 所有权留在 `Brain`。
- socket transport 所有权留在 `neural/ipc`。
- 工具不能直接修改 `Brain.context`。

## Intelligence 事件

`Intelligence` 应从 `ReadableStream<string>` 演进为结构化事件流。

必要事件形态：

```ts
type IntelligenceEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'tool_call'; id: string; name: string; input: unknown }
    | { type: 'assistant_finish'; reason?: string }
    | { type: 'error'; error: Error };
```

兼容要求：

- `Brain.transformer()` 仍然是 `AsyncGenerator<string>`，服务现有调用方。
- `Intelligence.complete()` 仍可用，并拼接 `text_delta` 事件。
- text-only providers 继续通过现有测试。
- 不支持 tool-call 的 providers 可以保持 text-only，直到单独升级。

第一批 provider：

- `openaiResponses`
- `anthropicMessages`

后续 provider：

- `openaiChatCompletions`
- `googleGeminiGenerateContent`
- `ollama`
- 其他 adapter 只有在实现对应 tool-call wire shape 后再升级。

## Agent Signals And IPC

`Agent` 当前通过 `FAgent<string>` emit 字符串。Reflection 需要结构化 outward signals，同时保留旧文本流行为。

目标 signal union：

```ts
type AgentSignal =
    | string
    | { type: 'text'; data: string }
    | { type: 'tool'; action: SocketEvent; data: unknown }
    | { type: 'confirm'; action: SocketEvent; data: unknown }
    | { type: 'task'; action: SocketEvent; data: unknown };
```

Socket 兼容：

- signal 是字符串时，写 `{ action: SocketEvent.Data, data: signal }`。
- signal 是 `{ type: 'text' }` 时，写 `{ action: SocketEvent.Data, data: signal.data }`。
- signal 是结构化对象时，写其中的 action 和 data。
- `streamEnd` 仍由 `FSocket` 在 `Synapse.next()` 完成后写出。

新增 outbound socket events：

- `toolStart`
- `toolDelta`
- `toolEnd`
- `toolError`
- `confirmRequested`
- `confirmResolved`
- `taskStart`
- `taskAgentStart`
- `taskAgentEnd`
- `taskEnd`
- `turnEnd`

新增 inbound socket events：

- `confirm`
- `cancel`

Inbound `confirm` payload：

```ts
{
    id: string;
    confirmed: boolean;
    remember?: 'turn' | 'session';
}
```

Inbound `cancel` payload：

```ts
{
    turnId?: string;
    toolCallId?: string;
    taskId?: string;
    agentId?: string;
}
```

Socket 和 IPC 不解释这些 payload。它们只把 packet 路由回 `Synapse`，再进入 active `Agent` / `Brain`。

## Confirm 语义

第一版只支持动作确认。

状态：

- `none`：无需确认。
- `required`：reflection 必须暂停并发出 `confirmRequested`。
- `confirmed`：外部允许执行动作。
- `rejected`：外部拒绝执行动作。

默认规则：

- Read 工具不需要 confirm。
- Write 工具需要 confirm。
- Execute 工具需要 confirm。
- Dangerous 工具需要 confirm。
- V1 子 agent 只读，所以不能为 write/execute 工具请求 confirm。
- Confirm allowlist 只影响权限确认。
- Confirm allowlist 不是 `ask`。

`ask` 的未来保留语义：

- 缺少需求细节；
- 缺少用户偏好；
- 缺少外部事实；
- 任务意图模糊；
- 不是权限。

## 内置工具

内置工具作为 `FTool` 对象放在 `src/plugins/tools`。

最小工具形态：

```ts
interface FToolDefinition {
    name: string;
    description: string;
    inputSchema: unknown;
    level: 'read' | 'write' | 'execute' | 'dangerous';
    confirm: 'none' | 'required';
}
```

每个工具对象应暴露 execute 方法，接收 reflection context 和校验后的 input。

第一批内置工具：

- `read_file`
  - 读取 workspace 边界内 UTF-8 文本；
  - 无 confirm。
- `glob`
  - 列出 workspace 边界内匹配 pattern 的文件；
  - 无 confirm。
- `grep`
  - 搜索 workspace 边界内文件内容；
  - 无 confirm。
- `apply_patch`
  - 结构化 patch application；
  - 需要 confirm。
- `exec_command`
  - 有界进程执行；
  - 默认需要 confirm；
  - 长命令可以返回 session id。
- `write_stdin`
  - 向已有 process session 写入 stdin；
  - 需要 confirm。
- `todo`
  - turn-local progress state；
  - V1 不写长期记忆。
- `task`
  - 多 agent 调查；
  - V1 子 agent 只读。

实现约束：

- V1 工具发现应显式。`PluginsModule` import 内置工具类。不要在对象模型真正需要前增加宽泛动态发现。

## Task 多 Agent 设计

`task` 是 Flyflor coding 能力中最重要的工具。它不是普通 background task helper。

目的：

- 启动多个 `Agent` 实例做并行调查。
- 提升摘要、代码考古、影响分析和 patch planning。
- 让 master agent 保持最终写入所有权。

V1 行为：

- 仅 foreground。
- 子 agent 只读。
- 无递归 `task`。
- 子 agent 不写 memory。
- 子 agent 不直接与用户交互。
- 子 agent 不发 confirm。
- 子 agent 不直接编辑文件。
- 父 turn cancel 会取消正在运行的子 agent。

Task input：

```ts
{
    description: string;
    prompt: string;
    agents: Array<{
        label?: string;
        profile?: string;
        focus: string;
        expectedOutput?: string;
    }>;
    timeoutMs?: number;
    context?: string;
}
```

调度：

- 默认 child concurrency：3。
- V1 hard child concurrency：5。
- 默认 child timeout：120000 ms。
- 最大 child timeout：600000 ms。
- 单个 child 失败产生 `partial`。
- 全部 child 失败产生 `failed`。
- 结果按请求顺序返回，不按完成顺序返回。

子 agent 设置：

- 每个 child 都通过 IOC 构造。
- 每个 child 拥有独立 `Brain.context`。
- 继承父 agent 的 constitution prompt。
- 追加 task-specific instructions，强制只读调查。
- 只提供 read tools 和 CodeGraph read tools。
- 不暴露 `apply_patch`、写工具、任意 execute 工具、`todo` 或 `task`。

子 agent 必须输出的固定契约：

```txt
SUMMARY:
EVIDENCE:
PATCH_SUGGESTION:
RISKS:
BLOCKERS:
```

父 task result：

```ts
{
    taskId: string;
    status: 'completed' | 'partial' | 'failed' | 'cancelled';
    children: Array<{
        agentId: string;
        label: string;
        status: string;
        summary: string;
        evidence: string[];
        patchSuggestion?: string;
        risks: string[];
        blockers: string[];
    }>;
    synthesis: string;
}
```

父 `Reflection` 把 task result 当作 tool result 接收。父模型决定如何综合、验证，以及是否在 confirm 后执行写动作。

## 外部插件层

根 `./plugins` 是外部器官层，与 `src/plugins` 分离。

目标：

- 支持二进制或多语言外部能力，而不把它们编译进 Flyflor。
- 让第三方安装和 runtime 脚本留在 `src` 之外。
- 为未来 Scrapling、browser-use、computer-use 等能力预留路径。
- 通过 stdio JSONL 让插件通信保持确定性。

目录契约：

```txt
plugins/
  rtk/
    plugin.json
    install.ts
    bridge.ts
    bin/
    cache/
  codegraph/
    plugin.json
    install.ts
    bridge.ts
    bin/
    cache/
```

规则：

- `bridge.ts` 在插件目录下用 Bun 运行。
- `bridge.ts` 不被 `src` import。
- `bridge.ts` 不编译进 Flyflor 二进制。
- `bin/` 存本地下载的 executable，不提交。
- `cache/` 存插件本地状态，不提交。
- Bridge stdout 只能输出 JSONL 协议。
- Bridge logs 写 stderr。
- 缺失 binary 时返回 typed error。
- Install scripts 只能由明确用户动作触发，不能由模型自主 tool call 触发。

最小 manifest：

```json
{
  "name": "codegraph",
  "version": 1,
  "runtime": {
    "kind": "bun-stdio",
    "entry": "./bridge.ts"
  },
  "install": {
    "entry": "./install.ts"
  },
  "tools": [
    {
      "name": "codegraph_search",
      "level": "read",
      "confirm": "none"
    }
  ]
}
```

内核侧：

- 在 `src/plugins/service.ts` 增加小型 `PluginsService extends FPlugin`。
- 它读取 `./plugins/*/plugin.json`。
- 它启动并复用 bridge processes。
- 它把 bridge tools 转换成 reflection-visible tools。
- 它不是通用 `ToolRegistry`。

## Plugin Bridge 协议

通信使用 stdio JSONL。

Request types：

```ts
type PluginRequest =
    | { id: string; type: 'handshake'; cwd: string; workspaceRoot: string }
    | { id: string; type: 'tools' }
    | { id: string; type: 'call'; tool: string; input: unknown; cwd: string; signal?: { timeoutMs?: number } }
    | { id: string; type: 'cancel'; callId: string };
```

Response types：

```ts
type PluginResponse =
    | { id: string; type: 'ready'; name: string; tools: PluginToolSpec[] }
    | {
          id: string;
          type: 'result';
          status: 'completed' | 'error' | 'cancelled';
          content: string;
          data?: unknown;
          truncated?: boolean;
          metadata?: unknown;
      }
    | { id: string; type: 'delta'; content: string; metadata?: unknown }
    | { id: string; type: 'error'; message: string; code?: string; detail?: unknown };
```

协议规则：

- 每个 response 都保留 request id。
- stdout 中非法行都是 protocol error。
- stderr 是日志，不是协议。
- call 有 timeout。
- cancel 先发送 `cancel`；如果插件无法停止调用，host 可以 kill bridge。
- bridge startup 必须在任何 tool call 前完成 `handshake`。

## RTK Plugin

上游：`https://github.com/rtk-ai/rtk`

目的：

- 压缩、过滤和结构化嘈杂命令输出。
- 改进 tests、search、git output、logs、build output 的 coding loop。
- 作为执行输出增强器，而不是权限绕过器。

V1 tools：

- `rtk_command`
  - level：`execute`
  - confirm：`required`
  - input：command、cwd、timeoutMs
  - 行为：通过 RTK 运行请求命令并返回 compact output。
- `rtk_gain`
  - level：`read`
  - confirm：`none`
  - 行为：在可用时返回 RTK savings / usage stats。
- `rtk_discover`
  - level：`read`
  - confirm：`none`
  - 行为：报告 RTK 可优化的命令。

与 `exec_command` 的集成：

- 不强制所有命令都经过 RTK。
- 对 tests、type checks、`git diff`、`git status`、search、logs 等有界且嘈杂的命令优先使用 RTK。
- wrapping 前先保留原始命令的 permission classification。
- wrapping 永远不能降低 confirm 要求。

安装行为：

- `plugins/rtk/install.ts` 为当前 OS/arch 下载匹配 release 或 package。
- executable 存到 `plugins/rtk/bin/`。
- installer 通过 `rtk --version` 验证。
- 不运行会修改其他 agent 配置的 global shell-hook setup。

## CodeGraph Plugin

上游：`https://github.com/colbymchenry/codegraph`

目的：

- 提供快速本地代码图谱调查。
- 提升摘要、影响分析和多 agent research。
- 减少盲目的 `grep` / `read_file` 探索。

重要行为：

- CodeGraph 会在 workspace 下创建本地图谱状态 `.codegraph/`。
- 它存在 MCP server，但 V1 Flyflor 先使用 CLI bridge。
- MCP integration 等 Flyflor 有通用 MCP bridge 后再做。

V1 tools：

- `codegraph_status`
  - level：`read`
  - confirm：`none`
  - 行为：检查 graph / index health。
- `codegraph_init`
  - level：`execute`
  - confirm：`required`
  - 行为：为 workspace 初始化 CodeGraph。
- `codegraph_sync`
  - level：`execute`
  - confirm：`required`
  - 行为：同步/更新本地图谱。
- `codegraph_search`
  - level：`read`
  - confirm：`none`
  - 行为：semantic 或 symbol-oriented search。
- `codegraph_context`
  - level：`read`
  - confirm：`none`
  - 行为：收集任务相关代码上下文。
- `codegraph_callers`
  - level：`read`
  - confirm：`none`
  - 行为：查看 symbol callers。
- `codegraph_callees`
  - level：`read`
  - confirm：`none`
  - 行为：查看 symbol callees。
- `codegraph_impact`
  - level：`read`
  - confirm：`none`
  - 行为：估算修改影响。

默认规则：

- 如果 `.codegraph/` 不存在，read tools 返回 `not_initialized` 和建议下一步。
- 不自动初始化。
- `codegraph_init` 和 `codegraph_sync` 需要 confirm 和 workspace-level lock。
- 子 agent 可以使用只读 CodeGraph tools。
- 子 agent 不能执行 init 或 sync。
- 多个子 agent 并行 read query 允许。

## Prompt Blocks

使用已有 `FileService.blocks`，不增加新 prompt parser。

Tools block：

```md
<flyflor:tools>
{
    version: 1,
    allowed: [
        "read_file",
        "glob",
        "grep",
        "apply_patch",
        "exec_command",
        "write_stdin",
        "todo",
        "task",
        "rtk_command",
        "rtk_gain",
        "rtk_discover",
        "codegraph_status",
        "codegraph_search",
        "codegraph_context",
        "codegraph_callers",
        "codegraph_callees",
        "codegraph_impact"
    ],
    confirmAlways: ["apply_patch", "exec_command", "write_stdin", "rtk_command", "codegraph_init", "codegraph_sync"]
}
</flyflor:tools>
```

Reflection block：

```md
<flyflor:reflection>
{
    version: 1,
    maxToolCalls: 32,
    maxTaskAgents: 3,
    taskTimeoutMs: 120000
}
</flyflor:reflection>
```

默认：

- 没有 blocks 时，只启用内置 read tools。
- `task` 只有在 read-only child mode 下才可默认启用。
- write 和 execute 工具需要 confirm。
- plugin install 和 plugin mutation actions 需要 confirm。

## 实现阶段

每个阶段都应足够小，可以独立 review 和验证。

### Phase 1: Plan Docs

- 重写 `TOOLS-PLAN.md`。
- 新增或同步 `TOOLS-PLAN.zh.cn.md`。
- 不修改 runtime code。

验证：

- `bun run check`

### Phase 2: Core Reflection Types

- 增加 `FTool`。
- 增加 `@Tool()`。
- 增加 `AgentSignal`。
- 增加 reflection event 和 tool definition types。
- 暂不接真实工具。

验证：

- `bun run check`
- 通过 `bunx tsc --noEmit` 做 focused type-checking。

### Phase 3: Brain Reflection Shell

- 增加 `src/agent/brain/reflection.ts`。
- 让 text-only model output 先经过 `Reflection`。
- 保持 `Brain.transformer()` 外部行为。
- 保持成功才提交 context。

验证：

- 现有 `brain.test.ts`
- 现有 `socket.test.ts`

### Phase 4: Structured Intelligence Events

- 增加 `text_delta` 和 `assistant_finish` event 支持。
- 保持 `complete()` 兼容。
- 保持 text-only adapters 工作。
- 暂不启用 tool calls。

验证：

- 现有 `intelligence.test.ts`

### Phase 5: Built-In Read Tools

- 实现 `read_file`。
- 实现 `glob`。
- 实现 `grep`。
- 向 `Reflection` 暴露 schemas。
- 把 tool results 回灌模型 turn。

验证：

- path escape rejection；
- read tools 不需要 confirm；
- tool result 出现在下一次 model request。

### Phase 6: Confirm

- 增加 `confirmRequested` 和 `confirmResolved` signals。
- 增加 inbound `confirm` routing。
- Reflection 等待期间暂停。
- confirm 后恢复或拒绝 tool call。
- 不使用 `ask`。

验证：

- confirmed calls 会执行；
- rejected calls 不执行；
- cancel 会释放 pending confirm；
- 测试断言 permission path 不 emit `ask`。

### Phase 7: Write And Exec Tools

- 实现 `apply_patch`。
- 实现 `exec_command`。
- 实现 `write_stdin`。
- 增加 timeout、truncation、cancellation 和 process session ids。
- write / execute tools 需要 confirm。

验证：

- patch context mismatch rejection；
- shell timeout handling；
- stdin to existing session；
- 默认 confirm required。

### Phase 8: Task Tool V1

- 实现 foreground `task`。
- 通过 IOC spawn 多个 child `Agent` 实例。
- 为每个 child 设置 isolated context 和 read-only tools。
- 收集结构化 reports。
- 给 parent reflection 返回稳定排序的 synthesis。

验证：

- child context isolation；
- child 不能写；
- 一个 child 失败时结果是 partial；
- parent cancellation 会取消 children。

### Phase 9: External Plugin Bridge

- 增加 `src/plugins/types.ts`。
- 增加 `src/plugins/service.ts`。
- 读取 `./plugins/*/plugin.json`。
- 启动 `bun bridge.ts`。
- 实现 JSONL handshake、tools、call、cancel。
- 把 plugin responses 转成 reflection tool events。

验证：

- fake plugin bridge tests；
- invalid JSONL handling；
- timeout and cancel；
- stderr 不影响协议。

### Phase 10: RTK Plugin

- 增加 `plugins/rtk/plugin.json`。
- 增加 `plugins/rtk/install.ts`。
- 增加 `plugins/rtk/bridge.ts`。
- 实现 `rtk_command`、`rtk_gain`、`rtk_discover`。
- 可选让 `exec_command` 对嘈杂命令选择 RTK wrapping。

验证：

- missing binary typed error；
- `rtk_command` requires confirm；
- `rtk_gain` requires no confirm；
- RTK wrapping 不降低 permission classification。

### Phase 11: CodeGraph Plugin

- 增加 `plugins/codegraph/plugin.json`。
- 增加 `plugins/codegraph/install.ts`。
- 增加 `plugins/codegraph/bridge.ts`。
- 实现 status、init、sync、search、context、callers、callees、impact。
- 让 CodeGraph read tools 对 task children 可用。
- init/sync 只允许 parent 执行。

验证：

- 没有 `.codegraph/` 时返回 `not_initialized`；
- init/sync 需要 confirm；
- child agents 不能 init/sync；
- parallel read queries 稳定。

### Phase 12: Docs And Mirror Cleanup

- 只有代码存在后才更新 architecture docs。
- 保持所有 `.md` mirror 成对。
- 确保 runtime 不读 `.zh.cn.md`。

验证：

- `bun run check`

## 测试计划

最低 focused coverage：

- `Brain` text compatibility 和 context commit/rollback。
- `Reflection` text、tool、confirm、cancel、error、task paths。
- `Intelligence` 针对支持 provider 的 structured events。
- `Socket` 对 `data` 和 `streamEnd` 的兼容。
- `Socket` 对 tool、confirm、task events 的 structured signals。
- 内置 read tools 和 workspace path safety。
- Patch validation 和 mismatch handling。
- Exec timeout、truncation、cancellation、stdin。
- Task child context isolation 和 read-only enforcement。
- Plugin host handshake、call、delta、result、error、timeout、cancel。
- RTK permission preservation。
- CodeGraph init/sync locks 和 child read-only access。

健康门禁：

- `bun run check`
- 针对变更边界的 focused `bun test`
- 大阶段完成前跑更广泛的 `bun test`

## 开放风险

- `Intelligence` provider adapters 可能需要不同 tool result message 格式。
- `AgentSignal` 迁移如果不严格保持兼容，可能破坏 socket tests。
- Confirm pause/resume 需要仔细处理 pending-turn ownership，避免并发 socket 串信号。
- 子 agent 会快速放大 token 用量，V1 必须强制 concurrency caps。
- CodeGraph sync 如果没有 workspace lock，可能与 child read query 竞争。
- RTK wrapping 不能隐藏 command failure，也不能降低 confirm 要求。
- Plugin install scripts 需要确定性 OS/arch 处理和 typed failure modes。

## 非目标

- V1 不做通用 MCP bridge。
- V1 不做 browser-use 或 computer-use。
- V1 不做 background child agents。
- V1 不做 persistent task ledger。
- V1 不允许 child-agent writes。
- V1 不允许 recursive task。
- 不做 permission `ask`。
- 不为 RTK 安装 global shell hook。
- 不把 plugin binary 编译进 Flyflor。
