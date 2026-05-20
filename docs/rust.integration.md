# Rust Integration

## 一句话定位

本文是未来 Rust `gateway / channel / cli / tui` 外壳对接当前 Bun 主线的最小接入手册。

- Bun 主线负责认知内核、Executive 外骨骼、WS/control 协议和 RuntimeEvent 血管。
- Rust 外壳负责连接 `/ws`、渲染 UI、闭环 ask、展示 planning、消费事件流。
- Rust 侧不应 import Bun runtime 私有实现，也不应依赖 `abandon/`。

## 对接边界

Rust 外壳只依赖下面三层：

1. `docs/control.protocol.md`
2. `docs/runtime.events.md`
3. `src/protocol/control/*` / `src/protocol/contracts/*` 的稳定 JSON shape

不依赖：

- `src/agent/runtime/*` 私有实现
- `src/agent/gateway/*` 内部 owner 细节
- 历史第一方 Bun CLI / TUI / channel adapter

## 最小连接流程

1. 建立 `/ws` 连接。
2. 接收 `server.hello`。
3. 缓存连接级 snapshot：
   - `server.hello.payload.status`
   - `server.hello.payload.capabilities`
   - `server.hello.payload.kits`
4. 可选发送 `client.hello`，接收 `ack`。
5. 按需发送：
   - `gateway.message.send`
   - `gateway.status.get`
   - `capability.catalog.get`
   - `event.subscribe`
   - `event.unsubscribe`
   - `ping`

## Snapshot 分层

| 层级 | 来源 | Rust 用途 | 权威读取位置 |
| --- | --- | --- | --- |
| 连接级 snapshot | `server.hello` `gateway.status.snapshot` `capability.catalog.snapshot` `ack` | 连接状态、能力目录、订阅状态 | 对应 message `payload` |
| turn 级 snapshot | `turn.final` | ask UI、planning 展示、loop 恢复 | `reply.metadata` |
| 事件流 | `event.publish` | 时间线、审计、增量提示 | `payload.event` |

硬约束：

- 连接级 snapshot 不是当前轮结果。
- 事件流不是当前轮权威状态。
- 当前轮 ask / planning / loop 恢复仍以 `turn.final.reply.metadata` 为准。

## Semantic Lane 处理

Rust 侧先按 lane 路由，再看具体 message type：

| lane | Rust 处理方式 |
| --- | --- |
| `input` | 本地组包并发送 `gateway.message.send` |
| `stream` | 渲染 `turn.delta` / `turn.final` / `turn.error` |
| `event` | 接入事件总线、时间线、审计面 |
| `ask` | 从 `turn.final.reply.metadata.ask` 渲染表单 |
| `todo` | 从 `turn.final.reply.metadata.planning.taskPlans` 渲染计划 |
| `data` | 缓存 hello/status/catalog/ack/planning 等只读快照 |
| `error` | 按 `payload.code` 做机器分支 |
| `ping` / `pong` | 保活与健康检查 |

## Ask 闭环

Rust ask UI 的最小闭环：

1. 收到 `turn.final.reply.metadata.kind === "ask"`。
2. 读取 `turn.final.reply.metadata.ask`。
3. 渲染：
   - `prompt`
   - `choices`
   - `questions`
   - `freeform`
4. 用户回答后，作为下一轮新的 `gateway.message.send` 发回。

说明：

- ask 不是独立 transport message。
- 不要从 reply 文本中猜 ask。
- ask 当前轮权威状态只看 `reply.metadata.ask`。

## Planning 展示

Rust planning UI 统一从 `turn.final.reply.metadata.planning` 读取：

- `taskPlans`
- `contextForks`
- `scenes`

这些数据是当前轮只读快照：

- 可直接展示
- 可作为历史记录的结构化摘要
- 不作为客户端回写协议

如果事件流收到：

- `memory.task_plan.written`
- `memory.context_fork.written`
- `memory.scene_record.written`

应把它们视为“planning 已更新”的提示，而不是新的权威 planning payload。

## Long-Horizon Loop 恢复

Rust 恢复长线 loop 时，优先读取：

1. `turn.final.reply.metadata.executiveToolLoop`
2. 如果组件局部只拿到了 ask metadata，才回退读 `turn.final.reply.metadata.ask.executiveToolLoop`

关键字段：

- `askId`
- `resume.mode`
- `stepCount`
- `loopGuardReason`
- `toolBudgetExhausted`
- `stop`

事件流辅助提示：

- `executive.loop.paused`
- `executive.loop.resumed`
- `executive.loop.guard.blocked`

## 事件流消费

Rust 侧建议把 `RuntimeEvent` 当作时间线与提示流，而不是结果快照：

- `gateway.message.received` / `channel.link.changed` / `channel.error`
  用于连接状态与告警
- `memory.ask.recorded` / `memory.ask.answered`
  用于 ask 审计与提示
- `memory.task_plan.written` / `memory.context_fork.written` / `memory.scene_record.written`
  用于 planning 刷新提示
- `sandbox.*` / `plugin.*` / `mcp.*`
  用于执行审计与副作用展示

## 错误处理

控制面错误统一读 `error.payload.code`：

- `internal`
- `invalid-envelope`
- `invalid-payload`
- `unauthorized`
- `unsupported-message`

规则：

- `turn.error` 属于生成流失败
- `error` 属于 control 面失败
- 不从 message 文本做错误分类

## 最小清单

Rust 外壳接入完成的最低标准：

1. 能连接 `/ws` 并处理 `server.hello`
2. 能发送 `gateway.message.send`
3. 能流式渲染 `turn.delta`
4. 能消费 `turn.final.reply.metadata.ask`
5. 能消费 `turn.final.reply.metadata.planning`
6. 能消费 `turn.final.reply.metadata.executiveToolLoop`
7. 能订阅并显示 `event.publish`
8. 能按 `error.payload.code` 做机器分支

## 红线

- 不 import Bun runtime/gateway 私有实现。
- 不依赖 `abandon/` 中的历史壳体。
- 不从 reply 文本、事件文本、用户文本做关键词判断。
- 不把连接级 snapshot、turn 级 snapshot、事件流混成一层状态机。
