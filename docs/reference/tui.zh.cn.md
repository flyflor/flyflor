# TUI 参考归档说明

本文件仅保留为历史参考。

第一方 Bun TUI 已从主源码剥离，未来由 Rust 重写。当前主线不再把 TUI 文件、renderer 或 parser worker 当作运行时边界。

当前对接请优先阅读：

- [../control.protocol.md](../control.protocol.md)
- [../runtime.events.md](../runtime.events.md)
