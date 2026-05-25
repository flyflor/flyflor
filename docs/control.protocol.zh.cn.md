# Control Protocol

## Surface

Socket control 暴露在：

- `GET /health`
- `GET /ws`

`/ws` 使用来自 `src/protocol/control/envelope.ts` 的 JSON control/event envelope。稳定协议名是 `flyflor.ws.v1`。`gateway.message.send` 等 message name 是 wire compatibility 名称。

## 核心消息族

Client-to-server messages 包括：

- `client.hello`
- `ping`
- `gateway.status.get`
- `capability.catalog.get`
- `gateway.message.send`
- `event.subscribe`
- `event.unsubscribe`
- `history.list`
- `history.snapshot`
- ASK、Blackboard、Crystal、Fork、Replay、Scope、Task 和 Thought records 的 detail queries

Server-to-client messages 包括：

- `server.hello`
- `ack`
- `gateway.status.snapshot`
- `capability.catalog.snapshot`
- `turn.delta`
- `turn.final`
- `turn.error`
- `event.publish`

## Context Input

`gateway.message.send.payload.context` 是显式 context entry point。Canonical fields 是：

- `activeScope`
- `contextForkId`
- `skillNames`

Legacy `activeProject` 只允许作为 compatibility read，并且必须立即 normalize 到 `activeScope`。

Conversation、user、thread 和 connection fields 是 routing/audit metadata。它们不能选择 Scope、Memory owner 或 prompt assembly。

## Snapshot Matrix

| Snapshot | 来源 | 目的 |
| --- | --- | --- |
| Connection-level snapshot | `SocketModule.getStatusSnapshot()` 和 `SocketControlHub` | Transport health、client count、channel state 和 model/config visibility。 |
| Turn-level snapshot | `turn.delta`、`turn.final`、`turn.error` | 当前 request progress 和 final reply metadata。 |
| Capability snapshot | Executive catalog readers | Visible capabilities 和 hidden diagnostics。 |
| Query/read snapshot | `src/socket/query` | Ledger/detail/history/replay read models。 |
| Event stream | `src/events` through socket subscription | Realtime runtime、ASK、memory、tool、gateway 和 execution events。 |

连接级 snapshot、turn 级 snapshot、事件流必须保持区分。Status snapshot 不是 replay record，ledger query 也不是 prompt context。

## Error

Errors 使用 control protocol 中的 machine-readable codes。Invalid envelope、missing payload fields 和 failed dispatches 返回结构化 error payload，而不是只有自然语言失败。

常见示例：

- `invalid-envelope`
- `gateway.message.send payload requires text`
- `gateway_control_not_ready`

## 测试

相关覆盖：

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`
