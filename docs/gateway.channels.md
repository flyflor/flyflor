# Gateway 血管层

## 一句话定位

主线 Gateway 现在只保留血管能力：`/ws` control/event、`/health`、`/channels`。第一方 CLI、TUI、channel adapter 已从主源码剥离；未来统一由 Rust 客户端或外部实现对接这一层。

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

## Rust 对接要求

- Rust CLI / Gateway / TUI 只需要实现 `/ws` 客户端或服务端对接。
- 不应依赖 Bun 私有 runtime 类。
- 不应依赖 `abandon/` 里的任何实现。
- 只应依赖 `docs/control.protocol.md` 与 `src/protocol/control/*`。

## 退役说明

旧的第一方 channel adapter、CLI、TUI、gateway body 已移到 `abandon/` 作为备份。它们不是主线兼容层，也不是运行时依赖。
