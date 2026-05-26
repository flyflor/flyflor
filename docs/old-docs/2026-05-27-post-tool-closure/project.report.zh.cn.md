# 项目报告

## 当前状态

Flyflor 当前围绕 Bun-kernel Cognitive-Executive-Agent Architecture 对齐。

活跃 runtime surface 是：

- Bun source 和 compiled Bun binary。
- 本地 chat debug entry。
- Socket 血管面：`/ws` 与 `/health`。
- 通过 `/ws` 暴露 event/control/read-model snapshots。

活跃认知契约是：

- Mindstream 是流体智力。
- Memory 是热记忆和 recall equipment。
- Crystal 是晶体智力。
- Scope 是显式可固化工作域。
- ContextFork 是显式分支。
- ASK 是不确定性和长线 loop 的闭环器官。
- Executive 是可审计行动外骨骼。

## 已封板边界

- `brain.db` 只负责 ledger/query/replay/audit/detail。
- Prompt assembly 使用 Constitution、Crystal、Memory、Scope/Fork、Executive visible capabilities 和 request context。
- Transport metadata 不拥有认知连续性。
- `gateway.*` 只保留 wire compatibility。
- HTTP surface 固定为 `/ws` 与 `/health`。
- Rust shell 材料归档为未来外部仓库交接参考。

## 文档重产

2026-05-25，过时活跃文档已归档到 `docs/old-docs/2026-05-25-docs-refresh/`，并根据当前源码布局重产。新文档保持中英文结构同步，聚焦 Bun kernel/gateway 工作区。
