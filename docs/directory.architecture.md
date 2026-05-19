# 目录架构

## 当前目录原则

Flyflor 主线目录现在围绕“保留内核，切掉旧身体”组织：

- `src/cognitive`：认知内核
- `src/executive`：外骨骼
- `src/agent/runtime`：运行时 turn 编排
- `src/agent/gateway`：最小血管层
- `src/events`：事件总线
- `src/protocol`：共享协议

## 已剥离目录

以下目录已从主源码移除：

- `src/command`
- `src/agent/gateway/channels`

对应历史实现只留在 `abandon/` 备份，不允许主线 import。

## Rust 对接基础目录

后续 Rust 客户端和服务端主要依赖：

- `src/protocol/control`
- `src/protocol/contracts`
- `src/events`
- `docs/control.protocol.md`

## 红线

- 不把 `abandon/` 当兼容层。
- 不重新把 CLI/TUI/channel adapter 放回主线。
- 不让 `src/agent/gateway` 再长成大而全的第一方 surface。
