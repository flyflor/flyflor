# CLI 退役说明

第一方 Bun CLI/TUI 已从主源码剥离，后续将由 Rust 重新实现。

当前仓库主线不再提供 `src/command` 作为运行时边界，也不再生成或校验第一方 CLI 命令文档。保留本文件仅用于说明该事实，避免旧文档索引断链。

后续 CLI 设计应直接基于：

- `docs/control.protocol.md`
- `src/protocol/control/*`
- `src/events/*`

而不是重新依赖 Bun 主线内部类。
