# Flyflor 文档

本目录只保留当前 Bun kernel 契约。活跃文档必须维护英文 `.md` 与中文 `.zh.cn.md` 同步版本；误导实现、已经退役或只剩历史解释价值的材料统一移动到 [old-docs/](old-docs/)，并保留可追溯文件名。

官方主页：[https://flyflor.qingshen.xin](https://flyflor.qingshen.xin)

## 阅读顺序

1. [boundaries.zh.cn.md](boundaries.zh.cn.md) - 工程硬边界、OOP + use composition、JSONC 配置、Bun 二进制约束和零字符匹配红线。
2. [architecture.zh.cn.md](architecture.zh.cn.md) - 项目哲学、源码目录地图、context plane 与 ledger/query plane。
3. [directory.architecture.zh.cn.md](directory.architecture.zh.cn.md) - 源码 owner、命名规则和退役路径。
4. [runtime.turn.zh.cn.md](runtime.turn.zh.cn.md) - 从 `/ws` 到 Memory、Crystal、Executive 和 events 的单轮主链。
5. [memory.system.zh.cn.md](memory.system.zh.cn.md) - Memory、Crystal、Scope、codename、ContextFork、召回、遗忘和 `brain.db`。
6. [blackboard.zh.cn.md](blackboard.zh.cn.md) - route decision、Blackboard worker 与 ASK 交还。
7. [crystal.reflection.zh.cn.md](crystal.reflection.zh.cn.md) - Crystal reflection、Gem 升格和 drift repair。
8. [executive.exoskeleton.zh.cn.md](executive.exoskeleton.zh.cn.md) - Capability / Tool / Trust / Loop 与外部 sidecar。
9. [control.protocol.zh.cn.md](control.protocol.zh.cn.md) - `/ws` control protocol 与 snapshot matrix。
10. [ws.doc.zh.cn.md](ws.doc.zh.cn.md) - WebSocket 字段级手册。
11. [runtime.events.zh.cn.md](runtime.events.zh.cn.md) - event class、timeline 和 subscription surface。
12. [development.workflow.zh.cn.md](development.workflow.zh.cn.md) - worktree/tmux/Codex 协作流程。
13. [project.report.zh.cn.md](project.report.zh.cn.md) - 当前架构报告。
14. [external.kit.zh.cn.md](external.kit.zh.cn.md) - 只读 external kit discovery。
15. [external.tools.seal.zh.cn.md](external.tools.seal.zh.cn.md) - 外挂工具能力矩阵与封板标准。
16. [mcp.tools.zh.cn.md](mcp.tools.zh.cn.md) - MCP discovery、resources、prompts 和 tool execution。
17. [sandbox.capabilities.zh.cn.md](sandbox.capabilities.zh.cn.md) - sandbox、approval 和 audit 边界。
18. [skill.system.zh.cn.md](skill.system.zh.cn.md) - 外部 `SKILL.md` 能力包。
19. [refactor.roadmap.zh.cn.md](refactor.roadmap.zh.cn.md) - Bun kernel 封板路线和 drift policy。
20. [openapi/flyflor.socket.openapi.zh.cn.md](openapi/flyflor.socket.openapi.zh.cn.md) - Apifox 可导入 socket OpenAPI。
21. [apifox/README.md](apifox/README.md) - Apifox WebSocket 示例与本地 tester。
22. [../TODO.md](../TODO.md) - 当前交接和下一步工作。

## 核心口径

- Runtime context 由当前输入、`MemoryComponent`、`CrystalComponent`、显式 `Scope/Fork` 和 Executive visible capability surface 装配。
- `brain.db` 是按月 ledger/query/replay/audit/detail store，不是 prompt 容器。
- `Scope` 是显式工作域。`ContextFork` 是 scope 下的显式分支。`codename` 是 anchor/proposal/recall boost，不是隐藏 context bucket。
- ASK 负责闭合不确定性、scope promotion、fork merge conflict、crystallization gate 和 long-horizon loop pause。
- `src/socket` 拥有 socket 血管层。`gateway.*` wire 名称只保留 compatibility 语义。
- HTTP surface 固定为 `/ws` 与 `/health`；`/channels` 不恢复。

## 归档

[old-docs/](old-docs/) 存放历史材料。它们可以解释过去决策，但不能定义当前 runtime 契约。

外部 Rust shell 参考只保留归档版本：

- [old-docs/rust.integration.zh.cn.md](old-docs/rust.integration.zh.cn.md)
- [old-docs/rust.connection.core.zh.cn.md](old-docs/rust.connection.core.zh.cn.md)
- [old-docs/rust.gateway.shell.backlog.zh.cn.md](old-docs/rust.gateway.shell.backlog.zh.cn.md)

2026-05-25 文档重产已将上一版活跃文档归档到 [old-docs/2026-05-25-docs-refresh/](old-docs/2026-05-25-docs-refresh/)。
