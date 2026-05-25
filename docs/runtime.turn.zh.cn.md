# Runtime Turn

## 入口

热路径是 `src/agent/runtime/module.ts` 中的 `RuntimeModule.handleMessage`。

Socket 模式从 `SocketModule` 开始：

1. `GET /ws` upgrade 到 `SocketControlHub`。
2. `gateway.message.send` 被归一化为 `GatewayMessage`。
3. `SocketModule.dispatch` 创建或接收 `RuntimeContext`。
4. Deduplication 使用 channel + message id，绝不成为认知连续性。
5. `RuntimeModule.handleMessage` 装配 turn，运行 model/tool loop，写入 memory/ledger state，并返回 `GatewayReply`。
6. `/ws` 发出 `turn.delta`、`turn.final` 或 `turn.error`。
7. `EventsComponent` 向 subscriber 和 audit sink 广播 RuntimeEvents。

本地 chat 入口仍用于直接调试，但 `/ws` 是稳定外部 surface。

## Turn 阶段

Runtime 代码围绕单轮定义了内部阶段输出：

| 阶段 | 形态 | 职责 |
| --- | --- | --- |
| Prepare | `PreparedTurn` | 归一化 context，计算 embedding，读取 pending ASK/fork/scope state，评估 fast-route signals 和 timing。 |
| Assemble | `AssembledTurnContext` | 加载 skills、MCP servers、Memory prompt、sandbox policy、capability catalogs、plugin/user/external tools 和 Blackboard route state。 |
| Generate | `GeneratedTurn` | 运行模型，收集 visible text，解析 structured blocks，执行 tool loops，收集 provenance、task plans、forks、replay records 和 ASK metadata。 |
| Persist/async | memory 和 event calls | 保存 episodes、ledger/detail rows、reflection candidates、scope/codename/fork evidence 和 runtime events。 |

## Context Assembly

Runtime 可以装备：

- 当前请求文本和 attachments
- 通过 Memory 读取的 Markdown constitution
- hot Memory recall 和 working-memory summaries
- Crystal recall 和 Gem knowledge
- 显式 `activeScope`
- 显式 `contextForkId`
- 显式 scope 加载后的 scope-local memory/index material
- Executive visible capability surface

Runtime 不得把原始 `brain.db` event streams 装进 prompt text。`brain.db` 用于 provenance、replay、detail、audit 和 query surfaces。

## Routing、Scope 与 ASK

Route decision 由模型或结构化字段驱动。生产语义路由不能使用 `text.includes`、regex intent rules 或 keyword dictionaries。

Scope recall 遵循可见 gate：

1. Runtime 发布 recall-start event。
2. Memory 列出 scope/codename candidates 和 scope-local evidence。
3. `ScopeRecallComponent` 请求模型输出结构化 `none | load | ask`。
4. `load` 为当前 turn 装备 `activeScope`。
5. `ask` 返回 `AgentAsk`，而不是猜测。

ASK 是正常 runtime outcome。scope 边界、fork merge conflict、blackboard cap、crystallization gate 或 tool-loop limit 需要用户判断时都会出现 ASK。

## Executive Loop Pause

Executive tool execution 可以暂停 turn，而不是隐藏重试：

- `ExecutiveToolRuntime` 返回结构化 ask-required state。
- Runtime 发布 `executive.loop.paused`。
- final reply metadata 带 `kind: "ask"`，并包含 loop snapshot。
- 后续用户回答会记录 ask-answer pair，并可发布 `executive.loop.resumed`。

没有私有后台 continuation protocol。恢复使用下一轮结构化输入和既有 `/ws` event/control surface。

## Blackboard

复杂 turn 可以进入 `RuntimeBlackboardRouteComponent`。Blackboard 只在已经装配好的 turn context 上运行。它不是 transport-session memory owner，也不会从 conversation/thread/user metadata 推断连续性。

如果 Blackboard 命中 cap 或 conflict，`RuntimeBlackboardOutputComponent` 通过 ASK 交还状态。

## Fork、Replay 与 Crystal

`ContextFork` record 是显式分支。Fork merge result、replay record、task plan、高质量 ASK answer 和完成的 blackboard work 可以成为 Crystal reflection evidence。Gem promotion 是后续质量门控步骤，不是自动 transcript storage。

## 测试引用

相关 deterministic coverage 包括：

- `tests/gateway.ws.test.ts`
- `tests/gateway.control.smoke.test.ts`
- `tests/runtime.executive.boundaries.test.ts`
- `tests/runtime.mcp.tool.plan.test.ts`
- `tests/runtime.planning.route.test.ts`
- `tests/ask.wire.test.ts`
- `tests/continuation.wire.test.ts`
- `tests/context.scope.test.ts`
