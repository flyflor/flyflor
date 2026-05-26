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

ASK 是正常 runtime outcome。scope 边界、fork merge conflict、blackboard cap、crystallization gate、tool-loop limit、子代理 `needs_user` 冒泡，或外部工具 sidecar 缺失、升级中、回滚要求、root-safe/path/version 判定失败时，都会通过 ASK 交给用户裁决。

ASK v1 的结构化显示规则：

- 一次 ASK 可以携带 1-n 个问题，runtime v1 上限为 5。
- 每个问题携带 1-3 个模型/owner 给出的方案。
- 每个问题必须有 `recommendedChoiceId`。
- runtime 固定补齐 `other: { id: "other", label: "其他", freeform: true }`，让用户保留自由输入权。
- `other` 文本只作为下一轮模型输入、审计和 Crystal evidence，不由 runtime 做自然语言字符匹配解析。
- 高权限 ASK 可以带 `crystalCandidates`，但只进入 candidate evidence，Gem 升格仍由 Crystal quality gate 决定。

Thin client 发送结构化 `metadata.askAnswer` 时，Memory 会把 legacy 单答案字段和多问题 `answers[]` 一起写入 `ask-answer-pair` content。`memory.ask.answered` 只发布有界摘要：question ids、choice ids 和是否有 freeform，让 TUI timeline 可以闭合 ASK，而不读取 prompt text。

## Executive Loop Pause

Executive tool execution 可以暂停 turn，而不是隐藏重试：

- `ExecutiveToolRuntime` 返回结构化 ask-required state。
- Runtime 发布 `executive.loop.paused`。
- final reply metadata 带 `kind: "ask"`，并包含 loop snapshot。
- 如果暂停来自 `subagent.batch`，snapshot 带 `jobId` / `job`，并同步写入 `brain.db.memory_events.type = "execution-job"`。
- `model.allocation.selected` 在 main-turn 和 subagent child 模型调用前发布。Payload 只暴露 `requestId`、可选 job/child ids、scope、role、provider id、model id、reason 和 source。
- 如果暂停来自外部工具稳定性，ASK source 为 `tool-stability`，metadata 带 stability snapshot。
- 后续用户回答会记录 ask-answer pair，并可发布 `executive.loop.resumed`。

没有私有后台 continuation protocol，也没有后台自动续跑。恢复完全依赖下一轮结构化输入和既有 `/ws` event/control surface。`brain.db` 只保存 job/ASK ledger、query、replay、audit、detail；不会把 job ledger 作为 prompt/container 参与上下文装配。

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
