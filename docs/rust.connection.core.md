# Rust Connection Core

## 一句话定位

本文把 Rust 外壳 `Slice 1: Connection Core` 压成可直接实现的连接级契约。

- 只讨论 `/ws` 连接生命周期、连接级 snapshot、心跳、重连和本地连接状态机。
- 不讨论聊天渲染、ask UI、planning 面板或长线 loop UI。
- turn 级结果仍以 `turn.final.reply.metadata` 为准，不回灌到连接状态机。

## 依赖文档

实现 Rust connection core 时，只依赖下面三层：

1. [control.protocol.md](control.protocol.md)
2. [rust.integration.md](rust.integration.md)
3. [runtime.events.md](runtime.events.md)

不依赖：

- Bun runtime/socket 私有类
- 历史第一方 Bun CLI/TUI/channel adapter
- 已移除的旧实现

## 目标

Rust connection core 的最小职责只有五件事：

1. 建立 `/ws` 连接
2. 接收并缓存 `server.hello`
3. 可选发送 `client.hello`
4. 维护 `ping` / `pong` 保活
5. 按需刷新 `gateway.status.get` 与 `capability.catalog.get`

这层不负责：

- 解释当前轮 reply 语义
- 推断 ask / todo / loop
- 把 `event.publish` 直接写成当前轮状态

## 连接生命周期

推荐把一次连接拆成下面阶段：

1. `idle`
2. `connecting`
3. `open-waiting-hello`
4. `ready`
5. `degraded`
6. `reconnecting`
7. `closed`

阶段含义：

- `idle`：尚未发起连接。
- `connecting`：正在建立 WebSocket。
- `open-waiting-hello`：底层 socket 已 open，但还没收到 `server.hello`。
- `ready`：已收到 `server.hello`，连接级 snapshot 可用，可发送业务消息。
- `degraded`：socket 仍活着，但 hello/status/catalog/pong 中某项刷新失败或超时，需要提示“连接在线但状态不完整”。
- `reconnecting`：连接已断开，正在退避重连。
- `closed`：用户主动关闭，停止自动重连。

## 最小状态机

| 当前状态 | 事件 | 下一状态 | 说明 |
| --- | --- | --- | --- |
| `idle` | start connect | `connecting` | 初始化 socket |
| `connecting` | socket open | `open-waiting-hello` | 开始等待 `server.hello` |
| `open-waiting-hello` | receive `server.hello` | `ready` | 写入 hello snapshot |
| `open-waiting-hello` | hello timeout / parse failure | `degraded` | 连接已开，但当前协商不完整 |
| `ready` | status/catalog refresh failure | `degraded` | 只影响连接级 snapshot 完整性 |
| `degraded` | refresh success | `ready` | 恢复完整连接态 |
| `ready` / `degraded` | socket close unexpectedly | `reconnecting` | 启动 backoff |
| `reconnecting` | reconnect success + receive `server.hello` | `ready` | 视为新连接周期 |
| `reconnecting` | user stop | `closed` | 明确停机 |
| 任意非 `closed` | fatal local shutdown | `closed` | 停止后续尝试 |

硬约束：

- 没收到 `server.hello` 前，不把连接视为 `ready`。
- `client.hello` 不是进入 `ready` 的前提。
- `turn.final`、`turn.error`、`event.publish` 不改变连接状态机阶段。

## 握手顺序

最小握手顺序固定为：

1. 连接 `/ws`
2. 等待 `server.hello`
3. 缓存 `server.hello.payload.status`
4. 缓存 `server.hello.payload.capabilities`
5. 缓存 `server.hello.payload.kits`
6. 可选发送 `client.hello`
7. 收到 `ack` 后仅更新“已自报”本地标记

重点：

- `server.hello` 是连接级事实起点。
- `client.hello` 只是客户端自报，不是二次协商门。
- `ack.payload.received === "client.hello"` 只表示服务端收到了自报，不表示 handshake 被重建。

## Snapshot Cache Ownership

Rust connection core 应把连接级 snapshot 明确隔离为本地 cache，而不是散落到各 UI 子模块。

建议至少维护四块只读 cache：

1. `helloSnapshot`
2. `gatewayStatusSnapshot`
3. `capabilityCatalogSnapshot`
4. `subscriptionSnapshot`

建议来源：

