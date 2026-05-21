# 存储降级历史说明

> Status: **historical background**. 当前运行时契约以 [docs/memory.system.md](memory.system.md) 和 [docs/architecture.md](architecture.md) 为准。

这份文档记录的是存储降级的设计动机，而不是当前实现细则。当前运行时已经收口到本地工作记忆 + 本地晶体图；这里保留的是为什么这么做、以及旧实现为何被移出的背景：

- `MemoryComponent` 默认使用本地 WAL / snapshot / backup，Redis 相关内容只作为历史迁移背景，不再是当前默认路径。
- `CrystalComponent` 默认使用本地 `crystal.db` + VectorIndex，SurrealDB 相关内容只作为历史迁移背景，不再是当前默认路径。
- `brain.db` 负责自传体记忆事件与状态，`crystal.db` 负责长期知识图，二者分离。
- `smoke:recovery`、`doctor`、`status`、TUI 元数据视图用于验证恢复链路，不解析热数据。

如果需要当前实现细节，请直接看：

- [memory.system.md](memory.system.md)
- [architecture.md](architecture.md)
- 根目录 [README.md](../README.md)

旧的存储降级分析保留在这里，作为设计背景和迁移理由，不再承载当前运行时细节。
