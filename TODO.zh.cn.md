# Flyflor TODO

## 当前交接

状态：Bun 内核已封板。当前主线是 Cognitive-Executive-Agent Architecture，外显面只保留最小 WebSocket/event gateway。旧第一方实现已经从仓库移除，不保留兼容目录。

本文是下一段对话的交接说明，只描述当前契约和下一步工作。历史计划位于 `docs/old-docs/`，只能解释背景，不能反向定义运行时行为。

## 已封板契约

- 上下文装配只来自 `Memory + Crystal + explicit Scope/Fork + Executive visible capability surface`。
- `brain.db` 是 ledger/query plane，不是 prompt 容器。
- `Scope` 是唯一显式工作域。
- `ContextFork` 是 scope 下的显式分支。
- `codename` 只是锚点、提议入口和 recall boost。
- 没有显式 scope 时，不创建 fallback scope、不创建 inbox scope、不创建隐藏工作域。
- Gateway provenance 只做审计和路由元数据，不是认知连续性 owner。
- 核心 owner 只使用显式 key：`scope:<id>`、`fork:<id>`、`codename:<id>` 或 turn-local owner key。
- `activeProject` 只作为兼容输入保留；新代码、新测试、新文档必须使用 `activeScope`。
- MCP/HTTP/SSE/stdio 的协议握手可以存在于 wire 层，但它不属于 Flyflor 连续性模型。

## 本次 Reset 已完成

- 已从仓库删除旧第一方 CLI/TUI/channel 壳体代码。
- 已从核心认知和存储路径移除隐藏连续性绑定。
- 已把公开 route 身份命名从 chat 语义收口到 `conversationKey`。
- 已把核心存储字段和 owner 收口到 `owner_key`、`source_key`、`source_surface`。
- 已从核心 memory、scope、fork、graph、working-memory、summary、ask、ghost、identity、replay 假设里移除 actor/chat/channel 身份分区。
- 已把测试改成显式 scope/fork/turn-local owner，不再依赖隐式 actor 或 channel 连续性。
- 已更新文档，活动契约统一描述 Context plane 与 Ledger/query plane 的分离。
- 保留 `mindstream`、`hippocampus`、`crystal`、`dream`、`Gem` 名称。
- 提示词正文保留在 `templates/prompts`，并通过 prompt docs/manifest 校验。
- 每份 canonical Markdown 都保留同名 `.zh.cn.md` 中文审查副本。

## 当前主线

- `src/cognitive`：mindstream、hippocampus、crystal、memory、scope、dream。
- `src/executive`：capability registry、tool planning、trust/guard、computer exoskeleton。
- `src/agent`：runtime、gateway、blackboard、sandbox、context、skills、worker、MCP、plugin。
- `src/events`：runtime event fabric。
- `src/protocol`：公共协议与 WS/control envelope。
- `src/entities`：SQLite entity、repo、schema owner。
- `src/components`：component base 与共享基础设施。

当前可见主面：

- 本地 stdio debug chat。
- 最小 Gateway：`/ws`、`/health`、`/channels`。
- Rust/thin-client 契约：`docs/control.protocol.md`、`docs/ws.doc.md`、`docs/runtime.events.md`。
- Rust 实现交接：`docs/rust.integration.md`、`docs/rust.connection.core.md`、`docs/rust.gateway.shell.backlog.md`。

## 下一步工作

0. 下一阶段按“完成智能生命体内核的大重构”来组织，而不再只是零散封板修补；每次暂停或交接前都必须先把仓库内 handoff 文档更新完整。
1. 按 `docs/rust.gateway.shell.backlog.md` 实现 Rust shell slices。
2. Bun 主线继续只承载认知、Executive、WebSocket/event 协议、memory、blackboard、sandbox、MCP、plugin。
3. 继续把 `activeProject` 收缩为兼容读口；新契约不能使用它。
4. 继续保持 `brain.db` 查询/回放与 prompt 装配分离。
5. scope-local prompt recall 必须走 scope memory index、summary、vector/summary-first retrieval。
6. 新增提示词正文必须放在 `templates/prompts`，并同步 `.zh.cn.md`。
7. 新增 Markdown 必须同步 `.zh.cn.md`。
8. 修改 protocol、storage schema 或 runtime context assembly 前先补测试。
9. 在启动多 worktree 开发前，先把全部活动文档统一到“智能生命体内核”口径。
10. 为主 worktree 和未来子 worktree 引入只追加的 `LOGS.md` 控制文件。
11. 在主线架构锚点更新完成后，把第一批文档工作拆成三个子 worktree。
12. 本地切片 owner：`wt/kernel-runtime-executive-ws`。
13. 本 worktree 归属文件：
    - `src/agent/runtime/**`
    - `src/agent/gateway/**`
    - `src/executive/**`
    - 覆盖 ws control、events、history、executive loop 闭环的相关测试、文档和 smoke 脚本
14. 本地目标：
    - `/ws` 完整跑通 thin-client 生命周期，包括 hello、catalog、send、delta、final、history、loop metadata
    - executive loop pause/resume 保持显式且可观察
    - gateway/runtime 协议面稳定到足以承接 Rust shell 后续开发
15. 本地交还规则：
    - 更新本 worktree 的 `TODO.md` 与 `LOGS.md`
    - 只提交归属文件
    - 不在本分支改写主线 handoff 文档

## 红线

- 不得重新引入基于 actor、chat、channel、thread、connection 或 transport metadata 的隐式连续性 key。
- 没有显式 scope 时，不得创建 fallback scope 或 inbox scope。
- 不得把原始 `brain.db` event 流直接读进 prompt。
- 不得让 codename 重新变成隐式上下文容器。
- 不得让 blackboard 创建自己的长期 transport 级容器。
- 不得恢复已移除的第一方壳体路径或兼容壳。
- 不得新增抽象、神奇、难读的命名。
- 保持 OOP + composition 风格。
- 目录和文件名约定优先。
- 业务语义判断坚持零字符匹配红线。

## 验证

交接代码修改前必须运行：

```bash
bun run check
bun run docs:check
bun run test
bun run build:binary
```

本工作区最近一次封板验证已通过：

- `bun run check`
- `bun run docs:check`
- `bun run test`，820 个测试通过
- `bun run build:binary`

## 搜索守卫

每次重构收尾前运行仓库里的连续性词形守卫。不要为了记录检查方式，把禁用 token 明文写回文档或提示词。

```bash
bun test tests/todo.status.test.ts tests/naming.boundaries.test.ts
```

预期结果是全部通过。

## 2026-05-22 协调者模式补充

- 当前元目标已经升级：通过协调式切片完成“智能生命体内核”的大重构，而不只是维持 seal 状态。
- 主线协调者每次暂停/结束前必须完成：
  1. 更新 `TODO.md`
  2. 更新 `LOGS.md`
  3. 更新 `docs/development.workflow.md`
  4. 更新 `docs/development.workflow.zh.cn.md`
  5. push 所有变更过的 branch / worktree branch
- 当实现压力上升时，应优先新增 code worktree 并配合 tmux + Codex 并发推进，而不是把所有工作继续堆在一个线程里。