| cache | 首次来源 | 刷新来源 | 用途 |
| --- | --- | --- | --- |
| `helloSnapshot` | `server.hello` | 仅新连接重建 | 初始连接事实、协议面、自报前能力面 |
| `gatewayStatusSnapshot` | `server.hello.payload.status` | `gateway.status.snapshot` | 连接状态栏、健康提示 |
| `capabilityCatalogSnapshot` | `server.hello.payload.kits` | `capability.catalog.snapshot` | kit/capability 目录展示 |
| `subscriptionSnapshot` | 本地空集或 `ack` | `ack.payload.subscriptions` | 事件订阅状态 |

规则：

- `server.hello` 到来后，可以把其中的 `status` 和 `kits` 作为连接后的初值。
- 后续主动刷新成功时，用 `gateway.status.snapshot` 和 `capability.catalog.snapshot` 覆盖对应 cache。
- `ack` 只更新与它对应的局部连接级事实，不覆盖 turn 级数据。

## Ping / Pong

`ping` / `pong` 只用于保活与延迟观察，不承担业务语义。

建议处理方式：

1. 连接进入 `ready` 后，按固定周期发送 `ping`
2. 收到 `pong` 后刷新最近保活时间
3. 连续多个周期未收到 `pong` 时，把连接标记为 `degraded`
4. 若 socket 真正关闭，再进入 `reconnecting`

规则：

- 不因为某一轮业务失败就停止心跳。
- 不把 `pong` 当成 turn 成功信号。
- `ping` / `pong` 不携带 ask / todo / planning 语义。

## 主动刷新

Rust connection core 在 `ready` 后建议支持两类主动刷新：

1. `gateway.status.get`
2. `capability.catalog.get`

使用原则：

- 连接建立后可主动各拉一次，补全本地 cache。
- UI 需要显式刷新时再拉，不必把它们做成高频轮询。
- 刷新失败只影响连接级 snapshot 完整性，不应覆盖当前轮聊天结果。

## 重连与退避

Rust shell 应把重连视为连接级职责，而不是 turn 级职责。

建议行为：

1. 意外断开后进入 `reconnecting`
2. 使用指数退避或阶梯退避
3. 每次重连成功后重新等待新的 `server.hello`
4. 重新建立本地 hello/status/catalog/subscription cache
5. 需要事件订阅时重新发送 `event.subscribe`

边界说明：

- 旧连接的本地缓存可以作为 UI 暂存，但必须标记为“stale”
- 新连接收到 `server.hello` 后，旧连接状态不再有权威性
- 是否重放未完成 turn，不在 connection core 范围内

## 连接级状态与 Turn 级状态分层

这层最容易漂移，所以单独钉死：

| 类别 | 读取位置 | 例子 | 是否属于 connection core |
| --- | --- | --- | --- |
| 连接级状态 | `server.hello` `gateway.status.snapshot` `capability.catalog.snapshot` `ack` | host、port、kits、subscriptions | 是 |
| turn 级状态 | `turn.final.reply.metadata` | ask、planning、executiveToolLoop | 否 |
| 事件时间线 | `event.publish.payload.event` | `memory.ask.recorded`、`sandbox.*` | 否 |

硬约束：

- 不把 `gateway.status.snapshot` 当成当前轮结果。
- 不把 `event.publish` 当成 ask/planning/loop 的权威来源。
- 不把 `turn.final.reply.metadata` 写回连接状态机。

## 推荐最小本地模型

Rust 侧可以用一个非常薄的本地模型承载 connection core：

```text
ConnectionState {
  phase,
  connectedAt,
  lastPongAt,
  lastError,
  helloSnapshot,
  gatewayStatusSnapshot,
  capabilityCatalogSnapshot,
  subscriptionSnapshot
}
```

要求：

- 这是连接级 store，不是全局对话 store。
- 只保存 `/ws` transport 相关事实。
- 业务 UI 从这里读取“连接是不是活着、catalog 是否齐全、订阅是否完成”，不要读取当前轮 ask/planning。

## Slice 1 完成标准

Rust `Slice 1: Connection Core` 真正完成时，应满足：

1. 能建立 `/ws` 并等待 `server.hello`
2. 能把连接状态从 `connecting` 推进到 `ready`
3. 能可选发送 `client.hello` 并处理 `ack`
4. 能缓存 `gateway.status.get` 与 `capability.catalog.get` 的结果
5. 能处理 `ping` / `pong`
6. 能在断线后进入 `reconnecting`
7. 能把连接级状态和 turn/event 状态严格分层

## 红线

- 不把 `client.hello` 当成必须二次握手。
- 不把 UI 局部状态机写成 Bun 内部类的镜像。
- 不从文本猜测连接是否 ready、是否 ask、是否 loop paused。
- 不在 connection core 中偷偷塞聊天渲染、planning、event timeline 逻辑。
