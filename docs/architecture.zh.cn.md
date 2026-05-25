# 架构

## 定位

Flyflor 是 Bun + TypeScript 智能生命体内核。当前主线是 Cognitive-Executive-Agent Architecture：

- Cognitive 拥有流体智力、热记忆、结晶、Scope/Fork 和 ASK。
- Executive 拥有 capability 暴露、tool execution、trust、approval、quota 和 loop safety。
- Agent 拥有 runtime assembly、Blackboard、sandbox、skills、MCP、plugins、prompts 和 workers。
- Socket 通过 `/ws` 与 `/health` 暴露血管面。

本仓库只承载 Bun kernel。Rust shell 文档统一归档到 `docs/old-docs/`，只作为未来独立仓库的交接材料。

## 两张平面

Runtime context 与 ledger history 是两套系统。

| 平面 | 来源 | Owner | 目的 |
| --- | --- | --- | --- |
| Context plane | 当前输入、Memory recall、Crystal recall、显式 `activeScope`、显式 `contextForkId`、Executive visible capabilities | `src/agent/runtime`、`src/agent/context`、`src/cognitive` | 装配当前模型 turn。 |
| Ledger/query plane | 当前月 `brain.db`、archive、detail tables、replay/audit rows | `src/cognitive/hippocampus/memory/brain`、`src/entities/memory/brain`、`src/socket/query` | 保存、查询、回放、审计和检查生命历史。 |

`brain.db` 可以提供 provenance 和 replay anchor，但它不会直接变成 prompt text，也不会恢复隐藏 session continuity。

## 源码目录地图

| 路径 | 当前职责 |
| --- | --- |
| `app.ts` | 薄命令/模式入口。 |
| `src/app.ts` | Composition root，绑定 `ConfigComponent`、`EventsComponent`、`ModelComponent`、`BlackboardModule`、`MemoryModule`、`RuntimeModule` 和 `SocketModule`。 |
| `src/cognitive/mindstream` | 模型 client 和流体智力 provider adapter。 |
| `src/cognitive/hippocampus` | ASK 解析、continuation ghost state、identity append、Memory、Scope recall、codename promotion 和 ContextFork 相关 memory store。 |
| `src/cognitive/crystal` | Crystal memory、vector index、reflection candidate 和 Gem promotion。 |
| `src/executive` | Manifest loading、capability registry、trust policy、loop guard、tool runtime 和 sidecar runner contract。 |
| `src/agent/runtime` | Turn pipeline、route selection、planning blocks、MCP/tool wiring、skills、subagents、streaming visibility 和 reflection worker。 |
| `src/agent/blackboard` | Blackboard store/module 和 worker composition。 |
| `src/agent/context` | 显式 Scope/Fork normalization 和 continuity-owner key。 |
| `src/agent/sandbox` | Approval、quota、audit sinks 和 shell-hook execution gate。 |
| `src/socket` | `/ws`、`/health`、control hub、dedup、read cache 和 ledger/detail query reader。 |
| `src/events` | Runtime event types、event component、sinks 和 classifier。 |
| `src/protocol` | Contracts、enums、control envelopes、process envelopes 和 structured block registry。 |
| `src/config` | JSONC config loading、defaults 和 paths。 |
| `templates` | Runtime prompt templates、memory templates 和 project templates。 |

## 认知器官

Mindstream 是当前流体智力：模型调用、生成、局部推理和 turn-time decision。

Memory 是热区：Markdown 宪法文件、working memory episodes、recent activation、TTL decay、hot compression、dream/consolidation workers、scope-local memory 和 recall evidence。

Crystal 是晶体智力：稳定方法/知识记忆、Gem snapshot、vector recall 和 drift repair。它不是更大的聊天日志。

Scope 是显式可固化工作域。它可以拥有局部宪法、`project.memory.md`、scope-local memory/index material 和未来 skill/MCP/plugin surface。

ContextFork 是显式分支。它不会从 channel metadata 恢复。

ASK 是闭环器官，用于 uncertainty、scope promotion、fork merge conflict、blackboard cap、tool-loop pause 和 crystallization gate。

## 连续性规则

允许的连续性锚点：

- `RuntimeContext.activeScope`
- `RuntimeContext.contextForkId`
- codename 作为 proposal/anchor/recall boost
- Memory activation 和 recall evidence
- Crystal recall
- ledger provenance 与 replay references

不是连续性 owner 的字段：

- `clientId`
- `conversationKey`
- `threadId`
- connection id
- transport actor metadata
- `sourceKey` / `sourceSurface`

这些字段仍用于 routing、audit、deduplication 和 reply anchoring。

## 提示词分层

Prompt assembly 分层如下：

1. Constitution：全局 Markdown memory files，以及显式 scope 加载后的 scope-local constitution。
2. Crystal：稳定结晶知识和方法。
3. Memory：hot recall、working-memory summaries、active memory atoms 和 recall evidence。
4. Scope/Fork：显式 scope 与 context fork constraints。
5. Executive visible capability surface：只包含当前被 config、channel、trust policy、sandbox 和 loop guard 允许的 capability。
6. Request context：当前用户输入、attachments 和 turn metadata。

`brain.db` 不在这份清单里。它用于 history/detail/replay/audit 查询，也为其他 owner 提供 provenance，但不是直接 prompt 容器。

## Socket Surface

`SocketModule` 启动 Bun server，暴露：

- `GET /health`
- `GET /ws`

`/ws` 通过 `SocketControlHub` 处理 control/event envelope。它可以 dispatch `gateway.message.send`、返回 `turn.delta` / `turn.final` / `turn.error`、暴露 status/capability/history/detail snapshot，并订阅 RuntimeEvents。

`gateway.*` 名称只保留 v1 wire compatibility。架构 owner 是 `src/socket`。
