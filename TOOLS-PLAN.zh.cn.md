# TOOLS-PLAN

状态：本文档只做调研与方案设计，尚未实现任何运行时代码。

本方案基于对当前 Flyflor 仓库代码（`src/`、`scripts/`、tests、prompts、docs）以及本地参考目录 `reference/codex`、`reference/claude-code`、`reference/opencode`、`reference/openhuman`、`reference/openclaw`、`reference/nanobot`、`reference/CodeWhale`、`reference/hermes-agent` 的通读整理。

## 目标

Flyflor 需要一个真正的工具执行层，它必须：

- 贴合当前 object-first 运行时；
- 保持 IOC 是唯一构造边界；
- 保持现有 8-byte big-endian IPC frame 协议；
- 明确区分内核插件加载边界（`src/plugins`）和仓库根外部工具层（`./plugins`）；
- 支持 tool call、审批、sandbox、多步执行和 subagent，而不是退化成一堆散落函数。

第一阶段的非目标：

- 不追求一次性做齐所有工具；
- 不把 browser/computer/rtk/codegraph 直接打进 Bun 主体二进制；
- 不整套照搬 Codex / opencode / openhuman 的架构；
- 在工具层逐步接入期间，不破坏当前的文本流输出行为。

## 当前 Flyflor 现状审计

### 已有基础

1. IOC 和生命周期已经足够承载工具层。
   - `src/core/ioc/container.ts` 已经支持 singleton、fresh `create()`、属性注入、构造函数 import 解析和 `@Init()`。
   - `src/core/ioc/abstracts.ts` 已经有 service、module、file、plugin、guard、sandbox、agent 等运行时对象边界。

2. Prompt / File 已经提供策略通道。
   - `src/core/file/service.ts` 已经能解析 `<flyflor:xxx>` JSONC blocks。
   - `src/core/prompt/decorator.ts` 已经通过 IOC 加载 path-bound prompt file object。

3. 当前运行时仍然是窄文本流模型。
   - `src/agent/brain/brain.ts` 负责组装单个 `system` message、附加文本历史，并从 `Intelligence` 流出文本 delta。
   - `src/agent/brain/intelligence/*` 仍然只是 provider 文本流层，不是 tool event 层。

4. IPC 已经小而稳定。
   - `src/neural/packet/service.ts` 拥有 8-byte length-prefixed JSON 协议。
   - `src/neural/ipc/socket.ts` 负责把入站 packet 路由到 `Synapse`，并把文本流和 `streamEnd` 回推给客户端。

5. 插件边界只在命名上存在。
   - `src/plugins/plugin.module.ts` 现在还是空 module boundary。

6. Config 里已经有部分落点。
   - `src/config/config.component.ts` 已经有 `mcp`。
   - 也有 `skills`，但不应该误用成可执行插件运行时。

### 当前缺口

1. 没有 tool-call event model。
   - `IntelligenceTurn` 只会返回 `{ done, value?: string }`。
   - provider 不会产出 tool call、tool result、approval request 或结构化 part。

2. 没有 tool loop。
   - `Brain.transformer()` 现在只会读一个 provider 文本流并直接提交文本。
   - 还不存在“模型发起工具调用 -> 工具执行 -> 结果回灌模型”的回合内循环。

3. 没有权限对象和审批状态。
   - `FGuard` 和 `FSandBox` 已经有 scope，但没有任何运行时服务把它们接到工具策略上。

4. 没有结构化文件编辑路径。
   - Flyflor 有 `FileService`，但没有 patch grammar、diff object 或 multi-edit validator。

5. 没有 shell/process session 模型。
   - 运行时没有对象负责长命令、stdin 写入、轮询、取消、超时和截断。

6. `src/plugins` 与根 `./plugins` 在代码里还没有真正分层。
   - 内核没有外部工具包 loader。

7. 现有测试锁定了文本流语义，工具层必须保留这些约束。
   - `brain.test.ts` 要求“只有成功结束才提交上下文”。
   - `socket.test.ts` 要求按 socket 隔离的流输出和 `streamEnd` 顺序。

## 参考项目提炼

### Codex

值得借鉴的点：

