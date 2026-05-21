# Old Docs

本目录只保存已经落地、迁移完成或被新实现取代的设计材料。

当前运行契约以根目录 `README.md`、根目录 `TODO.md`、`docs/README.md` 索引中的主文档和 `docs/boundaries.md` 为准。归档文档可以解释设计来源，但不能作为实现、配置或测试行为的依据。

## 归档清单

- [legacy.architecture.history.md](legacy.architecture.history.md) — 无隐式连续性 / brain.db / Codename / Ask / Continuation / Dream 主线的落地历史。
- [eq.module.md](eq.module.md) — EQ 从提案到语气层能力的落地记录。
- [storage.degradation.md](storage.degradation.md) — Redis / SurrealDB 降级到本地 Component 的迁移背景。
- [todo.history.md](todo.history.md) — 旧 TODO 中已经完成的路线、阶段表与收口记录。
- [todo.next.md](todo.next.md) — 发布前从根目录移出的下一阶段候选，只做规划参考，不作为当前运行契约。
- [todo.active.md](todo.active.md) — 旧活跃 TODO 路径的归档指针；当前路线已移动到根目录 `TODO.md`。
- [scripts/tui.history.seed.ts](scripts/tui.history.seed.ts) — TUI 历史滚动性能造数脚本，归档为手工参考，不属于发布脚本面。

## R5 替代说明

R5 已把 CLI / TUI / Gateway / Capability kit 的外部发现与权限边界收敛到 [../external.kit.md](../external.kit.md) 和 `/ws` control/event protocol。旧文档中把 CLI/TUI/channel 内置实现描述为核心边界的段落只保留历史意义；当前运行契约以 `docs/external.kit.md`、`docs/gateway.channels.md`、`docs/runtime.events.md` 和 `docs/boundaries.md` 为准。
