# Control Protocol

## 一句话定位

`src/protocol/control` 是 Flyflor 当前主线唯一保留的 WS/control 协议面。

它只负责 transport 与稳定协议，不负责偷偷恢复会话、猜 scope、或把 gateway 字段升级成认知连续性。

## 相关代码

- `src/protocol/control/envelope.ts`
- `src/agent/gateway/control.ts`
- `src/protocol/contracts/types.ts`

## 协议原则

- 只使用 JSON envelope
- 只暴露显式上下文入口
- 不引入 隐式连续性容器
- ask / pause / resume 只通过显式结构化字段暴露
- transport 元数据只停留在 gateway/raw audit 边界
- 当前轮上下文只认 `activeScope` / `contextForkId` / `skillNames`

这意味着协议面对外暴露的是一个会 ask、会暂停、会恢复、会显式装配生命工作域的智能生命体，而不是一个偷偷用 transport 元数据续命的聊天壳。

## Protocol Id

控制面：

```json
"protocol": "flyflor.ws.v1"
```

事件流：

```json
"protocol": "flyflor.event.v1"
```

## Stable Semantic Lanes

| lane | 作用 | 当前主要 transport |
| --- | --- | --- |
| `input` | 客户端发起输入 | `gateway.message.send` |
| `stream` | 服务端流式回复 | `turn.delta` `turn.final` `turn.error` |
| `event` | 事件广播与订阅 | `event.publish` `event.subscribe` `event.unsubscribe` |
| `ask` | 服务端请求用户补充 | 当前附着在 `turn.final.reply.metadata.ask` |
| `todo` | 结构化任务计划 | 当前附着在 `turn.final.reply.metadata.planning.taskPlans` |
| `data` | 只读快照 | `server.hello` `ack` `gateway.status.snapshot` `capability.catalog.snapshot` `history.snapshot` |
| `error` | 控制面错误 | `error` |
| `ping` | 心跳请求 | `ping` |
| `pong` | 心跳响应 | `pong` |

## Transport Message Types

- `ack`
- `capability.catalog.get`
- `capability.catalog.snapshot`
- `client.hello`
- `error`
- `event.publish`
- `event.subscribe`
- `event.unsubscribe`
- `gateway.message.send`
- `gateway.status.get`
- `gateway.status.snapshot`
- `history.list`
- `history.snapshot`
- `ping`
- `pong`
- `server.hello`
- `turn.delta`
- `turn.error`
- `turn.final`

## Envelope

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-1",
  "type": "gateway.message.send",
  "at": "2026-05-20T10:00:00.000Z",
  "requestId": "req-1",
  "correlationId": "optional-parent-id",
  "payload": {}
}
```

## Snapshot Matrix

| 层 | 载体 | 用途 |
| --- | --- | --- |
| 连接级 snapshot | `server.hello` / `gateway.status.snapshot` / `capability.catalog.snapshot` | 当前连接、能力面、血管状态 |
| turn 级 snapshot | `turn.final.reply.metadata` | ask / planning / executive loop 的当前轮权威状态 |
| 事件流 | `event.publish.payload.event` | 时间线、审计、提示刷新 |

硬规则：

- 连接级 snapshot 不是上下文恢复
- 事件流不是当前轮权威状态
- turn 级 metadata 才是当前轮 ask / planning / loop 的权威面

这意味着 thin client 即使已经订阅了完整 event stream，也仍然必须回到 `turn.final.reply.metadata` 读取当前轮的 ask、待续任务和 long-horizon loop 状态，而不是把时间线事件拼成一个假想状态机。

## `gateway.message.send`

输入示例：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-input-1",
  "type": "gateway.message.send",
  "at": "2026-05-20T10:00:01.000Z",
  "payload": {
    "id": "message-1",
    "text": "继续推进这个范围",
    "conversationKey": "u-1",
    "threadId": "thread-1",
    "user": {
      "id": "u-1",
      "displayName": "User One"
    },
    "context": {
      "activeScope": {
        "id": "scope-1",
        "projectDir": "/workspace/project",
        "projectMemoryDir": "/workspace/project/.flyflor/memory",
        "title": "Scope"
      },
      "contextForkId": "fork-1",
      "skillNames": ["review"]
    }
  }
}
```

### 输入约束

