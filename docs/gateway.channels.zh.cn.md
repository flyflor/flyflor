# Gateway 血管层

## 一句话定位

主线 Gateway 现在只是血管层。

它只保留三条公开面：

- `/ws`
- `/health`
- `/channels`

第一方 CLI、TUI、channel adapter 已从主源码移除；后续统一由 Rust 外壳或外部实现通过这层协议对接。

## 主线代码路径

- `src/agent/gateway/module.ts` — 最小 GatewayModule
- `src/agent/gateway/control.ts` — WS control/event hub
- `src/agent/gateway/dedup.store.ts` — 主线去重存储
- `src/agent/gateway/kit/*` — External Kit 只读发现
- `src/protocol/control/*` — WS/control envelope 与语义类型

## 当前暴露面

| 路径 | 作用 |
| --- | --- |
| `/ws` | WebSocket control/event 血管 |
| `/health` | 健康检查 |
| `/channels` | 当前 Gateway 血管状态快照 |

## 设计原则

- Gateway 不再承载第一方 channel adapter。
- Gateway 不再承载 CLI/TUI 逻辑。
- Gateway 只做 transport，不做业务语义判断。
- 事件统一来自 `src/events`。
- turn 输入统一经 `gateway.message.send` 进入 Runtime。
- transport session 只属于外部协议握手，不属于 Flyflor 的认知连续性模型。

## 它负责什么

- 接收 `gateway.message.send`
- 广播 `turn.delta` / `turn.final` / `turn.error`
- 提供 `gateway.status.snapshot`
- 提供 `capability.catalog.snapshot`
- 提供 `history.list` / `history.snapshot`
- 透传 `event.publish`

## 它不负责什么

- 不恢复 session
- 不按 `channel/chat/thread/user` 建立隐式上下文
- 不拥有记忆召回
- 不拥有黑板 lease 语义
- 不拥有模型业务判断

## 显式上下文入口

`/ws` 进入 runtime 的唯一上下文字段是 `gateway.message.send.payload.context`。

它只允许携带：

- `activeScope`
- `contextForkId`
- `skillNames`

兼容读取：

- `activeProject`

但兼容字段进入 runtime 后必须立即标准化为 `activeScope`。Gateway 不能偷偷从 `chatId`、`threadId`、`channel`、`user.id` 推断当前 scope。

## WS 语义

主线长期保留的语义 lane：

- `input`
- `stream`
- `event`
- `ask`
- `todo`
- `data`
- `error`
- `ping`
- `pong`

## GatewayMessage 结构

```ts
interface GatewayMessage {
    id: string;
    route: GatewayRoute;
    user: GatewayUser;
    text: string;
    receivedAt: string;
}
```

这里保留的 route / user 元数据只服务：

- transport 路由
- 审计
- reply / thread / dedup

它们不是上下文容器。

## Rust 对接要求

- Rust CLI / Gateway / TUI 只需要实现 `/ws` 客户端或服务端对接。
- 不应依赖 Bun 私有 runtime 类。
- 不应依赖 `abandon/` 里的任何实现。
- 只应依赖 `docs/control.protocol.md`、`docs/ws.doc.md` 与 `src/protocol/control/*`。

## 退役说明

旧的第一方 channel adapter、CLI、TUI、gateway body 已移到 `abandon/` 作为备份。它们不是主线兼容层，也不是运行时依赖。
