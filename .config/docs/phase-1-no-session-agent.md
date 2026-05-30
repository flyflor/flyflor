# 第一阶段无 Session Coding Agent 总设计

## 目标

第一阶段要实现一个最小可用的无 session coding agent，而不是普通聊天 demo。智能体通过 Bun WebSocket 暴露对话入口，每一轮都由本地上下文系统重新组装模型输入，不依赖模型供应商的 server-side session。

本阶段交付物包括：

- 可对话的 WebSocket 服务。
- `.config/web/socket-test.html` 测试页面。
- 本地 `memory.db` 记忆库与 `sqlite-vec` 向量检索。
- `ContextModule` 上下文构建、摘要 checkpoint、记忆召回。
- `ToolModule` 工具执行层。
- `AgentRuntimeService` 串联 socket、context、memory、tools、model provider。

## 非目标

- 不实现完整 TUI。
- 不做多用户权限系统。
- 不做复杂插件市场。
- 不在第一阶段拆多个 memory DB。
- 不把 Markdown 投影作为权威记忆源。
- 不绕过 `SignalBus` 直接处理 guard、confirm、tool event。

## 模块边界

`SocketModule` 只负责外部协议适配。它接收 JSON envelope，调用 `AgentRuntimeService`，再把 token、工具事件、记忆事件、错误事件发回客户端。

`AgentRuntimeService` 是一轮对话的编排者。它写入用户消息，调用 `ContextModule` 构建模型输入，驱动模型 provider，处理工具调用，写入 assistant 结果，并触发记忆更新。

`ContextModule` 只负责模型输入构建。它不执行工具，不写 socket，不直接调用 WebSocket。它读取 templates、prompts、memory recall、context checkpoint、recent turn log，然后按预算输出 prompt messages。

`MemoryModule` 负责长期记忆。`memory.db` 是权威源，`.config/memory/wiki` 是投影。Memory 只提供 store、recall、forget、checkpoint、projection 等能力。

`ToolModule` 负责工具注册、参数校验、guard、执行、产物落盘、输出预算化。工具结果必须通过 `SignalBus` 广播。

`SignalModule` 是血管层。guard、ask、tool event、memory event、runtime event、socket broadcast 都要走它。

## 数据流

1. Web 页面发送 `chat.message`。
2. `SocketModule` 解析 envelope，转交 `AgentRuntimeService`。
3. runtime 写入 `messages` 表，生成本轮 `turnId`。
4. `ContextModule` 读取 `.config/templates`、`prompts`、recent messages、context checkpoint、memory recall。
5. runtime 调用模型 provider。
6. 模型如请求工具，runtime 调用 `ToolModule`。
7. 工具执行前通过 `SignalBus.ask()` 请求 guard，开发期可 auto approve。
8. 工具结果写 artifact，压缩后进入模型上下文。
9. assistant final 写回 `messages`，必要时写入 memory chunk。
10. socket 广播 `chat.final`、`memory.store`、`agent.event`。

## WebSocket 协议

第一阶段使用 Bun 原生 WebSocket，不使用 Socket.IO。所有消息都是 JSON envelope：

- `id`：客户端或服务端生成的消息 id。
- `type`：事件类型，例如 `chat.message`、`chat.delta`、`chat.final`、`tool.call`、`tool.result`、`memory.store`、`memory.recall`、`agent.error`。
- `payload`：事件载荷。
- `timestamp`：Unix 毫秒时间戳。

`chat.message` 的 payload 必须包含：

- `conversationId`：本地 continuity id。无 session 指不使用 provider server-side session，不代表本地不记录线程。
- `content`：用户输入。

服务端必须把 SignalBus 的 runtime、tool、memory 事件广播为 envelope，方便未来 Rust TUI 壳复用同一协议。

## 上下文组装顺序

每轮模型输入顺序必须稳定：

1. `.config/templates/SOUL.md`
2. `.config/templates/USER.md`
3. `.config/templates/MEMORY.md`
4. `prompts/system.md`
5. 当前 runtime/task 状态
6. memory recall 结果
7. context checkpoint summary
8. recent tail messages
9. 当前用户输入

recent tail 必须保留最近对话的原文。旧上下文通过 checkpoint summary 和 memory recall 进入模型。

## 本地模型替身

第一阶段默认 `model.provider = "mock"`，它不是最终模型能力，而是用于场景测试的确定性 provider。mock provider 必须走完整 runtime、memory、context、tool、socket 通路，避免把测试退化成方法级单测。

真实模型 provider 后续接入时不得改变 `AgentRuntimeService` 的主要数据流，只替换 provider adapter。

## 场景测试隔离

场景测试必须创建 `.config/runtime/scenarios/<name>` 下的临时 profile，并生成独立 `config.jsonc`、`memory.db`、wiki、artifact、socket 测试页路径。测试不允许写入正常 `.config/memory/memory.db`。

场景测试覆盖：

- 两轮 no-session 对话 continuity。
- 进程内重建 MemoryComponent 后仍可 recall。
- SignalBus guard auto approve。
- 工具执行事件、artifact 写入。
- WebSocket 页面存在并能通过 socket 完成一轮消息。

## 配置路径

所有路径从 `.config/config.jsonc` 读取，且必须是相对项目根目录路径：

- `paths.templatesDir`
- `paths.memoryDb`
- `paths.memoryWiki`
- `paths.toolArtifacts`
- `paths.sqliteVecDir`
- `paths.codegraphDir`
- `paths.socketTestPage`
- `paths.runtimeDir`

## 验收标准

- WebSocket 可以完成两轮对话。
- 第二轮能引用第一轮用户事实。
- 重启进程后仍能从 `memory.db` 召回关键事实。
- 工具调用会产生 `tool.call`、`tool.result` 或 `tool.error` 事件。
- `SignalBus.ask()` 在 auto approve 下返回 true。
- Web 测试页能显示连接状态、用户消息、assistant delta/final、工具事件、记忆事件。