- `ToolDefinition` 是统一的模型可见规格，包含 input schema、可选 output schema、deferred loading。
- `ToolExecutor` 把可执行 runtime 和模型规格绑定在一起，而且每个工具都能声明是否支持并行调用。
- `mcp_tool.rs` 会在模型曝光前先做 MCP schema 归一化。
- `tool_output.rs` 分离模型输出、日志预览和 hook 可见 payload。
- `tool_config.rs` 把 shell backend、unified exec、environment mode 当成显式运行时策略。
- thread/sdk 层把 approval mode 和 sandbox mode 当作每个 thread / 每个 turn 的显式输入。

对 Flyflor 的含义：

- 不管工具来源是 built-in、plugin 还是 MCP，都应先归一成统一内部规格；
- exposure、schema sanitization、deferred tools、parallel support 应成为一等元数据；
- shell/process 执行必须是独立 runtime path，不能只是一次性的 helper。

### Claude Code

值得借鉴的点：

- command frontmatter 可以声明 `allowed-tools`、model hints、argument shapes；
- hooks（`PreToolUse`、`PostToolUse`、`Stop`、`PreCompact`）提供生命周期拦截点；
- `TodoWrite`、`Task`、`MultiEdit`、`Edit`、`Bash`、`Read`、`Grep`、`Glob` 是分立工具，而不是全部塞进 shell；
- settings 层把 allow/ask/deny 策略和工具实现解耦。

对 Flyflor 的含义：

- prompt blocks 应编译成运行时工具策略；
- guardrail 需要确定性的 pre/post tool hooks；
- multi-edit 应是结构化编辑表面，不是 raw overwrite；
- todo 和 task 应是显式 runtime object，而不是 prompt 里的文字约定。

### opencode

值得借鉴的点：

- tool context 携带 session id、message id、call id、abort、messages、metadata updates、`ask()`；
- 工具执行会把 `text`、`tool-call`、`tool-result`、`step-finish` 等结构化 part 写进 session；
- `task` 只是标准工具；
- 权限支持 `allow`、`deny`、`ask`；
- 子 agent 继承父级限制。

对 Flyflor 的含义：

- subagent 应走与其他工具相同的编排层；
- tool context 必须是稳定运行时对象；
- permission ask/reply 必须是可暂停/可恢复的工具调用，而不是工具内部同步阻塞。

### openhuman、openclaw、nanobot、CodeWhale、hermes-agent

值得有选择地借鉴：

- openhuman：
  - `ToolScope`、`ToolCategory`、`PermissionLevel`、按参数动态升级权限；
  - provider schema cleaning；
  - `codegraph_index` / `codegraph_search` 作为显式工具；
  - browser/computer 作为高风险显式表面。
- openclaw：
  - 外部插件 manifest 兼容性校验和类型化 plugin SDK entrypoint。
- nanobot：
  - 极简 tool interface、schema cast/validate、长生命周期 exec session。
- CodeWhale：
  - capability metadata、approval requirement、timeout、hook events；
  - 基于命令前缀的 exec policy。
- hermes-agent：
  - registry generation counter、TTL availability cache、path security helper、browser provider registry。

对 Flyflor 的含义：

- 外部工具包应先做冷发现和 manifest 归一化，再注册；
- codegraph 应是可见工具，不应藏在泛搜索后面；
- path guard、command guard、workspace boundary check 应由确定性服务完成。

## 目标架构

### 1. 引入真正的工具运行时 scope

建议新增 primitive layer：

```txt
src/core/tool/
  index.ts
  decorator.ts
  types.ts
```

建议在 `src/core/ioc/abstracts.ts` 中新增：

- `FTool extends FService`

建议新增 decorator：

- `@Tool()`

原因：

- 工具已经是明确的运行时对象种类，不再只是 helper 方法；
- 仓库规则已经要求新的运行时 scope 用 decorator + inheritance 表达。

### 2. 新增专门的工具领域边界

建议新增：

```txt
src/tool/
  index.ts
  types.ts
  service.ts
  permission/
    service.ts
    types.ts
  approval/
    service.ts
    types.ts
  process/
    service.ts
    types.ts
  patch/
    service.ts
    types.ts
  mcp/
    service.ts
    types.ts
  plugin/
    service.ts
    types.ts
```

核心对象建议：

- `ToolService`
  - discovery、filter、组装模型可见 tool list
- `ToolRegistry`
  - name -> tool runtime 映射
- `ToolOrchestrator`
  - 串起 permission、sandbox、runtime、output shaping、event emission