- `payload.text` 必填
- `context.activeScope` 是 canonical 字段
- `context.activeProject` 只作兼容输入，runtime 内部应立即标准化到 `activeScope`
- `activeScope` / `activeProject` 都必须传完整结构化对象，不能只传 id
- 没有 `activeScope` 时，服务端也不能偷偷补一个 fallback scope
- `contextForkId` 只接受显式 id，不从文本推断
- `skillNames` 只接受显式数组

### 认知边界

这些字段仍可存在于 message route：

- `conversationKey`
- `threadId`
- `channel`
- `platform actor id`

但它们的职责仅限于：

- transport 路由
- audit
- 平台 reply / thread / dedup

它们不是：

- scope
- fork
- handshake
- memory continuity key

也就是说，协议不会替生命体偷偷决定“你现在正在做什么”。真正的工作域只能通过显式 `activeScope` 与 `contextForkId` 进入当前生命态。

## `history.list`

`history.list` 是全局 ledger 查询。

请求示例：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "history-get-1",
  "type": "history.list",
  "at": "2026-05-20T10:00:01.000Z",
  "payload": {
    "beforeTs": 1710000000000,
    "limit": 20
  }
}
```

### 规则

- 不存在 `sourceKey` 参数
- 不存在 handshake 参数
- 不存在 scope 参数
- 返回的是当前 ledger 的全局流水账分页

scope、fork、replay、plan 只作为 turn 附着的结构化字段随结果返回。

## 流式回复

### `turn.delta`

```json
{
  "type": "turn.delta",
  "payload": {
    "messageId": "message-1",
    "delta": "hel"
  }
}
```

### `turn.final`

`turn.final.reply.metadata` 当前是最重要的读取面：

- `ask`
- `planning`
- `executiveToolLoop`

这三个字段共同暴露的是当前轮生命态的显式结构化结果：要不要问用户、当前有没有待续任务、当前计划与分支是什么。thin client 恢复时要读这个面，而不是扫 event 流猜测状态。

Rust 或其他 thin client 恢复当前轮状态时，优先读这里，而不是扫事件流猜。

### Ask 与续跑表面

当前协议对“问用户再继续”只保留一条显式表面：

- 需要用户补充时，读 `turn.final.reply.metadata.ask`
- 需要恢复 long-horizon loop 时，读 `turn.final.reply.metadata.executiveToolLoop`
- 用户回答后，通过新的 `gateway.message.send` 明确继续，而不是依赖后台自治续跑

也就是说，Flyflor 的控制面暴露的是“生命体此刻在等什么、下一步需要什么”，不是“服务端已经在后台偷偷替你继续”。

## Error

稳定错误码：

- `internal`
- `invalid-envelope`
- `invalid-payload`
- `unauthorized`
- `unsupported-message`

错误面只负责机器可读控制错误，不承担业务上下文恢复。

## 最小读取优先级建议

Rust / thin client 最小读取顺序：

1. 连接后读 `server.hello`
2. 需要刷新连接状态时读 `gateway.status.get`
3. 需要能力目录时读 `capability.catalog.get`
4. 发输入时用 `gateway.message.send`
5. 当前轮结果优先读 `turn.final.reply.metadata`
6. 需要历史时用 `history.list`
7. 需要时间线与审计时订阅 `event.publish`

## Rust 最小接线清单

- 只把 control 协议当成薄控制面，不在客户端重建隐式连续性 / chat / thread 绑定。
- 发消息时显式传 `context.activeScope` 与 `context.contextForkId`；没有就留空，不做 fallback scope。
- 结果恢复优先读 `reply.metadata.executiveToolLoop`、`reply.metadata.ask`、`reply.metadata.planning`。
- 需要账本查询时走 `history.list`，不要把 ledger 原始事件流直接回填成 prompt。
- transport protocol handshake 只属于 MCP / HTTP / SSE / stdio 握手层，不属于 Flyflor 认知连续性模型。

## 当前最重要的协议口径

- `activeScope` 是唯一 canonical 显式工作域字段
- `activeProject` 只是兼容读口
- `history.list` 是 ledger 查询，不是会话恢复
- `chat/thread/user/channel` 不再承担认知连续性
- `turn.final.reply.metadata` 是当前轮 ask / planning / loop 的唯一权威读取面
- control 协议只传显式上下文，不允许偷偷重建隐式连续性
