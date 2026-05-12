# Flyflor 文档索引

本目录是 Flyflor 工程文档的唯一入口。所有文档自包含，互不引用；本索引页是唯一允许跨文档引用的页面。

## 阅读顺序

新加入者按下面顺序读，可以在最短路径建立完整心智模型：

1. [architecture.md](architecture.md) — 顶层分层、composition root、DI 容器、模块边界
2. [runtime.turn.md](runtime.turn.md) — 单轮请求从渠道入站到回复落盘的完整流程
3. [memory.system.md](memory.system.md) — Markdown / Redis / SQLite / SurrealDB 四层记忆系统
4. [blackboard.md](blackboard.md) — 黑板路由、lease、worker plan、收敛与 livelock
5. [gateway.channels.md](gateway.channels.md) — 渠道注册、传输类型、状态快照
6. [sandbox.capabilities.md](sandbox.capabilities.md) — 沙箱策略与能力执行边界
7. [mcp.tools.md](mcp.tools.md) — MCP stdio / Streamable HTTP 与运行时 tool loop
8. [crystal.reflection.md](crystal.reflection.md) — 反思候选 → atom → Gem 升格
9. [skill.system.md](skill.system.md) — Skill manifest、选择、使用计数、promotion
10. [project.session.md](project.session.md) — Session 审计层与 Project 三路径触发
11. [prompt.templates.md](prompt.templates.md) — Markdown 模板装配与渲染入口
12. [cli.commands.md](cli.commands.md) — CLI 命令现状清单
13. [boundaries.md](boundaries.md) — 工程硬边界与红线
14. 根目录 [TODO.md](../TODO.md) — 风险点、已知缺口与后续计划

## 提案区

[proposals/](proposals/) 下是未落地的设计稿，仅作参考，不代表当前实现：

- [proposals/eq.module.md](proposals/eq.module.md) — EQ 语气控制层提案