- `PermissionService`
  - `allow | deny | ask`
- `ApprovalService`
  - pending approval ticket、reply、session 级 always allow
- `ProcessSessionService`
  - 长生命周期 shell/exec session
- `PatchService`
  - patch grammar parsing、diff validate、atomic apply
- `PluginRuntimeService`
  - 加载和监管根 `./plugins`
- `McpToolService`
  - 把 configured MCP tools 归一成内部 `FTool`

### 3. 所有工具来源统一归一成同一种内部对象

建议内部元数据至少包含：

- `name`
- `description`
- `inputSchema`
- `outputSchema?`
- `source`: `builtin | plugin | mcp | generated`
- `exposure`: `direct | deferred | directModelOnly | hidden`
- `permissionLevel`: `none | read | write | execute | dangerous`
- `parallelSafe`
- `lockScope`: `tool | workspace | path | global`
- `timeoutMs?`
- `scope`: `agent | cli | ipc | all`
- `category`: `system | workflow | browser | computer | retrieval`

建议调用上下文包含：

- `sessionId`
- `turnId`
- `messageId`
- `callId`
- `agentName`
- `workspaceRoot`
- `cwd`
- `abortSignal`
- `metadata()`
- `emit()`
- `ask()`
- `sandbox`

建议结果对象包含：

- `status`: `completed | error`
- `content`: 文本和/或结构化 payload
- `artifacts?`
- `truncated`
- `outputPath?`
- `metadata`

## Model / Brain 改造方向

### 当前问题

`Brain` 和 `Intelligence` 现在都是 text-only。

### 建议改造

为 `Intelligence` 新增结构化 event stream：

- `text_delta`
- `tool_call`
- `assistant_finish`
- `error`

建议的第一版策略：

1. 对外保留 `Agent.next()` 的文本流输出；
2. 把 `Intelligence` 内部改成结构化 event；
3. 由 `Brain` 持有 tool loop：
   - 发送用户消息和上下文给模型；
   - 读取 event；
   - 文本 delta 立即向外流出；
   - 遇到 `tool_call` 时通过 `ToolOrchestrator` 执行；
   - 在真正执行工具前，先把 tool-call item 写入 turn state，保证 history / replay 稳定；
   - 把 tool result 追加到 turn state；
   - 继续模型回合直到 assistant finish；
   - 只有 assistant 成功 finish 才提交 turn context。

建议的 provider 推进顺序：

- 第一阶段先支持有 tool-call 能力的：
  - `OpenAIResponses`
  - `AnthropicMessages`
- 其他 adapter 先保留 text-only，等 schema translator 和 tool event parser 做好后再升级。

这是最保守的路径，因为不需要一次性改完所有 provider。

## IPC 与事件协议

保持底层传输完全不变：

- 仍然是 8-byte big-endian length-prefixed JSON；
- 仍然是同一个 `SocketPacket` envelope。

扩展 event vocabulary，而不是重写 transport。

建议新增的 outbound action：

- `turnStart`
- `toolStart`
- `toolDelta`
- `toolEnd`
- `toolError`
- `approvalRequested`
- `approvalResolved`
- `todoUpdated`
- `subagentStart`
- `subagentEnd`
- `turnEnd`

建议新增的 inbound action：

- `approvalReply`
- `toolCancel`

兼容性要求：

- 保留现有 `data` + `streamEnd` 的文本流行为，这样旧客户端在 richer event 加入期间不会立刻失效。

## 权限、审批与沙箱

### 运行时决策模型

每次工具调用最终都应收敛到：

- `allow`
- `deny`
- `ask`

session 或 agent 级策略仍可用更高层模式表达，例如：

- `never`
- `on_request`
- `on_failure`
- `unless_trusted`

但具体到每次调用，执行决策应保持为 `allow | deny | ask`。

### Guard pipeline

建议在工具执行前做确定性检查：

1. tool 是否启用？
2. tool source 是否可信？
3. workspace path 是否有效？
4. command / network rule 是否通过？
5. permission level 是否落在允许范围内？
6. 是否需要 approval？
7. sandbox/runtime 是否可用？

建议实现为 `FGuard` / `FSandBox` 订阅点的 hook：

- `PreToolUse`
- `PostToolUse`
- `Stop`
- `PreCompact`

