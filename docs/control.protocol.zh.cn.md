# Control Protocol

## Surface

Socket control 暴露在：

- `GET /health`
- `GET /ws`

`/ws` 使用来自 `src/protocol/control/envelope.ts` 的 JSON control/event envelopes。稳定协议名是 `flyflor.ws.v1`。`gateway.message.send` 这类 message name 是 wire compatibility 名称。

对 TUI 和其他 external shell 来说，`gateway.*`、`event.*` 和 query snapshot messages 是公开血管边界。它们暴露 live turn transport、RuntimeEvent emit/subscribe 和 read-model snapshots；它们不是 private Runtime API，也不能为单个 TUI 扩展私有 runtime calls。

## Core Message Families

Client-to-server messages 包括：

- `client.hello`
- `ping`
- `gateway.status.get`
- `capability.catalog.get`
- `gateway.message.send`
- `event.subscribe`
- `event.unsubscribe`
- `history.list`
- `fork.memory.get`
- `task.plan.decide`
- ASK、Blackboard、Crystal、Fork、Replay、Scope、Task、Thought 和 Execution Job records 的 detail queries

Server-to-client messages 包括：

- `server.hello`
- `ack`
- `gateway.status.snapshot`
- `capability.catalog.snapshot`
- `turn.delta`
- `turn.final`
- `turn.error`
- `event.publish`
- `history.snapshot`、`ask.snapshot`、`fork.snapshot`、`fork.memory.snapshot`、`task.snapshot` 和 `execution.job.snapshot` 等 query snapshots

## Context Input

`gateway.message.send.payload.context` 是显式 context 入口。Canonical fields：

- `activeScope`
- `contextForkId`
- `skillNames`
- `toolApprovals`

`toolApprovals` 可以包含 `mcpToolCalls` 和 `userToolCalls`。这些字段属于 kernel approval/tool-loop contract；thin client 可以渲染和提交它们，但不能本地执行 tool。

Legacy `activeProject` 只能作为 compatibility read 被接受，并且必须立即 normalize 到 `activeScope`。

Conversation、user、thread、client 和 connection fields 是 routing/audit metadata。它们不能选择 Scope、Memory owner、Crystal recall、tool approval authority 或 prompt assembly。

## Snapshot Matrix

| Snapshot | Source | Purpose |
| --- | --- | --- |
| Connection-level snapshot | `SocketModule.getStatusSnapshot()` 和 `SocketControlHub` | Transport health、client count、channel state、model/config visibility 和 cache status。 |
| Turn-level snapshot | `turn.delta`, `turn.final`, `turn.error` | 当前请求进度和最终 reply metadata。 |
| Capability snapshot | Executive catalog readers | Visible capabilities 和 hidden diagnostics。 |
| Query/read snapshot | `src/socket/query` | Ledger/detail/history/replay read models。 |
| Event stream | `src/events` through socket subscription | Realtime runtime、ASK、memory、tool、gateway、subagent、process、worker 和 execution events。 |

连接级 snapshot、turn 级 snapshot、事件流 must stay distinct。Status snapshot 不是 replay record，ledger query 不是 prompt context。

Realtime panels 应使用 `event.subscribe`；detail panels 应通过 snapshot queries 刷新。Event subscription selectors 对 stable event classes 和 `RuntimeEventType` values 闭合。Unknown classes 或 types 返回 `invalid-payload`，不得修改 peer subscription state。

`task.plan.decide` 是 plan decision 的显式 socket control write command。它由 socket control 处理，并通过 task-plan query/write boundary 应用；它不是被动 read-model snapshot query。

## Thin-Client Bootstrap

Rust/TUI shell 的最小读取优先级：

1. 读取 `server.hello` 获取 protocol 和 capability bootstrap。
2. 发送 `capability.catalog.get` 获取 visible capability/tool surface。
3. 需要 fresh connection snapshot 时发送 `gateway.status.get`。
4. 通过 `gateway.message.send` 发送 live input。
5. 渲染 `turn.delta`，然后把 `turn.final` 视为 completed turn 的权威。
6. 读取 `reply.metadata.ask` 得到 ASK UI state，读取 `reply.metadata.executiveToolLoop` 得到 long-horizon loop pause state。
7. 侧边栏使用 `history.list`、`ask.list`、`blackboard.detail.get`、`execution.job.list` 和 `execution.job.detail.get` 等 read-model queries。

Rust/TUI 层不应从 connection id、user id、thread id、client id 或 transport actors 推断 cognitive continuity。Scope 和 fork selection 必须来自显式 context payload。

## 当前 flyflor-cli 缺口

当前 `flyflor-cli` bootstrap 发送 `client.hello`、`history.list`、`task.list`、`gateway.status.get`、`fork.memory.get` 和 `event.subscribe`。它还没有发送 `capability.catalog.get`，并把 `server.hello` 当作未来 handshake metadata，而不是已解析的 bootstrap source。

这是工具调用闭环的文档和实现缺口。在实现前，文档只能说 CLI 能渲染 tool/run events 和 YOLO mode，但还没有闭合普通 capability catalog bootstrap 或 per-turn `toolApprovals` UX。

## Error

Errors 使用 control protocol 的 machine-readable codes。Invalid envelopes、missing payload fields 和 failed dispatches 返回 structured error payload，而不是只有自然语言失败。

常见例子：

- `invalid-envelope`
- `invalid-payload`
- `unsupported-message`
- `gateway.message.send payload requires text`
- `gateway_control_not_ready`

## Tests

相关覆盖：

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`
