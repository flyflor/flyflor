# Flyflor 文档索引

本目录是 Flyflor 工程文档的唯一入口。主文档只描述当前运行契约；当前跨 session 接续路线在根目录 [TODO.md](../TODO.md)，已经落地或迁移完成的提案、历史背景统一归入 [old-docs/](old-docs/)。

官方主页：[https://flyflor.qingshen.xin](https://flyflor.qingshen.xin)

## 阅读顺序

新加入者按下面顺序读，可以在最短路径建立完整心智模型：

1. [architecture.md](architecture.md) — Cognitive / Executive / Agent 顶层分层、composition root、DI 容器、模块边界
2. [refactor.roadmap.md](refactor.roadmap.md) — 切除旧身体、保留内核 / 外骨骼 / 事件血管的阶段性重构路线
3. [directory.architecture.md](directory.architecture.md) — 源码、配置、运行态、工作区和 capability 目录约定
4. [cttl.exoskeleton.md](cttl.exoskeleton.md) — Executive 外骨架中的 Capability / Tool / Trust / Loop 规则
5. [runtime.events.md](runtime.events.md) — RECL / Event Fabric 事件订阅广播中枢
6. [runtime.turn.md](runtime.turn.md) — 单轮请求从渠道入站到回复落盘的完整流程
7. [memory.system.md](memory.system.md) — Markdown / MemoryComponent / brain.db / crystal.db 本地记忆系统
8. [blackboard.md](blackboard.md) — 黑板路由、lease、worker plan、收敛与 livelock
9. [gateway.channels.md](gateway.channels.md) — 主线最小 Gateway 血管层
10. [sandbox.capabilities.md](sandbox.capabilities.md) — 沙箱策略与能力执行边界
11. [mcp.tools.md](mcp.tools.md) — MCP stdio / Streamable HTTP 与运行时 tool loop
12. [crystal.reflection.md](crystal.reflection.md) — 反思候选 → atom → Gem 升格
13. [skill.system.md](skill.system.md) — Skill manifest、选择、使用计数、promotion
14. [cli.commands.md](cli.commands.md) — 第一方 Bun CLI/TUI 退役说明
15. [boundaries.md](boundaries.md) — 工程硬边界与红线
16. [external.kit.md](external.kit.md) — 外部套件 manifest、发现与 control/event 契约
17. [control.protocol.md](control.protocol.md) — Rust / thin client 可直接复用的 WS/control 血管协议面
18. [reference/README.md](reference/README.md) — 反复查阅的实现参考与本地复现手册

## 归档区

[old-docs/](old-docs/) 只存放历史材料。当前实现细节以本索引的主文档、根目录 [README.md](../README.md) 和 [TODO.md](../TODO.md) 为准；不要从归档文档反推运行契约。
