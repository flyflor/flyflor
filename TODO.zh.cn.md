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
- 最小 Gateway：`/ws`、`/health`。
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
12. 在 WS 可见的智能生命体内核闭环完成前，保持当前代码 worktree 切片（`wt/kernel-context-memory`、`wt/kernel-scope-crystal-ask`、`wt/kernel-runtime-executive-ws`）持续运作。
13. 把 `bun run kernel:tmux` 固化为新环境恢复 worktree + tmux 编排的入口。
14. 从活动最小 Gateway 中移除 HTTP `/channels` 暴露面，同时保留 WS `gateway.status.get` 控制面快照通道。

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
- 已从 `main-codex-docs` 初始化的代码 worktree：
  - `wt/kernel-context-memory`
  - `wt/kernel-scope-crystal-ask`
  - `wt/kernel-runtime-executive-ws`
- 新环境恢复命令：
  - `bun run kernel:tmux`
  - `bun run kernel:tmux -- --launch-codex`

## 2026-05-22 内核整合补充

- 已把第一批三个代码切片合回 `main-codex-docs`：
  - context-memory
  - scope-crystal-ask
  - runtime-executive-ws
- 当前主线已经带上：
  - 月度 live brain shard 轮换，并在轮换后重建全新的 live `brain.db`
  - graph/crystal 召回计数与显式 gem 遗忘钩子
  - 对非 freeform ask 的结构化约束校验
  - 将 scope 触发信息固化到 `.flyflor/scope.json`
  - 覆盖 ask 暂停/恢复、事件订阅、history 回放、request correlation 的 ws thin-client 闭环测试面
- 接下来的内核缺口：
  - 从“协议闭环”的 `/ws` 覆盖继续推进到“在预期 trust surface 下的更完整 executive capability 执行”
  - 把遗忘/衰减与向量召回行为继续并入更宽的 kernel seal 验证

## 2026-05-22 Kernel Wave2 Review 补充

- [x] 已推送 wave2 子分支供协调者 review：
  - `wt/wave2-memory-seal`
  - `wt/wave2-runtime-executive`
  - `wt/wave2-scope-crystal`
- [x] 已 review 并暂存 memory seal 切片到 `main-codex-docs`：
  - activation 与 graph recall 使用确定性 tie-breaker
  - recall cache 使用注入时钟
  - contradiction audit edge 使用确定性时间戳
- [x] 已 review 并暂存 runtime/executive 切片到 `main-codex-docs`：
  - gateway control smoke 接入真实 `EventsComponent`
  - WS `event.publish` 断言 executive loop pause/resume
- [x] 已 review 并暂存 scope/crystal 切片到 `main-codex-docs`：
  - 嵌套 non-freeform ask 校验
  - codename 晋升时创建显式 scope 台账行
  - crystal gem metadata 保留 source candidate 与 consolidation evidence 溯源
- [x] HTTP Gateway 继续只保留 `/ws` 和 `/health`；没有恢复 `/channels` 暴露面。
- [x] 对合并后的 wave2 主线快照运行最终验证：
  - `bun run check`
  - `bun run docs:check`
  - `bun run build:binary`
- [x] 从 `main-codex-docs` 提交并推送已 review 的 wave2 integration。

## 2026-05-22 Kernel Wave3 编排补充

- [x] 保留此前 kernel 与 wave2 worktree；不删除旧执行历史。
- [x] 已从 `main-codex-docs@281108e` 创建新的 wave3 分支：
  - `wt/wave3-memory-lifecycle`
  - `wt/wave3-runtime-capability`
  - `wt/wave3-scope-constitution`
- [x] 已创建新的 wave3 worktree：
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-memory-lifecycle`
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-runtime-capability`
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-scope-constitution`
- [x] 已新增 `bun run kernel:tmux -- --wave3` 作为可复现恢复入口。
- [ ] 在子 Codex 开始工作前推送三个 wave3 子分支。
- [ ] 编排提交落主线后，启动 `flyflor-wave3` 子 Codex 窗口。
- [ ] 主 Codex review 规则：只把审过的实现/测试面合回 `main-codex-docs`；canonical TODO/LOGS/workflow 历史由主 worktree 统一写入。

## 2026-05-22 Wave3 Scope Constitution Review

- [x] 已 review `wt/wave3-scope-constitution`。
- [x] 已把实现/测试面合入 `main-codex-docs`：
  - `ScopeScaffolder` 现在会分发完整双语 scope 宪法层文件。
  - 已存在的 scope 文件继续保持不覆盖/幂等。
  - Scope scaffold 与 codename promotion 测试已覆盖扩展后的模板集合。
- [x] 已在主线验证：
  - `bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

## 2026-05-22 Wave3 残留清理

- [x] 已推送 `wt/wave3-memory-lifecycle` 的 validation-only 交接记录；该分支没有实现合入主线。
- [x] 已推送 `wt/wave3-runtime-capability` 的探索记录；未完成的 runtime/protocol prototype 已丢弃，没有实现合入主线。
- [x] 已推送 `wt/wave3-scope-constitution` 的本地验证日志尾巴。
- [x] 已停止活跃 wave3 子 Codex 进程，并让所有 wave3 worktree 保持 clean。

## 2026-05-22 Kernel Wave4 Runtime Capability 补充

- [x] 将 wave4 规划为同一个 P0 的三条窄 runtime capability 通道：
  - `wt/wave4-runtime-smoke`
  - `wt/wave4-runtime-metadata`
  - `wt/wave4-runtime-history`
- [x] 保留此前 kernel/wave2/wave3 worktree；wave4 只追加。
- [ ] 从 `main-codex-docs@1f45a72` 创建并推送三个 wave4 分支。
- [ ] 编排提交落主线后启动 `flyflor-wave4` 子 Codex 窗口。
- [ ] 主 Codex review 规则：只合并通过验证的实现/测试切片；失败 prototype 必须丢弃并记录，不能留下 dirty tail。
