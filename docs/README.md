# Flyflor 文档索引

本目录只保留当前运行契约。会误导实现、已经退役、或只剩历史解释价值的文档统一移入 [old-docs/](old-docs/)。

官方主页：[https://flyflor.qingshen.xin](https://flyflor.qingshen.xin)

## 先读什么

建议按这个顺序读：

1. [boundaries.md](boundaries.md) — 工程红线。这里定义“约定大于配置”、目录/文件名优先、`oop + use composition`、零字符匹配红线，以及这次 scope-centric 重构的硬边界。
2. [architecture.md](architecture.md) — 当前系统的总模型：Context plane、Ledger/query plane、Cognitive / Executive / Agent 分层、为什么不允许再把流水账当上下文。
3. [directory.architecture.md](directory.architecture.md) — 代码目录 owner。目录和文件名是第一约定，文档必须与真实路径对齐。
4. [runtime.turn.md](runtime.turn.md) — 单轮请求从输入到上下文装配、工具执行、黑板、写账本的热路径。
5. [memory.system.md](memory.system.md) — `Memory + Crystal + explicit Scope/Fork` 的上下文装配模型，以及 `brain.db` 作为 ledger/query plane 的职责。
6. [blackboard.md](blackboard.md) — 黑板只运行在当前 turn 已装配好的上下文上，不再自带 transport 级连续性。
7. [control.protocol.md](control.protocol.md) — `/ws` 协议与 `gateway.message.send.payload.context` 的显式上下文入口。
8. [ws.doc.md](ws.doc.md) — `/ws` 的字段级 API 手册。
9. [openapi/flyflor.socket.openapi.md](openapi/flyflor.socket.openapi.md) — Apifox 导入与真实 socket 场景测试契约。
10. [runtime.events.md](runtime.events.md) — 事件时间线与 snapshot 权威面的边界。
11. [sandbox.capabilities.md](sandbox.capabilities.md) — Capability / Tool / Trust / approval / sandbox 运行边界。
12. [mcp.tools.md](mcp.tools.md) — MCP 工具面与 transport 恢复边界。
13. [executive.exoskeleton.md](executive.exoskeleton.md) — Executive 外骨架文档，现行语义已统一到 Executive。
14. [skill.system.md](skill.system.md) — 外部 `SKILL.md` 能力包，不与 Crystal Gem 混用。
15. [crystal.reflection.md](crystal.reflection.md) — Crystal 反思与 Gem 结晶边界。
16. [development.workflow.md](development.workflow.md) — `git worktree + tmux + Codex` 并发开发、review 和新 session 交接流程。
17. [external.kit.md](external.kit.md) — External kit 只读发现协议。
18. [rust.integration.md](rust.integration.md) — Rust 外壳最小接入。
19. [rust.connection.core.md](rust.connection.core.md) — Rust `/ws` 连接核心。
20. [rust.gateway.shell.backlog.md](rust.gateway.shell.backlog.md) — Rust shell 分 slice backlog。
21. [refactor.roadmap.md](refactor.roadmap.md) — 当前重构方向与文档维护口径。
22. [../TODO.md](../TODO.md) — 下一段对话的交接说明、红线和验证清单。

## 这套文档的核心口径

- 上下文装配只来自 `Memory + Crystal + explicit Scope/Fork + Executive visible capability surface`。
- `brain.db` 是按月分片的 ledger/query plane，不是上下文容器，也不直接参与 prompt 召回。
- `Scope` 是唯一显式工作域；没有显式 scope 时，不创建隐式工作域。
- `ContextFork` 是 scope 的显式分支，不是隐式连续性容器。
- `codename` 只是锚点、提议入口和 recall boost，不是隐式上下文桶。
- `Mindstream + Memory + Crystal + Scope + Ask` 共同构成 Flyflor 当前的智能生命体主语；Executive 是执行外骨骼，不接管认知本体。
- `sourceKey` 与 `sourceSurface` 只记录中性 ingress provenance；`conversationKey`、`threadId`、平台 actor 信息只停留在 socket/raw routing 边界，不承担核心认知连续性。
- 编程红线不动：约定大于配置，分层明确，允许重复，不为复用强行抽象，始终保持 `oop + use composition`，目录和文件名优先于局部“聪明”抽象。

## 归档区

[old-docs/](old-docs/) 只存历史材料。它们可以解释为什么曾经这么做，但不能反向定义今天的运行契约。
