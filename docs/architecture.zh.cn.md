# 架构

## 定位

Flyflor 是 Bun + TypeScript 智能生命体内核。当前架构是通过 socket 血管面暴露的 Cognitive-Executive-Agent system。

- Cognitive 拥有流体智力、热记忆、晶体智力、Scope/Fork、codename、ASK 和召回。
- Executive 拥有 capability 暴露、工具执行、trust、approval、quota、loop safety 和 sidecar/subprocess 边界。
- Agent 拥有 runtime assembly、提示词分层、Blackboard、sandbox、skills、MCP、plugins、workers 和模型可见结构化块。
- Socket 拥有 `/ws` 与 `/health`；`gateway.*` 只保留 v1 wire compatibility 词汇。

本仓库是 Bun kernel。`flyflor-cli` 是 sibling Rust TUI shell，只消费 socket 契约，不拥有内核架构。

## 哲学分层

| 层 | 含义 | 代码 owner |
| --- | --- | --- |
| 宪法层 | 从 Markdown 文件和 scope-local constitution 加载的稳定 self/user/memory/project 规则。 | `src/cognitive/hippocampus/memory/markdown`, `templates/memory`, scope scaffolding |
| 流体智力 | Turn-time reasoning、generation、route decision、ASK decision 和模型调用。 | `src/cognitive/mindstream`, `src/agent/runtime`, `templates/prompts` |
| 热记忆 | 用于当前 prompt 的近期、激活、可作用域化、会衰减的经验。 | `src/cognitive/hippocampus/memory/working`, `hot`, `recall`, `lifecycle` |
| 晶体智力 | 被提升为 Crystal/Gem 的稳定可复用方法和知识。 | `src/cognitive/crystal` |
| 路由与黑板 | 当前轮决定直接回答还是进入 worker deliberation。 | `src/agent/runtime/blackboard`, `src/agent/blackboard` |
| ASK | 用于不确定性、scope/fork/Crystal/tool-loop 闭环的结构化用户决策边界。 | `src/cognitive/hippocampus/ask`, `src/agent/runtime/module.ts` |
| Executive 外骨骼 | cognition 之外的工具与 capability 层。 | `src/executive`, `src/agent/runtime/mcp`, `src/agent/sandbox` |
| Socket 血管层 | 外部 control/event/read-model transport。 | `src/socket`, `src/protocol/control` |

## 源码目录地图

| 路径 | 当前职责 |
| --- | --- |
| `app.ts` | 薄命令/模式入口。 |
| `src/app.ts` | 装配根，绑定 config、events、model、Blackboard、Memory、Runtime 和 Socket modules。 |
| `src/cognitive/mindstream` | 流体智力 provider adapter 和 generation client。 |
| `src/cognitive/hippocampus` | ASK、continuation state、identity append、Memory、Scope recall、codename promotion 和 ContextFork memory store。 |
| `src/cognitive/crystal` | Crystal memory、vector index、reflection candidate、Gem promotion 和 drift repair。 |
| `src/executive` | Capability registry、manifest、tool descriptor、trust policy、loop guard、MCP adapter、computer profile 和 sidecar runner contract。 |
| `src/agent/runtime` | Turn pipeline、route selection、prompt assembly、MCP/tool wiring、skills、subagents、streaming visibility 和 reflection worker。 |
| `src/agent/blackboard` | Blackboard store/module 和 worker composition。 |
| `src/agent/context` | 显式 Scope/Fork normalization 和 continuity-owner key。 |
| `src/agent/sandbox` | Approval、quota、audit sink 和 shell-hook execution gate。 |
| `src/socket` | `/ws`、`/health`、control hub、dedup、read cache 和 ledger/detail query reader。 |
| `src/events` | Runtime event type、event component、sink 和 classifier。 |
| `src/protocol` | Contract、enum、control envelope、process envelope 和 structured block registry。 |
| `src/config` | JSONC config loading、defaults 和 paths。 |
| `templates` | Runtime prompt templates、memory templates 和 project templates。 |

## 两个平面

Runtime context 与 life history 是两个系统。

| 平面 | 来源 | Owner | 目的 |
| --- | --- | --- | --- |
| Context plane | 当前输入、宪法层、Memory recall、Crystal recall、显式 `activeScope`、显式 `contextForkId`、Executive visible capabilities | `src/agent/runtime`, `src/agent/context`, `src/cognitive` | 装配当前模型轮次。 |
| Ledger/query plane | 当月 `brain.db`、archive、detail tables、replay/audit rows | `src/cognitive/hippocampus/memory/brain`, `src/entities/memory/brain`, `src/socket/query` | 存储、查询、重放、审计和检查生命历史。 |

`brain.db` 可以提供 provenance、detail rows、replay anchors 和 read-model snapshots。它不会直接变成 prompt text，也不会恢复隐藏 session continuity。

## 连续性规则

允许的连续性锚点：

- `RuntimeContext.activeScope`
- `RuntimeContext.contextForkId`
- 作为 proposal、anchor 和 recall boost 的 codename
- Memory activation 与 recall evidence
- Crystal recall
- ledger provenance 与 replay references

不是连续性 owner：

- `clientId`
- `conversationKey`
- `threadId`
- connection id
- transport actor metadata
- `sourceKey` / `sourceSurface`

这些字段仍可用于 routing、audit、deduplication 和 reply anchoring。

## 提示词分层

Prompt assembly 按以下权威顺序分层：

1. 宪法层：全局 Markdown memory files，以及显式 scope 加载后的 scope-local constitution。
2. Crystal：稳定的晶体知识和方法。
3. Memory：hot recall、working-memory summaries、active memory atoms 和 recall evidence。
4. Scope/Fork：显式 scope 与 context fork 约束。
5. Blackboard advisory：只有路由选择 deliberation 或需要 summarise worker result 时进入。
6. Executive visible capability surface：只包含 config、channel、trust policy、sandbox、approval state、quota 和 loop guard 允许的能力。
7. Request context：当前用户输入、attachments 和 turn metadata。

`brain.db` 不在提示词分层内。它由显式 reader 查询，也可以通过 Memory/Crystal owner 提供 provenance，但不是 prompt container。

## Socket 边界

`SocketModule` 启动 Bun server：

- `GET /health`
- `GET /ws`

`/ws` 通过 `SocketControlHub` 处理 control/event envelopes。它分发 `gateway.message.send`，返回 `turn.delta` / `turn.final` / `turn.error`，暴露 status/capability/history/detail snapshots，并订阅 RuntimeEvents。

CLI 闭环规则很严格：`flyflor-cli` 可以渲染 socket data、发送用户决策、请求 snapshots；它不能调用 Runtime private APIs、写 `brain.db`、虚构 memory continuity，或绕过 Executive 执行工具。
