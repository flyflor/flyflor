# Flyflor 文档

本目录只保留当前 Bun kernel 契约。活跃文档必须维护英文 `.md` 与中文 `.zh.cn.md` 同步版本；误导实现、已经退役或被新口径替代的材料统一移动到 `old-docs/`，并保留可追溯文件名。

官方主页：[https://flyflor.qingshen.xin](https://flyflor.qingshen.xin)

## 阅读顺序

1. [boundaries.zh.cn.md](boundaries.zh.cn.md) - 工程硬边界、OOP + use composition、JSONC 配置、Bun 二进制约束和零字符匹配红线。
2. [architecture.zh.cn.md](architecture.zh.cn.md) - 哲学分层、源码 owner、context/ledger 分离、socket 血管边界、提示词分层和 flyflor-cli 关系。
3. [directory.architecture.zh.cn.md](directory.architecture.zh.cn.md) - 源码 owner、命名规则和退役路径。
4. [runtime.turn.zh.cn.md](runtime.turn.zh.cn.md) - 从 `/ws` 到 Memory、Crystal、Executive 和 events 的单轮主链。
5. [memory.system.zh.cn.md](memory.system.zh.cn.md) - 宪法层、热记忆、记忆树、召回、遗忘、向量偏移、Scope、codename、ContextFork、Crystal 和 `brain.db`。
6. [blackboard.zh.cn.md](blackboard.zh.cn.md) - 路由、Blackboard worker、ASK 交还、当前轮 deliberation 和 query 边界。
7. [crystal.reflection.zh.cn.md](crystal.reflection.zh.cn.md) - Crystal reflection、Gem 升格和 drift repair。
8. [executive.exoskeleton.zh.cn.md](executive.exoskeleton.zh.cn.md) - Capability / Tool / Trust / Loop、MCP、用户工具、sidecar、subagent、approval 和 CLI 工具调用闭环。
9. [control.protocol.zh.cn.md](control.protocol.zh.cn.md) - `/ws` control protocol、snapshot matrix、thin-client bootstrap 和当前 CLI 闭环状态。
10. [ws.doc.zh.cn.md](ws.doc.zh.cn.md) - WebSocket 字段级手册和 detail query matrix。
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

- Flyflor 是 Bun + TypeScript 智能生命体内核。它不是 chat/session agent，也不是 CLI app。
- Mindstream 是流体智力：模型调用、生成、route decision 和 turn-time reasoning。
- Memory 是热的、可作用域化的、会衰减的记忆。Crystal 是可复用的晶体智力。`brain.db` 是 ledger/query/replay/audit/detail store。
- `Scope` 是显式工作域。`ContextFork` 是显式分支。`codename` 是 scope promotion 前的 anchor/proposal/recall boost。
- ASK 负责闭合不确定性、scope promotion、fork merge conflict、crystallization gate、tool-loop pause 和用户决策。
- Executive 是行动外骨骼。工具、MCP、插件、skill、sidecar、用户工具、subagent、sandbox、quota、approval 和 audit 都通过它。
- `src/socket` 拥有 socket 血管层。`gateway.*` 名称只保留 `flyflor.ws.v1` wire compatibility 语义。
- HTTP surface 固定为 `/ws` 与 `/health`；`/channels` 不恢复。

## flyflor-cli 闭环

`flyflor-cli` 是外部 Rust TUI shell。它消费 `/ws` envelope、snapshot 和 event；它不能变成 kernel、memory owner、tool executor、prompt container 或 ledger writer。

当前闭环状态：

- Kernel 本地 smoke 示例使用 `ws://127.0.0.1:8788/ws`；CLI 默认值是 `ws://127.0.0.1:8787/ws`。默认值统一前使用 `FLYFLOR_WS_URL` 显式对齐。
- Kernel 暴露 `server.hello` 与 `capability.catalog.get`；CLI bootstrap 会请求 capability catalog。
- Kernel context input 支持 `toolApprovals.mcpToolCalls` 和 `toolApprovals.userToolCalls`；CLI 通过 `/approve` 暴露非 YOLO 的单轮 approval，并继续文档化和展示 YOLO mode。
- ASK typed-answer continuation 已闭合：用户直接输入 `lint:fix` 或 `prettier:all` 等答案时，会携带最近 pending ASK continuation metadata，而不是开启一个丢上下文的新 turn。
- `/undo` 是 kernel command（`gateway.message.undo`）。CLI 只选择用户消息锚点；kernel 追加 undo audit，并把受影响的热记忆、ASK、continuation state 标记为 abandoned，不删除 `brain.db`。
- Model context-window 展示以 `gateway.status.snapshot.model.contextWindowTokens` 为权威；kernel 会按显式配置、provider model metadata、fallback mapping 的顺序解析后再交给 CLI 渲染。

## 归档

`old-docs/` 存放历史材料。它们可以解释过去决策，但不能定义当前 runtime 契约。

外部 Rust shell 参考只保留归档版本：

- [old-docs/rust.integration.zh.cn.md](old-docs/rust.integration.zh.cn.md)
- [old-docs/rust.connection.core.zh.cn.md](old-docs/rust.connection.core.zh.cn.md)
- [old-docs/rust.gateway.shell.backlog.zh.cn.md](old-docs/rust.gateway.shell.backlog.zh.cn.md)

2026-05-25 和 2026-05-26 的活跃文档快照都已经归档在带日期的 `old-docs/` 子目录中。
