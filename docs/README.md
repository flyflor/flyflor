# Flyflor 文档索引

本目录是 Flyflor 工程文档的唯一入口。所有文档自包含，互不引用；本索引页是唯一允许跨文档引用的页面。

## 阅读顺序

新加入者按下面顺序读，可以在最短路径建立完整心智模型：

1. [architecture.md](architecture.md) — 顶层分层、composition root、DI 容器、模块边界
2. [runtime.turn.md](runtime.turn.md) — 单轮请求从渠道入站到回复落盘的完整流程
3. [memory.system.md](memory.system.md) — Markdown / Redis / SQLite / 晶体本地后端 / SurrealDB 兼容层
4. [blackboard.md](blackboard.md) — 黑板路由、lease、worker plan、收敛与 livelock
5. [gateway.channels.md](gateway.channels.md) — 渠道注册、传输类型、状态快照
6. [sandbox.capabilities.md](sandbox.capabilities.md) — 沙箱策略与能力执行边界
7. [mcp.tools.md](mcp.tools.md) — MCP stdio / Streamable HTTP 与运行时 tool loop
8. [crystal.reflection.md](crystal.reflection.md) — 反思候选 → atom → Gem 升格
9. [skill.system.md](skill.system.md) — Skill manifest、选择、使用计数、promotion
10. [cli.commands.md](cli.commands.md) — CLI 命令现状清单（含 blackboard TTY 浏览器）
11. [boundaries.md](boundaries.md) — 工程硬边界与红线
12. [reference/README.md](reference/README.md) — 反复查阅的实现参考与本地复现手册
13. [storage.degradation.md](storage.degradation.md) — Redis / 晶体本地后端 / SurrealDB 兼容层的降级方案
14. 根目录 [TODO.md](../TODO.md) — 运行边界、后续增强与路线记录

## 提案区

[proposals/](proposals/) 下记录设计主线与落地历史；其中部分内容已经实现，具体状态以文档内进度表和根目录 [TODO.md](../TODO.md) 为准：

- [proposals/eq.module.md](proposals/eq.module.md) — EQ 语气控制层设计与落地记录
- [proposals/life.form.md](proposals/life.form.md) — 无 session / brain.db / Codename / Ask / Ghost / Dream 生命体重构主线