### 继承规则

subagent 和 plugin-provided tool 必须继承：

- 父级 deny rule；
- workspace boundary 限制；
- approval mode；
- network 限制。

子级不允许扩大父级 deny。

## Shell 与 Process Session

不要把 shell 建模成一次性的 `spawn -> collect text -> return` helper。

建议的 process-session 对象包含：

- session id
- pid
- command
- cwd
- env policy
- `tty`
- `login`
- `stdin` 写入支持
- polling / yield interval
- truncation counters
- timeout state
- cancellation state

建议的最小工具表面：

- `exec_command`
- `write_stdin`
- `terminate_process`

底层应由 `ProcessSessionService` 持有，并通过 `FSandBox` 进入真实执行。

## 文件编辑与 Patch

### 总体建议

让 patch / diff 成为默认写入表面。

优先内置工具：

- `read_file`
- `glob`
- `grep`
- `apply_patch`
- `shell`
- `task`
- `todo`

不建议把 raw overwrite 暴露成主要模型写入路径。

### Patch 规则

建议 patch 流程：

1. 把 patch grammar 解析成结构化 edit object；
2. 所有 touched path 都先相对 workspace 做解析；
3. 校验 `oldText` 或 hunk context 是否匹配当前文件；
4. 计算 preview diff；
5. 需要时请求 approval；
6. 原子提交；
7. 发出带 diff metadata 的 tool lifecycle event。

`FileService` 继续作为 path-bound file owner，但 patch 逻辑本身应在专门的 patch service 中。

## Task 与 Subagent 设计

把 subagent dispatch 实现成标准工具。

第一版建议工具：

- `task`

Phase 1 行为：

- 仅支持 foreground；
- 目标 profile 先来自 `ConfigComponent.agents`；
- 子 agent 的最终结果作为一个标准 tool result 返回给父级。

Phase 2 行为：

- 可选 background mode；
- 子任务完成时生成 synthetic follow-up event / message；
- 后续再支持 ephemeral generated profile。

这样既能贴合 `prompts/agent/AGENTS.md` 里的意图，又不需要额外的文本侧信道协议。

## 内核插件层 vs 根外部工具层

### `src/plugins`

保留 `src/plugins` 作为内核自有的 loader / supervision boundary。

它的职责应是：

- 发现 plugin manifest；
- 做兼容性校验；
- 启动受监管 runtime；
- 把 plugin tools 归一成内部 `FTool`；
- bridge plugin event、approval、shutdown。

### `./plugins`

这是用户要求的仓库根外部工具层，必须保持在 Bun 二进制之外。

建议默认内容：

- `./plugins/browser-use`
- `./plugins/computer-use`
- `./plugins/rtk`
- `./plugins/codegraph`

建议 manifest 方向：

```json
{
  "name": "codegraph",
  "version": "0.1.0",
  "runtime": {
    "kind": "stdio",
    "entry": "./bin/codegraph"
  },
  "tools": [
    { "name": "codegraph_index" },
    { "name": "codegraph_search" }
  ],
  "permissions": {
    "default": "read"
  },
  "capabilities": ["retrieval", "workspace-local-index"]
}
```

建议策略：

- browser/computer/rtk/codegraph 都作为外部工具包存在；
- Flyflor core 只提供 contract、loader 和 runtime bridge。

### 针对几个外部工具的特殊说明

1. `browser-use`
   - 必须是显式启用插件；
   - domain allowlist 应独立于通用 HTTP fetch；
   - 默认 approval level 至少是 `execute`，很多场景应视作 `dangerous`。

2. `computer-use`
   - 必须是显式启用插件；
   - 风险最高；
   - 必须经过 approval + sandbox + lifecycle event。

3. `rtk`
   - 通过与其他外部工具相同的 plugin contract 接入；
   - 不建议为它做专门的 kernel fast path。

4. `codegraph`
   - 应作为显式工具，而不是隐藏检索；
   - 索引和存储保留在 plugin 自己的本地状态里；
   - indexing / searching 前必须先过 workspace-root 边界检查。

## MCP 接入方案

使用现有 `config.mcp` 作为 MCP server 定义种子。

建议行为：

- 先支持 stdio MCP；
- 把 MCP tools 统一归一成内部 `FTool`；
- 命名规范统一为 `mcp__server__tool`；
- 在模型曝光前做 schema sanitize；
- 保留结构化 MCP output，不要过早全部 flatten 成文本。

第一阶段的非目标：

- 不要把完整 OAuth、SSE、HTTP MCP 支持作为一期前置条件。

## Prompt 策略 Blocks

Flyflor 已经有 prompt block 机制，应直接复用。

建议新增 block 家族：

```md
<flyflor:tools>
{
    version: 1,
    allowed: ["read_file", "glob", "grep", "apply_patch", "task"],
    enabledPlugins: ["codegraph"],
    approvalPolicy: "on_request"
}
</flyflor:tools>

<flyflor:permissions>
{
    version: 1,
    maxLevel: "write",
    network: false
}
</flyflor:permissions>
```

这些 blocks 应在 tool loop 开始前先编译成运行时 policy object。

## 分阶段实施路线

### Phase 1：核心工具循环

- 新增 `FTool` 和 `@Tool()`；
- 新增 `src/tool` 运行时服务；
- 新增结构化 intelligence event；
- 实现最小 built-in tool 集合：
  - `read_file`
  - `glob`
  - `grep`
  - `apply_patch`
  - `shell`
  - `task`
  - `todo`
- 实现 `allow | deny | ask`；
- 扩展 IPC tool lifecycle event；
- 保留当前文本流行为。

### Phase 2：process session 与外部工具桥接

- 新增 `ProcessSessionService`；
- 新增根 `./plugins` discovery / supervision；
- 新增 stdio MCP bridge；
- 接入外部插件：
  - `browser-use`
  - `computer-use`
  - `rtk`
  - `codegraph`
- `task` 支持 foreground subagent。

### Phase 3：更丰富的策略与后台执行

- background task / subagent；
- `PreCompact` 结构化摘要，保留 carry-forward state；
- approval persistence 与 trusted-session rule；
- 更多 provider tool schema；
- 更丰富的 UI / IPC 表面，用于 approval、todo、tool progress。

## 测试与回归计划

至少要新增这些测试覆盖：

1. tool discovery 与 IOC registration
2. provider schema sanitization
3. 有 tool-call 能力 provider 的 intelligence event parsing
4. `Brain` tool loop 的 success / failure / cancel 语义
5. permission `allow | deny | ask`
6. approval suspend / resume over IPC
7. patch path escape 与 old-text mismatch rejection
8. process session polling、stdin、timeout、cancel、truncation
9. socket event ordering 与 per-socket isolation
10. MCP name normalization 与 output shaping
11. subagent deny inheritance
12. plugin manifest validation 与 plugin runtime supervision
13. codegraph workspace-bound indexing / search

真正开始实现后的健康门槛：

- `bun run check`
- 每个变更边界对应的 focused `bun test`

## 待定问题与推荐答案

1. 可执行插件是否复用 `skills` 配置？
   - 推荐：不要。
   - `skills` 继续用于 skill content；可执行插件建议新增独立配置或默认固定到根 `./plugins`。

2. 哪些 provider 先支持 tool call？
   - 推荐：先 `OpenAIResponses`，再 `AnthropicMessages`。

3. 第一阶段是否暴露 raw file overwrite？
   - 推荐：不要。
   - 先以 patch / edit 导向工具为主。

4. browser / computer 是否做成 built-in？
   - 推荐：不要。
   - 它们应是外部 plugin runtime，由内核桥接。

5. codegraph 是否藏在泛搜索后面？
   - 推荐：不要。
   - 直接暴露 `codegraph_index` 和 `codegraph_search`。

## 最终建议

Flyflor 不应该把“tools”做成 `Brain` 或 `Intelligence` 里的 helper 函数集合。

应该补出的是真正的：

- `FTool` 运行时 scope；
- 专门的 `src/tool` orchestration boundary；
- `Brain` 内的结构化模型事件和 tool loop；
- 显式 permission / sandbox service；
- patch / process / session primitives；
- 严格区分内核插件加载（`src/plugins`）与仓库根外挂工具层（`./plugins`）。

这条路径既符合当前仓库规则，也能复用现有 IOC、Prompt、IPC 机制，同时为 Codex 风格执行层、Claude 风格策略 hooks、opencode 风格 task/subagent 流程留出清晰演进空间，而不需要让 Flyflor 失去自己现在的形状。
