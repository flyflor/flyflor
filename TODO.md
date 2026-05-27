# Flyflor TODO

## 当前交接

状态：Bun 内核已封板。主线已经进入 Cognitive-Executive-Agent Architecture，外显面保持最小 WebSocket/event 血管层；旧第一方 shell 代码已移除，不再保留兼容备份目录。

本文件是下一段对话的交接说明，只描述当前契约与下一步工作。历史计划统一放在 `docs/old-docs/`，不得重新定义运行时行为。

最新 owner 口径：`src/socket` 拥有 socket 血管层。TODO 旧段落里把 gateway 放在 `src/agent` 下的说法只作为历史任务状态保留，后续新工作一律以当前口径为准。

主源码移除口径：旧第一方 shell、`src/agent/gateway` 兼容壳和旧 CLI/TUI/channel adapter 主源码面不恢复；gateway 仅作为 `/ws` wire compatibility 名称保留。

2026-05-27 文档对齐口径：本轮已再次按“先归档、再重写/修订”处理会改变语义的活跃文档，归档目录为 `docs/old-docs/2026-05-27-post-tool-closure/`。`flyflor-cli` 的对应文档归档在 sibling 仓库的 `docs/old-docs/2026-05-27-post-tool-closure/`。

当前工具调用闭环状态：

- Kernel 本地 socket smoke 示例仍使用 `ws://127.0.0.1:8788/ws`，而 `flyflor-cli` 默认连接 `ws://127.0.0.1:8787/ws`；跨仓库联调仍建议用 `FLYFLOR_WS_URL` 显式对齐。
- Kernel `/ws` 已暴露 `server.hello`、`capability.catalog.get` 和 `capability.catalog.snapshot`；`flyflor-cli` bootstrap 已发送 `capability.catalog.get`。
- Kernel context input 已支持 `toolApprovals.mcpToolCalls` 与 `toolApprovals.userToolCalls`；`flyflor-cli /approve` 已闭合普通 per-turn approval UX，YOLO 仍是独立高权限模式。
- ASK typed answer continuation 已闭合：用户直接输入 `lint:fix`、`prettier:all` 等答案时，CLI 会附带最近 pending ASK continuation metadata，kernel 保留原始任务和当前答案，不再开新 turn 丢上下文。
- 2026-05-27 kernel ASK permission 补丁：Executive 工具暂停 ASK 现在声明 `answerContract.kind = "citizen-permission"` 且要求 `metadata.askAnswer`；裸 `continue-tools` / `keep-budget` / `keep-subagents` 文本不会被内核当作继续授权。
- 2026-05-27 kernel event 补丁：Executive pause 会发布 `tool.ask_required` / `tool.budget.exhausted`，MCP 工具完成会同步发布 `tool.succeeded` / `tool.failed`，`process.run` 会发布 `process.start` / `process.exit`。
- `/undo` 已从本地 UI 回滚升级为 `gateway.message.undo`：CLI 发送撤销 command，kernel 追加 undo audit event，并把撤销范围内的 event、ASK、continuation 和 ask-answer memory state 标记为 `abandoned`，不删除 `brain.db` 账本。
- Model/Status 最大上下文窗口已改为动态解析：显式 `contextWindowTokens` 优先，其次 provider `/models` metadata，再退回已知 fallback；CLI 以 gateway 下发值为权威。
- 下一阶段实现仍必须先补测试，再改协议或 UI；CLI 只能提交用户决策、continuation、undo 和 approval payload，不能本地执行工具或写 `brain.db`。

## 已封板契约

- 上下文装配是 `Memory + Crystal + explicit Scope/Fork + Executive visible capability surface`。
- `brain.db` 是 ledger/query 平面，不是 prompt 容器。
- `Scope` 是唯一显式工作域。
- `ContextFork` 是 scope 下的显式分支。
- `codename` 只作为锚点、提案入口和召回增强。
- 没有显式 scope 时，不创建 fallback scope、inbox scope 或隐藏工作域。
- Gateway provenance 只作为审计/路由 metadata，不是认知连续性 owner。
- 核心归属使用显式 owner key：`scope:<id>`、`fork:<id>`、`codename:<id>` 或 turn-local owner key。
- `activeProject` 只是兼容输入；新代码、测试和文档必须使用 `activeScope`。
- MCP/HTTP/SSE/stdio 协议握手可以存在于 wire 层，但它们不是 Flyflor 连续性。

## 本轮重置已完成

- 从仓库移除了旧第一方 CLI/TUI/channel shell 代码。
- 从核心认知与存储路径移除了隐藏连续性绑定。
- 将 public route identity 从 chat 导向命名改为 `conversationKey`。
- 将核心存储列和 owner 命名改为 `owner_key`、`source_key` 和 `source_surface`。
- 从核心 memory、scope、fork、graph、working-memory、summary、ask、ghost、identity 和 replay 假设中移除了 actor/chat/channel identity 字段。
- 调整测试，使用显式 scope/fork/turn-local owner，而不是隐式 actor 或 channel 连续性。
- 更新文档，使活动契约把 Context plane 与 Ledger/query plane 描述为彼此分离的系统。
- 保留 `mindstream`、`hippocampus`、`crystal`、`dream` 和 `Gem` 命名。
- 保持 prompt 文案放在 `templates/prompts`，并验证 prompt docs/manifest 同步。
- 保持 runtime prompt 模板与 `.zh.cn.md` 中文审查副本配对；`AGENTS.md`、`TODO.md`、`LOGS.md` 是控制文件，根目录和所有 worktree 内都必须统一使用中文编写，且不创建 `.zh.cn.md` 副本。

## 当前主线

- `src/cognitive`：mindstream、hippocampus、crystal、memory、scope、dream。
- `src/executive`：capability registry、tool planning、trust/guard、computer exoskeleton。
- `src/agent`：runtime、gateway、blackboard、sandbox、context、skills、worker、MCP、plugin。
- `src/events`：runtime event fabric。
- `src/protocol`：公共契约与 WS/control envelope。
- `src/entities`：SQLite entity、repo、schema owner。
- `src/components`：component base 与共享基础设施。

主要可见 surface：

- 本地 stdio debug chat。
- 最小 Gateway：`/ws`、`/health`。
- Thin-client 契约：`docs/control.protocol.md`、`docs/ws.doc.md`、`docs/runtime.events.md`。
- 已归档 Rust 实现交接：`docs/old-docs/rust.integration.md`、`docs/old-docs/rust.connection.core.md`、`docs/old-docs/rust.gateway.shell.backlog.md`。

## 2026-05-22 Kernel Integration Wave 2

- [x] 从活动最小 Gateway 中移除了 HTTP `/channels` surface。
- [x] 保持 WS `gateway.status.get` control snapshot lane 不变。
- [x] 在 gateway status snapshot 中保留 live `clientCount`，让 peer pressure 在不恢复 `/channels` 的情况下保持可观测。
- [x] 将 context-memory clock-driven recall 切片合回主线，并重新运行主线验证集。
- [x] 固定 Rust/thin-client 文档与文档 guard，使 `clientCount` 始终定义为 live WS peer count，而不是静态 channel count。

## 2026-05-22 Kernel Wave 2 Tmux 编排

- [x] 保留并推送之前 `wt/kernel-scope-crystal-ask` ready-for-review 控制提交。
- [x] 从 `main-codex-docs@c6d963f` 创建新的 wave2 worktree。
- [x] 启动 `flyflor-wave2` tmux 编排，包含 memory、runtime 和 scope 子 Codex 窗口。
- [x] 增加 `bun run kernel:tmux -- --wave2` 作为可复现恢复入口。
- [x] Review 并合并 `wt/wave2-memory-seal`。
- [x] Review 并合并 `wt/wave2-runtime-executive`。
- [x] Review 并合并 `wt/wave2-scope-crystal`。
- [x] wave2 切片落地后运行主线验证。

## 下一步工作

0. 下一阶段按协调式大重构处理，目标是完整智能生命体内核，而不是孤立 seal 修补；每次暂停或交接前都必须更新仓库交接文档。
1. Rust shell 切片保持在这个 Bun 仓库之外；归档交接材料放在 `docs/old-docs/`。
2. Bun 主线继续聚焦 cognition、Executive、WebSocket/event protocol、memory、blackboard、sandbox、MCP 和 plugin surface。
3. 继续把 `activeProject` 收缩到兼容路径；新契约不得使用它。
4. 保持 `brain.db` query/replay 行为与 prompt assembly 分离。
5. scope-local prompt recall 必须经过 scope memory index、summary 和 vector/summary-first retrieval。
6. 所有新增 prompt 文案放在 `templates/prompts`，并保持 `.zh.cn.md` 副本。
7. `AGENTS.md`、`TODO.md`、`LOGS.md` 是控制文件，根目录和所有 worktree 内都必须统一使用中文编写；除 README 与模板镜像外，不创建机械 `.zh.cn.md` 副本。
8. 修改 protocol、storage schema 或 runtime context assembly 前必须先加测试。
9. 启动多 worktree 实现前，先让所有活动文档对齐“智能生命体内核”叙事。
10. 为主 worktree 和未来子 worktree 引入 append-only `LOGS.md` 控制文件。
11. 主线 architecture anchor 更新后，把第一轮文档工作拆成三个子 worktree。
12. 保持当前代码 worktree 拆分（`wt/kernel-context-memory`、`wt/kernel-scope-crystal-ask`、`wt/kernel-runtime-executive-ws`）存活，直到 WS 可见的智能生命体内核 loop 完成。
13. 保留 `bun run kernel:tmux` 作为新环境恢复 worktree + tmux 编排的入口。
14. HTTP Gateway 继续收缩为 `/ws` 和 `/health`，同时保留 WS `gateway.status.get` control snapshot lane 和 live peer-count 信号。

## 红线

- 不得重新引入基于 actor、chat、channel、thread、connection 或 transport metadata 的隐式连续性 key。
- 没有显式 scope 时，不得创建 fallback scope 或 inbox scope。
- 不得把原始 `brain.db` event stream 直接读入 prompt。
- 不得把 codename 变成隐式上下文容器。
- 不得让 blackboard 创建自己的长寿命 transport-level container。
- 不得恢复已移除的第一方 shell path 或 compatibility shell。
- 不得添加魔法抽象或晦涩命名。
- 保持 OOP + composition 风格。
- 保持目录与文件名约定作为第一契约。
- 保持业务语义零字符匹配。

## 验证

交接代码变更前运行：

```bash
bun run check
bun run docs:check
bun run test
bun run build:binary
```

本工作区最近一次封板验证已通过：

- `bun run check`
- `bun run docs:check`
- `bun run test:kernel`，`244 pass`，`0 fail`
- `flyflor-cli cargo fmt --check`
- `flyflor-cli cargo test`，`178 pass`，`0 fail`
- `bun run build:binary`

## 2026-05-25 文档重产

- [x] 将与当前源码/架构不匹配的活跃文档归档到 `docs/old-docs/2026-05-25-docs-refresh/`，保留原文件名和中英文版本。
- [x] 重产根 README、docs 索引、architecture、directory、runtime、memory、blackboard、crystal、executive、control、ws、runtime events、development workflow 和 project report。
- [x] 固定 `brain.db` 只负责 ledger/query/replay/audit/detail，不写成 prompt 容器。
- [x] 固定提示词分层为 Constitution / Crystal / Memory / Scope/Fork / Executive visible capability / request context。
- [x] 保持 HTTP surface 为 `/ws` 与 `/health`，`gateway.*` 只作为 wire compatibility。

## 搜索 Guard

结束重构回合前，运行活动测试套件中的仓库连续性词汇 guard。不要为了记录检查而把禁用 token 粘贴进文档或 prompt。

```bash
bun test tests/todo.status.test.ts tests/naming.boundaries.test.ts
```

预期结果是 clean pass。

## 2026-05-24 TUI 第一阶段内核联调

- [x] 审查 `src/protocol/contracts/enums.ts`、`src/protocol/control/envelope.ts`、`src/socket/control.ts`、`src/socket/module.ts` 中已有 `fork.create` 改动。
- [x] 保留 `fork.create` 作为 socket/control 层状态变更命令，不进入 `RuntimeModule.handleMessage`，不改 MemoryModule / Executive 主链。
- [x] 通过注入回调调用 `RuntimeModule.createContextFork(...)`，并返回 `fork.snapshot.payload.data.fork`。
- [x] 固定 owner key 规则：scope 优先，其次 parent/context fork，最后 turn-local request。
- [x] 更新 `controlState.activeFork`，让 TUI 可用 `gateway.status.get` 看到最新 active fork。
- [x] 确认 query read model 能支持 `history.list`、`history.detail.get`、`ask.list`、`ask.detail.get`、`fork.list`、`fork.detail.get`、`blackboard.detail.get`、`task.list`、`task.detail.get`、`replay.list`、`replay.detail.get`、`thought.detail.get`。
- [x] 同步 OpenAPI/Apifox socket 契约与文档示例。
- [x] 补充 `docs/ws.doc.md` / `docs/ws.doc.zh.cn.md` 中 `fork.create` 请求、响应与 owner key 规则。
- [x] 补充 `docs/ws.doc.md` / `docs/ws.doc.zh.cn.md` 中 TUI 第一阶段 detail query envelope matrix，明确 detail 响应统一走 `payload.data`。
- [ ] 若 TUI 第一阶段需要可点击创建 fork 的真实端到端 smoke，再新增一条真实 `/ws` client 场景测试覆盖 `fork.create -> fork.detail.get -> gateway.status.get`。

## 2026-05-24 xtools 执行层并发开发

- [x] 将现有 WS/OpenAPI/socket read-cache 改动收拢为 baseline 提交，避免从脏 master 开 worktree。
- [x] 所有新 worktree 和 tmux session 统一使用 `xtools-*` 前缀，不触碰其他正在工作的 `flyflor-*` session。
- [x] 创建 `feature/xtools-core-exec`，负责 Codex/OpenCode 风格 workspace/git/process/shell 底层执行原语强化。
- [x] 创建 `feature/xtools-subagent`，负责 `subagent.batch` 前台批量子代理、预算隔离和 brain.db 关联审计。
- [x] 创建 `feature/xtools-external-kit`，负责 browser/screen/computer/vision/audio/web/lsp/task 外挂工具发现、descriptor、mock sidecar 和安装脚本。
- [x] 三个 worktree 均追加中文 `AGENTS.md`、`TODO.md`、`LOGS.md` 控制段，并提交 lane control commit。
- [x] 三个 worktree 均链接主仓库 `node_modules`，避免重复安装。
- [x] 启动 `xtools-core-exec`、`xtools-subagent`、`xtools-external-kit` 三个 tmux Codex 子进程。
- [ ] 主 Codex 持续轮询三个子进程，防止偏离 scope/memory/vector 主链和避免外挂工具重复实现文件读写。
- [ ] 合并顺序固定为 core-exec -> subagent -> external-kit；每次合并前统计 diff、review、跑 focused tests。
- [ ] 最终运行 `bun run check`、`bun run build:binary`、WS/工具/子代理/外挂 detector 场景测试，并输出代码量与完成报告。

## 2026-05-24 xtools-docs-ws 文档封板

- [x] 在 `feature/xtools-docs-ws` 内补齐三层工具模型文档：内建 coding 工具、原子 process-json sidecar、未来高层 `computer.use`。
- [x] 在 External Kit 与 External Tools Seal 文档中固定 compatibility matrix、provider/delegate `unavailable` / `failed` 语义、`.config/tools` 治理面和 WS/TUI 只读消费边界。
- [x] 保持本切片只改文档和控制文件，不修改源码、sidecar、package metadata 或 OpenAPI。
- [x] 已运行 `bun run docs:check`、`bun test tests/docs.references.test.ts tests/docs.index.test.ts` 和 `git diff --check`。

## 2026-05-22 Seal 补充

- 主协调分支：`main-codex-docs`
- 已 review 的子分支保持已推送，供恢复使用：
  - `wt/docs-memory-philosophy`
  - `wt/docs-scope-ask`
  - `wt/docs-protocol-events`
- 新 session 的恢复路径已封板：
  - 旧月度 `brain.db` shard 会在创建 owner index 前自升级缺失的 `memory_events` 列
  - `working.memory.recovery.smoke.ts` 现在运行在隔离 temp home 中，并强制显式 `FLYFLOR_HOME`，因此 repo worktree 不再把 `.config/prompts` 或 WAL 状态泄漏进 smoke recovery
- 新 session 恢复规则：
  1. 读取 `docs/boundaries.md`
  2. 读取 `docs/development.workflow.md`
  3. 检查 `git status --short --branch`
  4. 检查 `git worktree list`
  5. 根据文档中的分支所有权图重建 tmux/worktree 执行

本工作区最近一次完整 seal 验证已通过：

- `bun run kernel:seal`
- deterministic suite：`821 pass`，`0 fail`
- `bun run smoke:agent`
- `bun run smoke:recovery`
- `bun run build:binary`
- `bun run build:binary:docker`
- `bun run test:live`
- `bun run smoke:agent:live`

## 2026-05-22 Gateway Control Slice 补充

- 为 Rust shell 交接路径新增真实 `/ws` thin-client smoke：
  - `server.hello`
  - `gateway.status.get`
  - `capability.catalog.get`
  - `gateway.message.send`
  - `turn.delta`
  - `turn.final`
- 这个 smoke 是确定性的，并使用 scripted streaming model，因此可以在没有 live provider 成本的情况下验证稳定 control surface。

## 2026-05-22 Coordinator Mode 补充

- 当前 meta-goal 已经大于 seal 维护：用协调切片完成智能生命体内核重构。
- 主线协调者每次暂停/停止规则：
  1. 更新 `TODO.md`
  2. 更新 `LOGS.md`
  3. 更新 `docs/development.workflow.md`
  4. 让出仓库前推送所有已变更分支/worktree 分支
- 实现压力上升时，把代码工作拆进新的 `git worktree + tmux + Codex` 切片，而不是把单线程拉得过长。
- 从 `main-codex-docs` 初始化的活动代码 worktree：
  - `wt/kernel-context-memory`
  - `wt/kernel-scope-crystal-ask`
  - `wt/kernel-runtime-executive-ws`
- 新环境恢复命令：
  - `bun run kernel:tmux`
  - `bun run kernel:tmux -- --launch-codex`

## 2026-05-22 Kernel Integration 补充

- 已将前三个代码切片合回 `main-codex-docs`：
  - context-memory
  - scope-crystal-ask
  - runtime-executive-ws
- 主线现在包含：
  - 月度 live brain shard rollover，会重新创建新的 live `brain.db`
  - graph/crystal recall 计数与显式 gem forgetting hook
  - ask parser 对 non-freeform structured ask 的强制校验
  - scope scaffold trigger 持久化到 `.flyflor/scope.json`
  - ws thin-client loop closure 覆盖 ask pause/resume、event subscription、history replay 和 request correlation
- 立即需要补齐的内核缺口：
  - 从 protocol-closed `/ws` loop coverage 推进到目标 trust surface 下更完整的端到端 executive capability execution
  - 继续把 forgetting/decay 与 vector recall 行为纳入更广的 kernel seal validation

## 2026-05-22 Kernel Wave2 Review 补充

- [x] 推送 wave2 子分支供协调者 review：
  - `wt/wave2-memory-seal`
  - `wt/wave2-runtime-executive`
  - `wt/wave2-scope-crystal`
- [x] Review 并 staged memory seal 切片到 `main-codex-docs`：
  - deterministic activation 与 graph recall tie-breaker
  - injected recall cache clock 使用
  - deterministic contradiction audit edge timestamp
- [x] Review 并 staged runtime/executive 切片到 `main-codex-docs`：
  - 真实 `EventsComponent` gateway control smoke wiring
  - WS `event.publish` 对 executive loop pause/resume 的断言
- [x] Review 并 staged scope/crystal 切片到 `main-codex-docs`：
  - nested non-freeform ask validation
  - codename promotion 时显式创建 scope ledger row
  - source candidate 与 consolidation evidence 的 crystal gem metadata provenance
- [x] 保持 HTTP Gateway 收缩到 `/ws` 和 `/health`；没有恢复 `/channels` surface。
- [x] 对已合并 wave2 snapshot 运行最终主线验证：
  - `bun run check`
  - `bun run docs:check`
  - `bun run build:binary`
- [x] 从 `main-codex-docs` 提交并推送已 review 的 wave2 integration。

## 2026-05-22 Kernel Wave3 编排补充

- [x] 保持所有 previous kernel 和 wave2 worktree 完整；不删除旧执行历史。
- [x] 从 `main-codex-docs@281108e` 创建新的 wave3 分支：
  - `wt/wave3-memory-lifecycle`
  - `wt/wave3-runtime-capability`
  - `wt/wave3-scope-constitution`
- [x] 创建新的 wave3 worktree：
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-memory-lifecycle`
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-runtime-capability`
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-scope-constitution`
- [x] 增加 `bun run kernel:tmux -- --wave3` 作为可复现恢复入口。
- [x] 子工作开始前推送三个 wave3 子分支。
- [x] 编排提交落地后启动 `flyflor-wave3` 子 Codex 窗口。
- [x] 主 Codex review 规则：只把已 review 的 implementation/test surface 合回 `main-codex-docs`；canonical TODO/LOGS/workflow 历史由主 worktree 写入。

## 2026-05-22 Wave3 Scope Constitution Review

- [x] 已 review `wt/wave3-scope-constitution`。
- [x] 将 implementation/test surface 合入 `main-codex-docs`：
  - `ScopeScaffolder` 现在分发完整双语 scope constitution 文件。
  - 已存在 scope 文件保持 no-overwrite/idempotent。
  - Scope scaffold 与 codename promotion 测试覆盖扩展后的模板集。
- [x] 在主线验证：
  - `bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

## 2026-05-22 Wave3 残留清理

- [x] 推送 `wt/wave3-memory-lifecycle`，只带 validation-only handoff notes；该分支没有合入实现。
- [x] 推送 `wt/wave3-runtime-capability`，带探索记录；不完整 runtime/protocol prototype 已丢弃，该分支没有合入实现。
- [x] 本地 validation log tail 后推送 `wt/wave3-scope-constitution`。
- [x] 停止活动 wave3 子 Codex 进程，并让所有 wave3 worktree 保持 clean。

## 2026-05-22 Kernel Wave4 Runtime Capability 补充

- [x] 将 wave4 规划为一个 P0，拆成三条窄 runtime capability lane：
  - `wt/wave4-runtime-smoke`
  - `wt/wave4-runtime-metadata`
  - `wt/wave4-runtime-history`
- [x] 保持 previous kernel/wave2/wave3 worktree 完整；wave4 是 additive。
- [x] 从 `main-codex-docs@1f45a72` 创建并推送三个 wave4 分支。
- [x] 编排提交落地后启动 `flyflor-wave4` 子 Codex 窗口。
- [x] 主 Codex review 规则：只合入通过验证的 implementation/test 切片；失败 prototype 必须丢弃并记录，不能留下 dirty tail。
- [x] wave4 子输出落地时逐个 review，并保持主线 canonical TODO/LOGS/workflow 历史与本地子记录分离。

## 2026-05-22 Wave4 Runtime Capability Review

- [x] Review `wt/wave4-runtime-metadata` 并合并 implementation/test surface：
  - typed `executiveToolExecutions` live reply metadata
  - bounded MCP/user capability execution projection
- [x] Review `wt/wave4-runtime-history` 并合并 control/history surface：
  - compact planning replay metadata
  - 从 structured ledger provenance 投影的 replay-only execution metadata
  - 不包含 session restore 或 prompt assembly path
- [x] Review `wt/wave4-runtime-smoke`，在把新的 history success 断言替换为 structured execution metadata checks 后合并 smoke/test surface。
- [x] 使用 focused gateway/runtime/history tests、`bun run check`、`bun run docs:check`、`git diff --check` 和 `bun run build:binary` 验证整合后的主线 snapshot。
- [x] 停止活动 wave4 子 Codex 进程，并把 `flyflor-wave4` tmux layout 保留为可恢复 shell 窗口。
- [x] 确认主线和所有 wave4 worktree clean 且已与 origin 同步。

## 2026-05-22 Socket Wire Closure 补充

- [x] 为计划中的 A-E 拆分创建 additive socket-wire worktree：
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.core`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.openapi`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/life.constitution.docs`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.tests`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/ledger.context.boundary`
- [x] 创建 `flyflor-socket-wire` tmux layout，包含 main/A/B/C/D/E 窗口。
- [x] 子 agent 被重定向到 review mode 后，主 Codex 接管实现，保持 worktree 历史 additive，并避免 stale child edit。
- [x] 将活动 socket owner 从 `src/agent/gateway` 移到 `src/socket`，同时保留 `flyflor.ws.v1`、`flyflor.event.v1`、`/ws`、`/health` 和 `gateway.*` wire-v1 compatibility name。
- [x] 新增 `SocketModule` 和 `SocketControlHub` 作为活动内部名称，并为现有 v1 Gateway control vocabulary 保留 compatibility export。
- [x] 新增 Apifox 可导入契约：
  - `docs/openapi/flyflor.socket.openapi.json`
  - `docs/openapi/flyflor.socket.openapi.md`
  - `docs/openapi/flyflor.socket.openapi.zh.cn.md`
- [x] 将 `gateway.message.send`、`gateway.status.get` 和 `gateway.status.snapshot` guard 为稳定 wire-v1 compatibility string。
- [x] 重申 `history.list` 只是 `brain.db` ledger/query/replay/audit，不是 session restore，也不是 prompt/context assembly。
- [x] 对 socket wire closure 运行最终完整验证：
  - focused socket/wire tests
  - ledger/context tests
  - docs checks
  - `bun run check`
  - `bun run build:binary`
- [x] 从 `main-codex-docs` 提交并推送已 review 的 socket wire closure。

## 2026-05-22 Socket Wire Closure 最终状态

- [x] 当前活动 socket owner 是 `src/socket`；任何旧 TODO 中把 gateway 放在 `src/agent` 下的说法都是历史状态，后续新工作以当前口径为准。
- [x] HTTP surface 保持 `/health` 和 `/ws`；`/channels` 继续移除。
- [x] Wire-v1 compatibility 对 `flyflor.ws.v1`、`flyflor.event.v1`、`gateway.message.send`、`gateway.status.get` 和 `gateway.status.snapshot` 保持锁定。
- [x] `docs/openapi/flyflor.socket.openapi.json` 已存在用于 Apifox 导入，并由 docs reference tests guard。
- [x] `brain.db` 保持 ledger/query/replay/audit only；context assembly 保持 Memory + Crystal + explicit Scope/Fork + Executive visible capability surface。
- [x] 最终验证已通过：
  - `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts`
  - `bun test tests/tui.chat.history.test.ts tests/memory.brain.wire.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts`
  - `bun test tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/runtime.executive.boundaries.test.ts`
  - `bun run docs:check`
  - `bun run check`
  - `bun run build:binary`
  - `git diff --check`

## 2026-05-22 Polish 补充

- [x] 覆盖旧 top-level handoff 中仍把 gateway 放在 `src/agent` 下的说法；活动 owner 是 `src/socket`。
- [x] `flyflor gateway`、`GatewayMessage` 和 `gateway.*` 命名只保留为 CLI/wire compatibility vocabulary，不作为 architecture owner name。
- [x] 新增 `flyflor socket` / `bun run socket` 作为 primary socket entrypoint，同时保留 `gateway` alias 用于兼容。
- [x] 将 service smoke、quality gate、README command 和 workflow docs 转向 socket-first naming。
- [x] 用 `SocketClientEnvelope`、`flyflor.event.v1` event.publish 示例、`history.list` / `gateway.message.send` required payload schema 和 `client.hello` shape alignment 收紧 Apifox OpenAPI。
- [x] Guard docs，禁止 `event.subscribe.classes=["gateway"]`；示例现在使用 `classes=["control"]`。
- [x] 最终 polish 验证通过：
  - `bun run docs:check`
  - `bun run check`
  - focused socket/install/docs tests
  - `bun run test`
  - `bun run build:binary`
  - `git diff --check`

## 2026-05-22 Socket Owner Polish Pass 2

- [x] 将 working-memory recovery smoke startup 从旧 `gateway` 命令切到 primary `socket` 命令，同时保持现有 `gateway` config schema 不变。
- [x] 将 FlyFlor composition-root internals 从 `gateway` 重命名为 `socket`，并保留 legacy `gateway` injection alias 用于兼容。
- [x] Polish 活动 Executive/README/tmux 措辞，让 non-wire owner language 指向 socket 而不是 Gateway。

## 2026-05-22 Control State Reconciliation

- [x] 覆盖较旧的 `Current Mainline` 措辞：`src/socket` 是活动 socket 血管 owner，`src/agent` 拥有 runtime/blackboard/sandbox/context/skills/worker/MCP/plugin。
- [x] 用最新完整 deterministic suite 计数覆盖旧验证计数：`838 pass`，`0 fail`。
- [x] 将已 review 的 wave2 和 wave3 orchestration checklist item 标记完成，同时不删除其历史位置。
- [x] 对齐 workflow handoff，使 wave4 和 socket-wire layout 被描述为已 review/可恢复历史，而不是活动 child-agent work。

## 2026-05-22 Socket Smoke Entrypoint Polish

- [x] 将 `scripts/socket.control.smoke.ts`、`scripts/socket.ask.loop.smoke.ts`、`scripts/socket.service.smoke.ts` 和 `scripts/socket.dev.sh` 提升为活动 smoke/dev entrypoint。
- [x] `scripts/gateway.*` 只保留为 compatibility wrapper；`gateway.*` 仍是 wire-v1/CLI compatibility vocabulary，不是活动 architecture owner。
- [x] 将 `smoke:socket:*`、README dev guidance 和 focused smoke tests 指向 socket-primary entrypoint。
- [x] 为本次 polish pass 运行 focused socket smoke/install/docs checks、full suite、binary build 和 diff hygiene。

## 2026-05-22 Seal Wave Real-Model 分配

- [x] 新 seal wave 前重置为单一 `master` 主线。
- [x] 从 `master` 创建 coordinator branch `codex/seal-coordinator`。
- [x] 创建 seal wave worktree：
  - `/Users/yi./Desktop/yi/flyflors/worktrees/docs.alignment.control`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.scenarios`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/prompt.optimization.seal`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/db.context.guard`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/zero.character.audit`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/release.binary.seal`
- [x] 本 wave 只分配给 Bun kernel seal；Rust 明确不在本仓库内，后续单独开发。
- [x] 合并并推送本 wave 的 socket-only subset：
  - `codex/apifox-openapi-scenarios`
  - `codex/socket-live-model-scenarios`
- [x] 使用 focused socket/protocol/docs tests、`bun run docs:check`、configured-provider readiness、`smoke:socket:live` 和 `test:live` 验证 socket-only subset。
- [x] scope 收窄到 socket layer 与 OpenAPI/Apifox 后，暂停本轮更宽的 docs/prompt/DB/zero-character/release lane。
- [x] 停止旧活动 tmux development session，同时保留其 worktree 作为 additive history。
- [x] 从 `codex/seal-coordinator` 重新分配新的 socket-only tmux/worktree wave。
- [x] 新 socket-only merge order 是 runtime wire polish、OpenAPI/Apifox drift polish、live scenario coverage。
- [x] 最终 socket-only acceptance 通过 focused socket tests、OpenAPI/docs guards、provider readiness、`smoke:socket:live`、`test:live`、`bun run check` 和 diff hygiene。

## 2026-05-22 Socket/OpenAPI-Only 重新分配

- [x] 当前 coordinator branch 是 `codex/seal-coordinator`，位于 `e5102a5`。
- [x] `docs/openapi/flyflor.socket.openapi.json` 已存在，并为 Apifox 导入提供 guard。
- [x] `scripts/socket.live.scenario.ts` 与 `smoke:socket:live` 已存在，并能通过 configured provider。
- [x] `/channels` 保持移除；HTTP socket surface 保持 `/health` 与 `/ws`。
- [x] `gateway.*` 命名只保留为 v1 wire compatibility。
- [x] 在 `/Users/yi./Desktop/yi/flyflors/worktrees/socket.runtime.wire.polish` 创建 `codex/socket-runtime-wire-polish`。
- [x] 在 `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.drift.guard` 创建 `codex/apifox-openapi-drift-guard`。
- [x] 在 `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.coverage` 创建 `codex/socket-live-coverage`。
- [x] 启动 `flyflor-socket-openapi` tmux，包含 main/runtime/openapi/live 窗口。
- [x] Review、merge、validate、push 并清理本 socket-only wave。

## 2026-05-22 Socket Runtime Wire Polish

- [x] 保持 `/health` 返回 `{ ok: true }`，并让 `/ws` 作为唯一 upgrade route；`/channels` 保持 404。
- [x] 保持 `flyflor.ws.v1`、`flyflor.event.v1` 和 `gateway.*` v1 wire string 不变。
- [x] 授权后的 `/ws` upgrade 失败时返回 structured JSON。
- [x] 对 invalid control protocol input，在 `error` envelope 中保留 protocol parse details。
- [x] 使用 focused gateway/control tests、`bun run check` 和 `git diff --check` 验证。

## 2026-05-22 Socket/OpenAPI-Only Wave 最终状态

- [x] 合并 `codex/socket-runtime-wire-polish` commit `923f5cb`。
- [x] 合并 `codex/apifox-openapi-drift-guard` commit `6ed3e71`。
- [x] 合并 `codex/socket-live-coverage` commit `5f91d77`。
- [x] 为 `/ws` 400 `gateway_control_upgrade_failed` 增加 coordinator OpenAPI closeout。
- [x] `smoke:socket:live` 现在能在 configured provider 上证明 capability catalog、socket `event.publish`、`turn.delta`、`turn.final` 和 `history.list` replay。
- [x] 没有改变 wire-v1 string，没有改变 DB/context schema，`/channels` 保持移除。

## 2026-05-22 Scope Vector Seal Wave

- [x] 将 `flyflor-seal` tmux 从单一 coordinator window 扩展到所有活动 worktree lane。
- [x] 创建额外 Scope Vector worktree：
  - `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.core`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.tests`
- [x] 主 coordinator 在 coordinator worktree 中实现已验证的 Scope Vector baseline：
  - 独立 Scope Vector DB，现在默认指向每个 Scope 项目的 `.flyflor/scope.db`
  - `ScopeVectorComponent`
  - deterministic Scope vector codec
  - bounded hot subtree recall
  - MemoryModule prompt/turn/scope/codename integration
- [x] Scope Vector 保持 `brain.db` 为 ledger/query/replay/audit only，不给永久 Scope entity 添加 forgetting curve。
- [x] 验证 coordinator Scope Vector baseline：
  - `bun test tests/scope.vector.test.ts tests/context.scope.test.ts tests/codename.promote.test.ts tests/memory.brain.wire.test.ts`
  - `bun run check`
  - `git diff --check`
- [x] Socket runtime wire worker 报告不需要 runtime 变更；v1 wire 与 `/health` + `/ws` surface 保持稳定。
- [x] Apifox/OpenAPI worker polish `docs/openapi/**`；wire string、DB schema 和 context assembly 不变。
- [x] Prompt optimization worker 在其 worktree 中完成 canonical `.md` 和 `.zh.cn.md` prompt 更新。
- [x] DB/context worker 完成 ledger/query/replay guard review，仅有 test-only fix；DB schema 和 context assembly 不变。
- [x] Socket coverage worker 只添加 socket regression coverage；product logic 不变。
- [x] Release/binary worker 通过 binary/install/docker-dev/release-assets/socket-service checks；`smoke:release` 只被 Docker daemon 未运行阻塞。
- [x] 按 conflict-aware 顺序 review 并 merge 已完成的 worktree diff 到 `codex/seal-coordinator`。
- [x] 收集 zero-character 与 Scope Vector 子报告，然后决定合并其工作还是保留为 review evidence。
- [x] merge 后运行最终 seal validation。

## 2026-05-22 Full Worktree Closeout Review

- [x] 用真实 Codex worker 启动所有记录的 `flyflor-seal` tmux/worktree lane，而不是 idle shell。
- [x] 接受 socket-runtime naming polish：internal logs 现在使用 `socket.control`；v1 `gateway.*` wire string 保持不变。
- [x] 接受 socket coverage 增量，覆盖 successful `/ws` upgrade 与 correlated `turn.delta` / `turn.final` envelope。
- [x] 接受 OpenAPI drift guard 增量，把 Apifox schema enum 和 example 绑定回 runtime protocol reader。
- [x] 接受 zero-character audit 扩展，覆盖 blackboard、worker、context、full memory、scope 和 Executive semantic path。
- [x] 保持 coordinator `ScopeVectorComponent` 为 canonical；拒绝本轮 child `scope-vector-core` alternate `src/entities/scope` owner split。
- [x] 拒绝 `scope-vector-tests` proposal tests，因为它们是 skipped/proposal-shaped，且重复 canonical Scope Vector test surface。
- [x] 拒绝 socket-live worker 将 provider-not-ready 从 fail-fast 降级为 `ok: false` report 的变更；live gate 必须在 configured provider 未 ready 时清晰失败。
- [x] docs-lane Rust wording 过宽时只保留为 review evidence；本仓库继续聚焦 Bun-kernel，现有 Rust handoff docs 保持 external reference。

## 2026-05-22 新 Session Handoff Seal

- [x] 为 `codex/seal-coordinator` 上的新 Codex session 准备仓库。
- [x] staged 一个连贯 handoff snapshot，覆盖 Scope Vector、socket/OpenAPI drift guard、prompt polish、DB/context tests、zero-character guard 和 release notes。
- [x] 确认所有 `flyflor-seal` tmux pane 已回到 shell，所有记录的 worktree 仍可作为 review evidence 使用。
- [x] 确认已接受的 child-lane 变更在 coordinator 中，已拒绝的 child-lane proposal 也记录了原因。
- [x] handoff 前最终验证：
  - `bun run docs:check`
  - focused socket / Scope Vector / DB-context / docs / naming tests
  - `bun run check`
  - `bun run build:binary`
  - `bun run test` (`850 pass`, `0 fail`)
  - `git diff --check`
- [x] 已知仅环境 blocker 仍是 `smoke:release` compose 部分的 Docker daemon 可用性。

## 2026-05-22 Master Handoff

- [x] 最终 handoff 目标是 `master`，不是 `codex/seal-coordinator`。
- [x] `codex/seal-coordinator` 只是本 seal wave 的 staging/coordinator branch。
- [x] 提交 staged coordinator snapshot。
- [x] 将当前 worktree 切回 `master`。
- [x] 将 coordinator snapshot 合入 `master`。
- [x] 为下一 session 推送 `master`。

## 2026-05-22 Scope DB Vector Closure

- [x] 将默认 Scope Vector persistence 从 shared vector DB 移到每个 Scope 项目的 `.flyflor/scope.db`。
- [x] 保留 injected `dbFile` 支持，用于测试和显式迁移工具。
- [x] 在 `scope_vectors` 和 `scope_vector_edges` 旁新增 `scope_tree_nodes`、`scope_hot_memory` 和 `scope_associations` 表。
- [x] 将 active-scope turn summary 写入 scope hot memory，同时把完整 turn ledger 权威留在 `brain.db`。
- [x] 在 recall、neighbor lookup 和 hot-scope listing 时按需打开 scope-local DB 文件。
- [x] 在 `tests/scope.vector.test.ts` 中覆盖 scope-local DB isolation、hot memory recall rendering 和 association evidence。
- [x] 更新 workflow、memory 和 architecture docs，使 `brain.db` 保持 ledger/query/replay/audit/detail only。

## 2026-05-22 Kernel V2 Clean Slate 编排

- [x] 将当前 Scope DB Vector closure 提交并推送到 `master`。
- [x] 移除所有旧本地 worktree，使仓库只保留一个 clean coordinator worktree。
- [x] 删除旧本地开发分支，包括之前的 `wt/*`、`main-codex-docs`、`y-branch-1` 和 GitButler workspace branch。
- [x] prune stale remote ref，并删除旧远程 `codex/*` 开发分支。
- [x] 只保留 `origin/master` 作为远程分支。
- [x] 启动子工作前记录新的 full-kernel worktree split。
- [x] 创建并推送新的 Kernel V2 worktree：
  - `wt/kernel-scope-memory`
  - `wt/kernel-fork-ask-crystal`
  - `wt/kernel-runtime-executive`
  - `wt/kernel-socket-protocol`
  - `wt/kernel-release-seal`
  - `wt/docs-contracts-report`
- [x] 启动一次 child Codex lane，然后在接受任何子变更前按用户要求停止它们。
- [x] 重新启动并发 Codex 工作前，为每个新 worktree 初始化独立本地 `TODO.md`、`AGENTS.md` 和 `LOGS.md` 控制段。
- [x] 只有当本地控制文件写明任务列表、工作状态、本地红线、变更日志要求和交还条件后，才重新启动 child Codex lane。
- [x] 要求每个 child worktree 在主 Codex review 前，把本地控制文件更新与 implementation/docs 工作一起提交。
- [x] 监控 `flyflor-kernel-v2` tmux lane，并中断任何漂移出归属 surface 的 child lane。
- [x] 按顺序 review child commit：docs-contracts-report、scope-memory、fork-ask-crystal、runtime-executive、socket-protocol、release-seal。
- [x] 只合并已 review 的 implementation/docs surface；有价值的 child control-file 历史摘要进 root handoff docs，而不是盲目合并本地噪声。
- [x] 每个被接受的 child merge 后运行 focused validation。

Kernel V2 acceptance focus：

- Scope / Memory 必须闭合 `scope.db`，把它作为 scope-local vector/tree/hot-memory/association index，同时 `brain.db` 保持 ledger/query/replay/audit/detail only。
- Fork mode 必须像 branch 一样工作：对话可以进入 `ContextFork`，用户可以要求 LLM 合并，冲突触发 ASK，成功闭合可以结晶。
- ASK ghost mode 必须保留 unanswered ASK state；用户可以 `continue`，而不是丢失 pending branch/scope/loop snapshot。
- Runtime / Executive 必须运行 nanobot-style context path：current input + Memory + Crystal + explicit Scope/Fork + Executive visible capability surface。
- Socket protocol 必须暴露稳定 `/ws` vascular surface，不恢复 `/channels`，也不把 transport metadata 变成认知连续性。

## 2026-05-23 Kernel V2 协调者进度核查

- [x] 核查 `flyflor-kernel-v2` tmux 真实状态：7 个 window，其中 6 个子 Codex lane 和 1 个主协调 shell pane。
- [x] 核查 6 个子 worktree 分支状态：scope-memory、fork-ask-crystal、runtime-executive、socket-protocol、release-seal、docs-contracts-report 均为 clean；runtime/release/docs 分支仍有 ahead remote 或待合入内容。
- [x] 将当前进度、子进程数量、各 lane 结果和主线未封板原因写入 `docs/development.workflow.md` 与 `docs/development.workflow.zh.cn.md`。
- [x] 对齐 `docs/architecture*.md`：明确 `scope.db` 属于 Scope-local vector/tree/hot-memory/association 上下文装备索引，`brain.db` 只做 ledger/query/replay/audit/detail 和 provenance。
- [x] 对齐 `docs/runtime.turn*.md`：补充 `ContextFork` 分支、LLM merge、冲突 ASK、ghost/pending、`continue` 恢复和 Crystal candidate/Gem 闭环。
- [x] 对齐 `docs/memory.system*.md`：补充 Scope 热区项目记忆、多维关联词索引和零字符匹配边界。
- [x] 运行文档与协议 focused validation：
  - `bun run docs:check`
  - `bun test tests/docs.index.test.ts tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts`
  - `bun test tests/ask.reply.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/docs.references.test.ts`
  - `bun run check`
  - `git diff --check`
- [x] review 并选择性合并 `wt/kernel-fork-ask-crystal` implementation/test surface：
  - `feat: parse fork merge closure evidence`
  - `feat: consume fork merge decisions at runtime`
  - 验证：`bun test tests/continuation.decisions.parse.test.ts tests/reflection.gem.consolidation.test.ts tests/ask.cap.runtime.test.ts tests/ask.parse.test.ts tests/ask.reply.test.ts tests/crystal.local.backend.test.ts`
- [x] 停止并回收已合入的 `fork-ask-crystal` Codex lane。
- [x] review 并选择性合并 `wt/kernel-runtime-executive` residue：Executive loop guard snapshot 由 runtime 真实生成，重复失败结果立即 ASK 暂停，并进入 `executive.loop.paused` payload。
  - 验证：`bun test tests/executive.tool.runtime.test.ts tests/skill.mcp.test.ts tests/ask.reply.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts`
- [x] 停止并回收已合入的 `runtime-executive` Codex lane。
- [x] review `wt/kernel-socket-protocol` residue：有效的 event selector guard / OpenAPI enum / WS 文档已在主线；剩余差异会回退 `loopGuardSnapshot`、old-docs 链接和当前协议 guard，因此不合入。
- [x] 停止并回收已完成 review 的 `socket-protocol` Codex lane。
- [x] review `wt/kernel-scope-memory` residue：owned code/test surface 已被主线吸收，无需再合入；保留分支作为 review evidence。
- [x] 停止并回收已完成 review 的 `scope-memory` Codex lane。
- [x] review `wt/kernel-release-seal` residue：install/Docker scripts 和 tests 与主线一致；剩余 README/control-file diff 违反当前英文 README 与控制文件中文单本政策，不合入。
- [x] 停止并回收已完成 review 的 `release-seal` Codex lane。
- [x] 继续 review 并选择性合并剩余 child commits，优先级：docs-report。
- [ ] 最终 seal 前重新跑完整主线验证，并提交/push coordinator snapshot。

## 2026-05-23 Kernel V2 docs-report 收口

- [x] review `wt/docs-contracts-report` residue：只保留 `docs/project.report.md` 和索引链接；拒绝过宽 README rewrite、old-docs 回迁、`AGENTS/TODO/LOGS.zh.cn.md` 控制副本和会回退当前协议/运行时的旧差异。
- [x] 将项目报告对齐到当前主线事实：fork merge parsing、conflict ASK、fork closure Crystal candidate、Executive loop guard snapshot 和 repeated failure ASK pause 已合入；ASK ghost/continue 端到端恢复仍是剩余闭合目标。
- [x] 确认当前 `flyflor-kernel-v2` tmux 只剩 `main` 和 `docs-report`，其他 child lane 已停止回收。
- [x] docs-report 提交前停止并回收最后一个 `docs-report` Codex lane。
- [x] 最终检查不再有空转 child Codex 进程；提交后 push `master`。

## 2026-05-23 Kernel V3 高并发上线闭环

- [x] 清理旧 Kernel V2 worktree、本地 `wt/*` 分支和远端 `origin/wt/*` 分支。
- [x] 基于 `master` 创建 8 条 Kernel V3 高并发 worktree：
  - `wt/ask-ghost-continue`
  - `wt/scope-solidification-vector`
  - `wt/scope-vector-recall`
  - `wt/crystal-gem-quality-gate`
  - `wt/runtime-loop-resume`
  - `wt/socket-control-e2e`
  - `wt/release-seal-fast`
  - `wt/docs-contract-sync`
- [x] 每条 worktree 初始化中文 `TODO.md`、`AGENTS.md`、`LOGS.md` lane 控制段。
- [x] 推送 8 条新远端分支。
- [x] 启动 `flyflor-kernel-v3` tmux：1 个主协调 window + 8 个 child Codex window。
- [x] 每 20-30 分钟轮询 child lane 状态，谁先完成谁先 review。
- [x] 合并通过 review 的 implementation/docs commit，并立即运行 focused validation。
- [x] 每次合并必须统计并记录效率数据：lane 用时、合并提交、文件数、插入/删除、`src`/`tests`/`docs`/`scripts` 分类行数、验证命令与耗时。
- [x] 拒绝或重派偏离 owned surface、broad docs rewrite、回退架构红线的 child diff。
- [x] review 并合并 `wt/scope-solidification-vector`：结构化 ASK confirmation 创建 Scope，codename evidence 写入 scope-local `scope.db` tree/association。
- [x] review `wt/docs-contract-sync`：拒绝会删除当前实现的 stale broad merge，仅手动同步有效文档事实。
- [x] 最终运行上线 seal：focused ASK/Scope/Crystal/Runtime/Socket/docs tests、`bun run docs:check`、`bun run check`、`bun run build:binary`、`git diff --check`。
- [x] 回收所有 child Codex、清理/保留分支按合并状态记录，推送 `master`。

## 2026-05-23 WS TUI 只读查询闭合

- [x] 将 `history.list` 从 Runtime/MemoryModule 调用切到 `src/socket/query` DB/read-model 只读层。
- [x] 新增 `/ws` 查询命令：history/detail、scope/list/detail、fork/list/detail、ask/list/detail、blackboard/list/detail、task/list/detail、replay/list/detail、thought/detail、crystal/list。
- [x] 保持唯一 live 智能体入口为 `gateway.message.send`；query 命令只读 `brain.db`、blackboard DB、scope-local `scope.db` 和 `crystal.db`。
- [x] 为 TUI 展开区补齐数据面：对话输入输出、ASK 状态/回答、fork 详情、黑板 steps/messages/decisions、task plan、replay/deep-think 摘要、scope 热区记忆/记忆树/关联词、crystal gems。
- [x] 更新 WS/OpenAPI 文档，明确 query snapshot 是 inspectable read model，不进入 prompt/context assembly。
- [x] 补充 socket query control 测试，验证查询不触发 live dispatch。
- [x] 运行最终 focused tests、docs check、type check、binary build 和 diff check。

## 2026-05-23 99%+ 内核封版收口

- [x] 确认当前只剩主 worktree，无本地 `wt/*` 分支，无远端 `origin/wt/*` 分支。
- [x] 停止旧 `flyflor-kernel-v2` / `flyflor-kernel-v3` tmux session，确认没有 child Codex 空转。
- [x] 跑最终核心 focused seal：ASK、Scope、Scope Vector、Crystal、Executive、Socket、Docs 相关测试。
- [x] 跑最终工程 seal：`bun run docs:check`、`bun run check`、`bun run build:binary`、`git diff --check`。
- [x] 提交 `/ws` TUI read-model query 闭合变更。

## 2026-05-23 Apifox WS 示例集合闭合

- [x] 保持 canonical OpenAPI `docs/openapi/flyflor.socket.openapi.json` 不动，真实 HTTP surface 仍只有 `/health` 和 `/ws`。
- [x] 新增 `scripts/build.apifox.socket.ts`，从 canonical OpenAPI examples 派生 Apifox 专用 WS 示例集合。
- [x] 新增 `docs/apifox/flyflor.socket.apifox.json`，把 handshake、control、live turn、TUI read queries、TUI snapshots 和 event stream 展开成可测试条目。
- [x] 新增 `docs/apifox/flyflor.socket.apifox.openapi.json`，使用 doc-only `/__apifox/ws/...` 伪操作让 Apifox 左侧路径树能点开所有 WS frame 示例。
- [x] 每个 Apifox frame 生成 JSON Schema，固定 `protocol`/`type` enum，并按示例 payload 生成 required/properties。
- [x] 将 `docs:apifox:check` 纳入 `docs:check`，防止 Apifox 产物漂移。
- [x] 增加 docs guard：Apifox 产物必须包含所有 canonical examples 和 TUI query/detail/snapshot examples，所有 client->server raw frame 必须能被 runtime control parser 解析。

## 2026-05-23 Apifox 真实 WS 联调纠偏

- [x] 废弃 `docs/apifox/flyflor.socket.apifox.json` 导入承载体，不再提供任何 HTTP 伪发送入口。
- [x] 重生成 `docs/apifox/flyflor.socket.apifox.openapi.json`，只保留真实 `/health` 和 `/ws`。
- [x] 新增 `docs/apifox/flyflor.socket.messages.json`，作为前端和 Apifox 共用的 WS raw frame 消息目录。
- [x] 新增 `docs/apifox/flyflor.socket.tester.html`，可直接打开并连接真实 `ws://127.0.0.1:8788/ws`。
- [x] 更新 `docs/apifox/README.md`，明确 Apifox 必须新建 WebSocket 请求并发送 raw JSON frame。
- [x] 增加 docs guard：Apifox/OpenAPI/HTML 产物不得包含辅助伪路径，OpenAPI paths 必须严格等于 `["/health", "/ws"]`。
- [x] 修正默认 `GatewayMessageSend` 示例：不再携带 `/workspace/project` 这类不可写占位 Scope 路径，确保前端第一条对话可直接发送。
- [x] 补齐旧 `brain.db` / `memory.sqlite` 的 owner_key 迁移，避免真实 `/ws` turn 因旧 schema 报错。
- [x] 用真实 `bun run socket` + WebSocket 客户端验证 `GatewayMessageSend -> turn.delta -> turn.final`。
- [x] 按最新要求废弃旧 DB 数据保留策略：旧 `brain.db` / `memory.sqlite` schema 检测后直接清空运行态表并重建当前 schema，旧月份旧 brain 不再归档保存。
- [x] 修复 WS 连续复用 Apifox 示例 `payload.id` / `requestId` 导致 `memory_events.id` 唯一键冲突的问题：内部 turn id 改为 runtime UUID，对外仍回显客户端 messageId。
- [x] 明确 `.config` Markdown 画像路径：运行时只读取 `~/.flyflor/.config/workspace/{SELF.md,IDENTITY.md,USER.md,MEMORY.md}`，`.zh.cn.md` 和旧 `SOUL.md` 不进入灵魂画像。
- [x] 清理本地 `.config/templates/memory` 旧大写模板和 `SOUL` 残留，补齐小写 canonical 模板；安装脚本新增 legacy prune。
- [x] 跑最终 docs/apifox/focused/check/build/diff 验证并记录结果。

## 2026-05-23 Scope 回忆门控与 WS 全场景 E2E

- [x] 新增 `ScopeRecallComponent`：自然语言提起 Scope 时先进入 LLM 语义门控，输出 `none | load | ask`，再决定是否装配 Scope。
- [x] 新增 `templates/prompts/scope.recall.md` / `.zh.cn.md`，运行时只使用 canonical `.md`。
- [x] 新增 scope recall runtime events：`scope.recall.started`、`scope.recall.decided`、`scope.recall.loaded`、`scope.recall.ask`，用户面可显示“回忆中”。
- [x] 新增 `MemoryModule.listScopeRecallCandidates()`，只读 `brain.db` scopes/codenames 与 scope-local `scope.db` 候选证据，不把向量结果当语义裁判。
- [x] 更新 README / 架构 / 记忆系统文档，明确 `scope.db` 是项目热区记忆树与上下文装备索引，`brain.db` 仍是生命账本。
- [x] 新增真实 `/ws` 全场景 E2E 脚本 `bun run e2e:ws:full`，覆盖 live turn、scope recall events、history/scope/fork/ask/blackboard/task/replay/thought/crystal query snapshot。
- [x] 最终运行 focused scope recall tests、`bun run e2e:ws:full`、docs/check/build/diff 并记录结果。

## 2026-05-23 提示词工程去内部术语治理

- [x] 全量检查 `templates/prompts/**` 模型可见模板，移除产品名、内部器官隐喻、内部 DB 名、Scope/Fork/ASK/MCP/Crystal/Gem 等开发黑话。
- [x] 将运行时提示词改成外部临时模型可理解的任务/输入/输出/规则表达；必要协议字段只作为 JSON 契约存在，不再用内部术语解释。
- [x] 将结构化块 tag 统一到 `agent_*` 中性命名，并更新解析测试。
- [x] `scope.recall` 提示词明确为语义裁决器：先判断 `none | load | ask`，再决定是否加载命名工作上下文记录。
- [x] 扩展 prompt lint，检查 canonical `.md`、`.zh.cn.md` 镜像和 docs prompt 模板正文不得暴露内部术语。
- [x] 运行提示词 focused tests、docs check、type check 和 `git diff --check`。

## 2026-05-23 Dream Graph 旧库 Schema 修复

- [x] 复现 `memory.dream.failed` collect 阶段 `SQLiteError: no such column: owner_key` 根因：旧 `crystal.db` graph 表缺 `owner_key`，`CREATE TABLE IF NOT EXISTS` 不会补列。
- [x] 在 `SQLiteGraphStore` 初始化时检测旧 graph 表关键列，发现 legacy schema 后按当前旧数据清空策略 drop graph tables 并重建。
- [x] 补充旧 `graph_gems` 缺 `owner_key` 的回归测试，确保 dream-style owner query 不再报错。
- [x] 修正 WS full E2E scripted fallback 对 scope recall 提示词的探测条件，避免依赖已清理的内部短语。
- [x] 运行 graph/dream focused tests、真实 `/ws` 全场景 E2E、type check、docs check 和 `git diff --check`。

## 2026-05-24 核心调度与执行审批闭合

- [x] 明确执行层策略：不把 `shell.run` 做成跨平台脚本语言，跨平台文件能力走 `workspace.*`，本地进程只走单 executable + argv。
- [x] 为 WS/TUI 本地入口补齐 `gateway.message.send.payload.context.toolApprovals` 契约，本轮审批只安装当前 turn 的 approve callback，不修改 sandbox/config/catalog。
- [x] 更新 OpenAPI/Apifox 源契约、消息目录和 tester，确保前端能在真实 `/ws` 上看到 `mcpToolCalls` / `userToolCalls` 示例。
- [x] 修正 runtime 类型出口，让 socket 只通过 runtime index 引用 `RuntimeStreamOptions`。
- [x] 运行 focused WS/Executive/Skill/Docs 测试、真实 `/ws` 全场景 E2E、`docs:check`、`check` 和 `git diff --check`。

## 2026-05-24 本地代码阅读调用层修复

- [x] 复盘调用层问题：模型会在本地项目阅读请求中直接自然语言声称已查看，而没有先输出工具调用块。
- [x] 将 `templates/prompts/mcp.context.md` / `.zh.cn.md` 改为本地路径、代码库、文件内容和项目审查请求必须先调用文件工具，收到工具结果后才能声明已读。
- [x] 新增内建只读 `workspace.tree`，返回带深度和条数上限的递归目录树，作为项目级扫描第一步。
- [x] `workspace.tree` 默认跳过运行态顶层目录和重目录，避免 `.flyflor`、brain、cache、memory、prompts 等运行态数据淹没源码结构。
- [x] 补充 workspace tree、prompt lint 和文档测试，验证工具目录暴露 tree 且本地项目报告链路先拿结构证据。

## 2026-05-24 Socket 工具事件 lane

- [x] 阅读 `src/events/**`、`src/socket/**`、`src/protocol/control/**` 和现有 query reader。
- [x] 为工具调用生命周期补齐事件类型和 socket 事件订阅/查询面：started/progress/succeeded/failed/output persisted/budget exhausted/ask required。
- [x] 只通过 event emit/subscribe 和 DB/read snapshot 暴露信息，不入侵 Runtime 主链。
- [x] 更新 WS 文档、OpenAPI/Apifox messages 和 docs guard 示例。
- [x] 补齐 focused tests，覆盖事件订阅、快照查询、错误事件和文档示例可解析。
- [x] 运行 `bun test` focused、`bun run docs:check`、`bun run check`、`git diff --check` 后提交本 lane。

## 2026-05-24 电脑工具 lane

- [x] 阅读 `src/agent/runtime/mcp/workspace.ts`、`git.ts`、`tool.executor.ts`、`src/agent/sandbox/**` 和 Codex/OpenCode 的 read/edit/shell/patch 设计。
- [x] 在 `src/agent/runtime/computer/**` 或现有 runtime/mcp owner 下补齐跨平台文件/patch/git/process 基础能力；保持目录语义清晰。
- [x] `process.run` 使用 executable + argv 作为主路径；`shell.run` 仅作为高风险逃生口，并清晰返回错误。
- [x] 文件读写不做 workspace 人为限制，但必须经过 sandbox/approval/audit gate。
- [x] 不引入 native addon、postinstall 或无法 `bun build --compile` 的运行时依赖。
- [x] 补齐 focused tests，覆盖读取、写入、删除、patch、git/process 失败结果。
- [x] 运行 `bun test` focused、`bun run check`、`git diff --check` 后提交本 lane。

## 2026-05-24 执行循环 lane

- [x] 阅读 `src/executive/**`、`src/agent/runtime/mcp/**` 和指定参考项目中 Codex/OpenCode/Hermes/Nanobot 的执行循环；未做 reference 全量扫描。
- [x] 在 Executive owner 内设计三层预算：`modelToolTurnBudget`、`executionOperationBudget`、`riskQuota`。
- [x] 工具预算耗尽时输出 ASK pause/continue/narrow/stop 与 crystal candidate 结构，不让模型误以为工具永久封顶。
- [x] 工具失败保持为结构化 tool result；adapter 覆盖率协议错误仍显式抛出。
- [x] 补齐 focused tests，覆盖预算耗尽、ASK pause payload、失败结果和 Runtime MCP resume 入口。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 后提交本 lane。

## 2026-05-24 电脑控制调用层阶段性隔离

- [x] 修复 `mcpToolNeed` prompt manifest 占位符校验缺口，恢复 prompt lint。
- [x] 新增 `RuntimeMcpToolNeedComponent`，当模型首轮没有结构化工具调用但本地任务需要工具时，由同模型输出 JSON 裁决，再回到 Executive 工具循环执行。
- [x] 修正流式首轮工具裁决顺序：需要工具时不提前向 WS/TUI 外显“我先看看”一类草稿。
- [x] 新增 `workspace.delete`，进入 workspace catalog、schema、审批和 Executive descriptor，作为写能力的一部分。
- [x] 补充 focused 测试：首轮跳过工具调用、流式草稿不外显、workspace delete 执行链路。
- [ ] 在独立 worktree 中继续设计完整电脑控制层：协议级工具注册、跨平台进程/文件/git 能力、沙盒审批、结果回灌、loop guard、真实 WS 场景测试。
- [ ] 主分支只保留已验证补洞；完整执行层重构不得继续污染 master。

## 2026-05-24 xtools-core-exec

- [x] 审查现有 `workspace.*`、`git.*`、`process.run`、`shell.run` 工具链，确认与 Codex/OpenCode 读写执行模型的差距。
- [x] 强化项目阅读能力：目录树、搜索、glob、批量读取、大文件截断、二进制拒绝、重目录跳过。
- [x] 强化写入能力：write/edit/delete/patch 必须精确、可审计、失败结构化暴露。
- [x] 明确跨平台执行契约：`process.run` 使用 executable + argv；`shell.run` 不承诺 shell 脚本可移植。
- [x] 确保工具结果摘要、原始结果引用、错误信息能稳定回灌给模型。
- [x] 补充或更新 smoke/test，覆盖真实读项目、搜索、patch 临时文件、process.run。
- [x] 运行验证并在 `LOGS.md` 追加结果。

## 2026-05-24 xtools-subagent

- [x] 新增内建 `subagent.batch`，允许模型把独立检查拆给多个辅助任务并发执行。
- [x] 子任务只能使用父级目录中收窄后的工具集合，禁止递归调用 `subagent.batch`。
- [x] 多个子任务在父级 Executive 预算中按一个 batch 操作扣减，子任务内部仍有独立工具轮次上限。
- [x] 子任务需要用户决定时返回结构化 `needs_user`，不直接向用户提问。
- [x] 子代理事件写入 runtime event stream，并把 batch/child 计数写入 `brain.db` 行为快照 provenance。
- [x] 更新工具提示词中英文镜像，说明可并发拆分任务但不能暴露内部实现判断。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 后合入主线。

## 2026-05-24 xtools-external-kit

- [x] 新增 descriptor-only 外挂工具目录，覆盖 browser、screen、computer、vision、audio、web、LSP、background task。
- [x] 外挂工具只通过 `external.tools.jsonc` sidecar manifest 检测注册；缺失时隐藏为 unavailable，不阻塞启动。
- [x] 外挂工具不重新实现文件读写；核心文件/patch/git/process 能力仍由内建执行原语负责。
- [x] Browser/computer 类工具携带 computer profile，运行时走 computer approval surface；普通 user tool 仍走 plugin approval。
- [x] 新增 mock sidecar 安装脚本和测试 sidecar，只用于本地/测试目录能力面，不把 Playwright/OCR/Whisper/LSP 等重依赖编入 Bun binary。
- [x] Socket kit catalog 暴露可用/不可用 external capabilities，方便 TUI/前端显示能力面。
- [x] 更新 OpenAPI/Apifox 事件枚举，补齐新增子代理事件订阅类型。
- [x] 运行 focused tests、`bun run docs:check`、`bun run check`、`git diff --check` 后合入主线。

## 2026-05-24 外挂工具本地开发目录

- [x] 明确仓库根目录 `tools/` 是本地开发外挂工作区，与 `src/` 平级但必须 git ignored。
- [x] 明确正式用户态治理目录仍为 `~/.flyflor/.config/tools`，正式 payload 目录仍为 `~/.flyflor/tools`。
- [x] 更新 External Kit 文档，禁止内核直接 import 本地 `tools/` 实现文件。
- [x] 将 external sidecar manifest 读取路径从 kits 目录迁到专用 tools 控制面：全局 `~/.flyflor/.config/tools/external.tools.jsonc`，项目 `./.flyflor/tools/external.tools.jsonc`。

## 2026-05-24 xtools-browser-cdp

- [x] 创建 `/Users/yihuaqing/Desktop/yihuaqing/flyflors/worktrees/xtools-browser-cdp`，分支 `feature/xtools-browser-cdp`。
- [x] 启动 `xtools-browser-cdp` tmux 子进程，只推进 Browser CDP 外挂 sidecar 最小闭环。
- [x] Review 子进程提交，确认无重依赖、无内核 import sidecar 实现、无记忆/Scope/ASK 主链漂移。
- [x] 合并 Browser CDP sidecar 到主线，运行 focused tests、`bun run docs:check`、`bun run check` 和 `git diff --check`。
- [x] 记录合并统计：`603e1b1`，8 files changed，634 insertions。
- [x] 停止并确认没有 `xtools-browser-cdp` tmux 子进程继续运行。
- [x] 移除已合并的 `/Users/yihuaqing/Desktop/yihuaqing/flyflors/worktrees/xtools-browser-cdp` worktree 和本地 `feature/xtools-browser-cdp` 分支。
## 2026-05-24 xtools-ws-e2e-seal 本地任务

- [x] 初始化 `xtools-ws-e2e-seal` worktree，本地控制文件只追加状态。
- [x] 补真实 `/ws` 工具全场景、Apifox messages、能力矩阵和封板报告。
- [x] 覆盖工具成功、失败、预算耗尽 ASK、history/detail/replay 和子代理场景。
- [x] 运行 focused tests、`bun run docs:check`、`bun run check`、`git diff --check` 并提交给主 Codex review。

## 2026-05-24 xtools-lsp-task-data 本地任务

- [x] 初始化 `xtools-lsp-task-data` worktree，本地控制文件只追加状态。
- [x] 实现 `lsp.symbols`、`lsp.diagnostics`、`task.background`、`file.hash`、`archive.*`、`data.convert`。
- [x] 补轻量 utility sidecar、后台任务句柄和 focused tests。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 并提交给主 Codex review。

## 2026-05-24 xtools-computer-native 本地任务

- [x] 初始化 `xtools-computer-native` worktree，本地控制文件只追加状态。
- [x] 实现 `screen.screenshot`、`computer.mouse`、`computer.keyboard`、`computer.window` native sidecar。
- [x] 补 macOS / Windows / Linux capability probe 和 focused tests。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 并提交给主 Codex review。

## 2026-05-24 xtools-media 本地任务

- [x] 初始化 `xtools-media` worktree，本地控制文件只追加状态。
- [x] 实现 `vision.analyze`、`vision.ocr`、`audio.transcribe`、`audio.speak` media sidecar。
- [x] 补 provider/local runtime detection、失败结构和 focused tests。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 并提交给主 Codex review。

## 2026-05-24 xtools-search-web 本地任务

- [x] 初始化 `xtools-search-web` worktree，本地控制文件只追加状态。
- [x] 实现 `web.search` / `web.fetch` / `web.extract` / `web.download` 搜索网页 lane。
- [x] 补 provider 配置、搜索缓存、去重、warnings、Top N 补抓和 focused tests。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 并提交给主 Codex review。

## 2026-05-25 主线 planning/socket 封口

- [x] 审计当前 `master` 脏改动，确认范围集中在 planning gate、`task.plan.decide`、socket query、事件分类、OpenAPI/Apifox 和对应测试。
- [x] 新增 runtime planning route：`act` 模式可直接执行，`plan` 模式先生成待确认任务计划，缺失信息时返回 ASK。
- [x] 保持 blackboard 优先级：约束冲突、多视角讨论和实现+验证类请求先进入黑板，不被 planning gate 抢走。
- [x] 新增 `/ws` `task.plan.decide` 控制命令，支持 `confirm`、`revise`、`abandon`，通过 DB read model 写回 task plan 状态。
- [x] 修正 Apifox message catalog，`task.plan.decide` 的真实返回为 `task.snapshot`，不是 `ack`。
- [x] 运行验证：`bun test tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts tests/runtime.planning.route.test.ts`。
- [x] 运行封口验证：`bun run check`、`bun run docs:check`、`bun run build:binary`、`git diff --check`。

## 2026-05-25 xtools-provider-hardening 本地任务

- [x] 初始化 `xtools-provider-hardening` worktree，本地控制文件只追加状态。
- [x] 强化 web/media/utility sidecar 的 provider 与 delegate 失败结构。
- [x] 覆盖缺 provider、provider 响应非法、delegate 缺失、delegate 非 JSON、delegate 显式失败和平台命令缺失。
- [x] 运行 focused sidecar tests 与 `git diff --check` 并提交给主 Codex review。

## 2026-05-24 xtools-computer-use 本地任务

- [x] 实现高层 `computer.use` process-json sidecar，支持 delegate/cua backend、动作校验、危险输入阻断和 `captureAfter` 后置捕获。
- [x] 将 `computer.use` 注册进 external tool catalog，并通过 computer descriptor metadata 保留 sandbox/approval/audit 语义。
- [x] 新增 `install.xtools.computer.use.sh` 和 package script，只写 external tools manifest，不创建 kit 或内核 sidecar import。
- [x] 补 deterministic tests 覆盖 delegate unavailable、invalid config、action validation、captureAfter、blocked dangerous input、installer manifest 和 catalog count/name。
- [x] 运行 focused tests、`bun run check`、`git diff --check` 并提交给主 Codex review。

## 2026-05-25 路由短路与提示词稳定性修复

- [x] 移除 fastRoute 的短文本独立 direct bypass，短请求必须仍能进入结构化路由判断。
- [x] 保留 direct hint 与 embedding 相似度两类结构化复用路径，未新增任何用户文本关键词/正则语义判断。
- [x] 强化 blackboard route、planning route 与 runtime system 提示词，补齐术语解释、形式定义冲突处理和 act/plan/yolo 边界。
- [x] 同步 canonical `.md` 与 `.zh.cn.md` 提示词镜像，避免模型面出现内部禁用术语。
- [x] 补回归测试覆盖短形式定义冲突不会被 fastRoute 吞掉，并更新 prompt lint / planning / blackboard 断言。
- [x] 运行 focused tests 与 `bun run check`。

## 2026-05-25 黑板封顶 ASK 边界修复

- [x] 将 pending ASK 作为 runtime 轮间结构化边界：用户下一轮回答 active ASK 时强制 direct 消化，不再进入 route LLM、planning gate 或新黑板。
- [x] 黑板 NeedsUser 合成 ASK 后刷新 fastRoute snapshot 时清零黑板 failure/watch 计数，避免 failure retry 把下一轮重新升级到黑板。
- [x] 保持零字符工程：产品逻辑只读取 `peekActiveAsk`、ASK 存在性、blackboard status 和计数器，不新增用户文本关键词、正则或句式判断。
- [x] 补 runtime 回归：黑板封顶返回 `blackboard-stalemate` ASK 且带 choices；用户回答 ASK 后不再启动第二个黑板。
- [x] 补 ASK 主链测试桩控制面 JSON，保证 planning/tool-need 控制提示不会误伤 ASK 测试。
- [x] 运行 focused tests、`bun run check`、`git diff --check`。

## 2026-05-25 xtools-tool-call-fix

- 状态：已完成
- [x] 定位 Act 模式默认 planning gate 抢占模型轮次的问题，执行请求不再先生成计划草稿。
- [x] 保留显式 Plan 模式 planning route，用户确认型计划流程不受影响。
- [x] 补“绝对路径本地项目分析”回归：首轮草稿未调用工具时，由 `mcp.tool.need` 结构化输出 `workspace.tree` 并执行。
- [x] 验证 Stdio/WS 本地工具 catalog、workspace 绝对路径审批、MCP loop、子代理工具调用和 planning gate focused 套件。

## 2026-05-25 本地路径硬执行修复

- 状态：已完成
- [x] 修复绝对路径请求仍可能只输出“我先看看”而不执行工具的问题：runtime 在模型首轮自由输出前注入本地路径探测工具调用。
- [x] 修复目录存在判断使用 `Bun.file().exists()` 导致目录探测不稳定的问题，改为 `fs.stat` 级别存在检测。
- [x] 修复中文文本与绝对路径粘连时只退到父目录的问题，改为最长存在路径前缀识别。
- [x] 绝对目录自动走 `workspace.tree`，绝对文件自动走 `workspace.read`，不依赖模型自觉生成工具 JSON。
- [x] 工作区只读工具允许读取项目外绝对路径；写入、编辑、删除、patch 仍保留 approval/audit gate。
- [x] 强化 workspace tree 的工具结果摘要，长绝对路径不会把 `README.md`、`src/main.ts` 等关键文件名挤出回放/metadata。
- [x] 运行验证：`bun test tests/skill.mcp.test.ts --timeout 30000`；`bun test tests/runtime.planning.route.test.ts tests/runtime.mcp.tool.plan.test.ts tests/gateway.ws.test.ts --timeout 30000`；`bun run check`；`git diff --check`。

## 2026-05-25 模型决策子任务批处理封口

- 状态：已完成
- [x] 新增 `mcp.subtask.plan` 提示词模板和中文镜像，由模型结构化判断当前工具工作是否需要拆成子任务批处理。
- [x] 新增 runtime subagent planner，校验模型返回的 `continue` / `delegate` 决策、任务数量、并发数、子任务工具 allowlist 和子任务工具轮次。
- [x] 广域读项目、搜索资料、浏览器/工具组合等复杂工作可被规划成一次 `subagent.batch` 父级工具操作，子任务内部仍保留独立预算、审计事件和 provenance。
- [x] 保持零字符工程：子任务是否开启、开启几个、允许哪些工具由模型结构化输出决定，代码只做 JSON/schema/catalog/resource 校验。
- [x] 修正 OpenAPI/Apifox 契约：`SocketMessageType` 与新增 `fork.memory.*` 控制消息对齐，`EventSubscription.types` 与 `RuntimeEventType` 全量对齐。
- [x] 运行验证：`bun run docs:check`；`bun run check`；`bun test tests/skill.mcp.test.ts tests/gateway.ws.test.ts tests/event.component.test.ts tests/runtime.planning.route.test.ts tests/runtime.mcp.tool.plan.test.ts --timeout 30000`。

## 2026-05-26 执行层 ASK / Job / 工具稳定性完整封口

- 状态：已完成
- [x] 完成 `PLAN.md` 全部 Phase 0-15，并将执行账本状态更新为已完成。
- [x] `execution.job.list` / `execution.job.detail.get` / `execution.job.snapshot` 已进入 `/ws`，只读 `brain.db` execution-job ledger。
- [x] 外挂工具稳定性快照已覆盖 discovery、manifest、path、version、probe、runtime、sandbox、upgrade、effective；不可用、禁用、升级中工具对模型隐藏但保留 diagnostics。
- [x] 外挂工具升级事务已具备 staging、next manifest、apply、previous package 骨架，持久化只写相对命令。
- [x] 工具稳定性 unavailable / disabled 可形成 `tool-stability` 来源的 Executive ASK。
- [x] ASK/job/tool-stability 结构化 evidence 已进入 Crystal candidate，Gem 升格仍由 quality gate 控制。
- [x] 文档、OpenAPI 与 Apifox 示例已更新并通过 drift check。
- [x] 运行验证：`bun test tests/ask.parse.test.ts tests/ask.wire.test.ts tests/ask.normalizer.test.ts tests/ask.presentation.test.ts tests/executive.tool.runtime.test.ts tests/runtime.mcp.tool.plan.test.ts tests/external.tools.test.ts tests/install.script.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/reflection.thread.test.ts tests/computer.coding.tools.test.ts --timeout 30000`；`bun test tests/skill.mcp.test.ts tests/ask.reply.test.ts --timeout 30000`；`bun run check`；`bun run docs:check`；`bun run build:binary`；`git diff --check`。

## 2026-05-25 执行层 ASK 与相对路径第一阶段

- 状态：部分完成
- [x] 新增根目录 `PLAN.md` 执行账本，记录执行层、ASK、外挂工具、相对路径、稳定性、升级和 Crystal candidate 全量计划；后续只允许改状态或追加 amendment。
- [x] 修复 `subagent.batch` child `needs_user` 被包装成普通 failed tool 的问题，父级 Executive loop 现在可由结构化工具结果提升为 ASK。
- [x] ASK 协议新增 authority/source/resumePolicy、question recommendation、固定 `other` 选项和 Crystal candidate policy 字段，并保持旧 ASK 兼容。
- [x] Executive 工具暂停 ASK 改为多问题结构，包含执行策略、预算策略和子代理策略，同时保留旧 choices 兼容面。
- [x] 外挂工具 discovery 支持 schema v2 和 `cwd:"app"`，默认 xtools manifest/installer 改为 app-relative `./tools/packages/...`，绝对 command 标记 unavailable。
- [x] Phase 3 `AskComponent` 已拆分为 parser、normalizer、policy、presentation、ledger 和 component owner，并保留旧导出兼容。
- [x] Phase 5 Durable Execution Job v1 已完成：`subagent.batch` 现在有 parent jobId、childJobId、progress、needs-user 状态和 ASK metadata 引用。
- [x] Phase 6 brain.db job ledger 已完成：Execution Job 生命周期写入 `memory_events.type='execution-job'`，只保存结构化摘要，不保存完整 prompt 或大型工具输出。
- [ ] Phase 7 socket job query 仍待做。
- [ ] Phase 10-13 工具稳定性状态机、升级事务、ASK 联动和 Crystal evidence 闭环仍待做。

## 2026-05-27 ASK 公民权限与工具闭环

- [x] 复盘 `brain.db` 与日志，固定 phantom ASK 默认选择、`subagent.batch` parse failure、execution job detail 重复请求证据。
- [x] 将 Executive 工具阻断 ASK 改为显式公民权限 ASK，禁止裸文本 token 推断执行策略。
- [x] 确保 tool/subagent/process 失败写入 execution job detail，并通过 socket event 可订阅。
- [x] 增加 targeted tests 覆盖未结构化授权时不恢复工具执行、ASK 触发不生成普通用户消息。
- [x] 运行 `bun run check` 与相关 runtime/socket/memory 测试。
- [x] 修复 `socket.control.smoke` 旧隐式恢复请求，改为显式 `metadata.askAnswer` 公民权限答案后通过 pause-resume-history 闭环验证。

## 2026-05-27 真实 LLM 全链路闭环

- [x] 新增 `smoke:live:closure`，使用真实 DeepSeek provider 与隔离 temp home/workspace 验证 baseline、工具、预算 ASK、结构化公民权限恢复、子代理、history、execution job、brain.db phantom guard 和外部工具可见性。
- [x] 安装真实 `tools/packages` sidecar payload 到 git ignored 工具目录，并验证 Browser/Computer/Web/Media/Utility descriptor 均能被内核发现为 sidecar-backed capability。
- [x] 修复 macOS 大小写不敏感文件系统下 `install.templates` 误删 `self.md`、`memory.md`、`user.md` 的问题，新增模板安装回归。
- [x] 运行真实与确定性验证：`bun run provider:ready -- --require-ready`、`bun run test:live`、`bun run smoke:socket:live`、`bun run smoke:agent:live`、`bun run smoke:socket:control`、`bun run smoke:live:closure`、`bun run check`、`bun run test:kernel`、`bun run docs:check`、`bun run test`、`bun run build:binary`、`git diff --check`。

## 2026-05-27 安全外部工具面与最终闭环复核

- [x] 收紧默认真实 xtools manifest：保留 `browser.open` / `browser.snapshot` / `browser.screenshot`、`screen.screenshot` / `computer.window` 与本地 utility 工具，默认不暴露 click/type/mouse/keyboard/control 类高风险动作。
- [x] `smoke:live:closure` 增加真实工具面断言：安全 Browser/Computer probe 为 available，危险控制工具、providerless web/media/LSP/task 为 unavailable，utility 工具仍 available。
- [x] 复跑真实闭环与最终门禁：`bun run smoke:live:closure`、`bun run docs:check`、`bun run test:kernel`、`bun run test`、`git diff --check`。

## 2026-05-27 Browser Use 外挂工具第一阶段

- [x] 参考 `reference/hermes-agent` 的 browser/computer use 分层，新增 `browser.use` 高层 process-json sidecar，保持内核只登记 descriptor 和子进程 runner。
- [x] `browser.use` 支持 delegate 后端与 CDP 后端，默认真实 manifest 仅写 sidecar 配置且 `tools: []`，不自动暴露给模型，不影响 ASK / plan / yolo 执行面。
- [x] 外部工具 registry、socket kit catalog、mock xtools、POSIX/PowerShell/TypeScript 初始化器都加入 `browser-use` 包与 `browser.use` descriptor。
- [x] 运行 focused 验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts tests/gateway.ws.test.ts tests/install.script.test.ts --timeout 30000`；`bun test tests/runtime.mcp.tool.plan.test.ts tests/computer.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts tests/executive.tool.runtime.test.ts --timeout 30000`；`bun run check`；`git diff --check`。
- [x] 后续补齐真实 Browser Use provider/delegate 安装说明与真实浏览器高权限 smoke，仍需保持默认不暴露控制动作。

## 2026-05-27 Browser Use 文档对齐

- [x] 新增 `docs/external/browser.use.md` 与 `docs/external/browser.use.zh.cn.md`，记录 `browser.use` owner 边界、process-json 执行契约、默认不暴露策略、ASK/权限边界与聚焦验证文件。
- [x] push 前复跑 `docs:check`、focused 工具层测试、`bun run check`、`bun run test`、`git diff --check`，确认新增文档不要求改写既有 docs index。
- [x] 真实 provider 闭环复验：`bun run provider:ready -- --require-ready` 与 `bun run smoke:live:closure` 均通过；`browser.use` 在真实默认工具面保持 unavailable，phantom permission user events 为 0。

## 2026-05-27 Browser Use Capture/Verify 闭环

- [x] `browser.use` 增加 `captureAfter` 与 `captureMode` 输入，导航/变更动作完成后可用同一后端补一次 `snapshot` 或 `screenshot`，形成 browser action/verify 小闭环。
- [x] `browser.use` CDP 后端的 DOM click/type 改为 `Runtime.evaluate` IIFE，并把 DOM 目标缺失作为结构化 `failed` 暴露，避免依赖脆弱的 function-on-object 调用形态。
- [x] 复跑 browser/computer focused tests、external registry/socket tests、`bun run check`、`bun run docs:check`、`git diff --check`。

## 2026-05-27 Browser CDP 原子工具一致性

- [x] 原子 `browser.cdp` sidecar 的 `browser.click` / `browser.type` 与高层 `browser.use` 对齐，改用 `Runtime.evaluate` DOM action expression，并把 DOM 目标缺失作为失败暴露。
- [x] 原子 `browser.open` / `browser.navigate` 增加危险协议拦截，拒绝 `javascript:`、`data:`、`vbscript:`。
- [x] 新增 `docs/external/browser.cdp.md` 与 `docs/external/browser.cdp.zh.cn.md`，不改写 active docs index。
- [x] 复跑 Browser CDP、Browser Use、external registry/socket、docs/check/diff 门禁。

## 2026-05-27 Computer Use Hermes Schema 对齐

- [x] `computer.use` action schema 增加 `middle_click`，并补齐 Hermes-style `mode`、`maxElements`、`button`、`modifiers`、`seconds`、`raiseWindow` 字段。
- [x] `computer.use` CUA backend payload 增加 snake_case 归一化字段：capture mode/max elements、drag source/target、button/modifiers、seconds、raise window 等。
- [x] 新增 `docs/external/computer.use.md` 与 `docs/external/computer.use.zh.cn.md`，不改写 active docs index。
- [x] 复跑 computer/browser focused tests、external registry/socket tests、docs/check/diff 门禁。

## 2026-05-27 Browser/Computer Use Opt-In 运行时闭环

- [x] 新增显式 opt-in runtime 测试，覆盖 `browser.use` / `computer.use` 从 external manifest、Tool Plan、本地 computer-capable surface 到 `RuntimeMcpToolExecutor` process-json 执行的闭环。
- [x] 修复 `PluginRunner` 执行 PATH 命令时缺少最小查找环境的问题；只透传 PATH/PATHEXT/SystemRoot/WINDIR，不继承全量环境变量。
- [x] 新增 `docs/external/use.runtime.closure.md` 与 `docs/external/use.runtime.closure.zh.cn.md`，记录默认不暴露、显式启用、运行时闭环和安全边界。
- [x] 复跑 focused tests、`bun run docs:check`、`bun run check`、真实闭环 smoke、全量测试与 `git diff --check`。

## 2026-05-27 Computer Use 安装态对齐

- [x] 将默认真实 external tools manifest、`tools/init.ts`、POSIX `tools/init.sh`、PowerShell `tools/init.ps1` 对齐：登记 `computer.use` process-json sidecar，但保持 `tools: []` 默认不暴露。
- [x] 更新 installer 回归，确认 `computer-use` package、runner path、`xtool-sidecar computer.use` args 和空工具面同时存在。
- [x] 新增 `docs/external/computer.use.install.md` 与 `docs/external/computer.use.install.zh.cn.md`，记录“已安装但不暴露”的安全语义。
- [x] 复跑 docs/typecheck、真实闭环 smoke、全量测试与 `git diff --check`。

## 2026-05-27 Browser Use 真实浏览器 Smoke

- [x] 新增可选真实 Chrome/Chromium CDP smoke，覆盖 `browser.use` 的 open/navigate/type/click/captureAfter/evaluate/screenshot 闭环。
- [x] smoke 默认在缺少浏览器时结构化 skip，`--require-browser` 模式下缺浏览器失败，避免普通门禁被本机环境阻塞。
- [x] 新增 `docs/external/browser.use.live.md` 与 `docs/external/browser.use.live.zh.cn.md`，只追加文档，不改写既有 active docs。
- [x] 复跑 browser-use live smoke、focused 工具层测试、docs/check/typecheck/真实闭环/full test 与 `git diff --check`。

## 2026-05-27 Computer Use 真实 CUA Smoke

- [x] 新增可选真实 CUA-driver smoke，覆盖 `computer.use` 的只读 capture/list_apps/wait CUA backend 闭环。
- [x] smoke 默认在缺少 `cua-driver` 时结构化 skip，`--require-cua` 模式下缺 driver 失败，避免普通门禁被本机桌面驱动环境阻塞。
- [x] 新增 `docs/external/computer.use.live.md` 与 `docs/external/computer.use.live.zh.cn.md`，只追加文档，不改写既有 active docs。
- [x] 复跑 computer-use live smoke、focused 工具层测试、docs/check/typecheck/真实闭环/full test 与 `git diff --check`。

## 2026-05-27 Use Tool 提示词边界

- [x] 收紧 `browser.use` / `computer.use` 模型可见 descriptor：显式标注 opt-in 高权限、观察优先、不能替代 workspace/git/process/file 工具。
- [x] 新增 descriptor 回归测试，锁住高层 use 工具的提示词边界。
- [x] 新增 `docs/external/use.prompt.boundary.md` 与 `docs/external/use.prompt.boundary.zh.cn.md`，只追加文档，不改写既有 active docs。
- [x] 复跑 focused descriptor/tool plan tests、docs/check/typecheck/真实闭环/full test 与 `git diff --check`。

## 2026-05-27 Use Tool PATH/PATHEXT 可移植性

- [x] `browser.use` / `computer.use` sidecar delegate command lookup 支持 PATHEXT 风格后缀，覆盖 `.cmd` / `.exe` 等跨平台委托入口。
- [x] 新增 browser/computer use focused 回归，验证无扩展名 PATH command 能解析到 `delegate.cmd`。
- [x] 新增 `docs/external/use.path.portability.md` 与 `docs/external/use.path.portability.zh.cn.md`，只追加文档，不改写既有 active docs。
- [x] 复跑 focused sidecar tests、docs/check/typecheck/真实闭环/full test 与 `git diff --check`。

## 2026-05-27 Browser Use CDP 协议失败闭环

- [x] 新增 `browser.use` CDP WebSocket 非 JSON 帧回归，要求立即返回结构化 `failed`，不能等待超时。
- [x] 修复 `browser.use` CDP response reader，在帧解析失败时携带截断 frame 进入 sidecar failure details。
- [x] 复跑 focused browser-use sidecar、check、docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser CDP 原子协议失败闭环

- [x] 新增原子 `browser.cdp` CDP WebSocket 非 JSON 帧回归，要求立即返回 process-json failure，不能等待超时。
- [x] 修复 `browser.cdp` response reader，在帧解析失败时写出明确错误并保留截断 frame。
- [x] 复跑 focused browser-cdp/browser-use sidecar、browser live smoke、check、docs、真实闭环与 `git diff --check`。

## 2026-05-27 Computer Use 只读 CaptureAfter 闭环

- [x] 新增 `computer.use` 只读 action 回归，验证 `wait` 带 `captureAfter: true` 不额外触发 capture 子进程。
- [x] 修复 `computer.use` captureAfter gate：所有 `READ_ACTIONS` 都直接返回原结果，只有变更动作触发后置观察。
- [x] 复跑 focused computer-use/browser-use/browser-cdp tests、computer-use live smoke、check、docs、真实闭环与 `git diff --check`。

## 2026-05-27 Computer Use Scroll Direction Schema

- [x] 新增 `computer.use` scroll invalid direction 回归，确认错误在 sidecar 校验层返回而不是落到 delegate unavailable。
- [x] 将 `computer.use` descriptor 的 `direction` 对齐为 `up/down/left/right` enum，并在 sidecar 中复用同一枚举校验。
- [x] 复跑 focused computer-use/external descriptor tests、computer-use live smoke、check、docs、真实闭环与 `git diff --check`。

## 2026-05-27 Computer Use Scroll Amount Schema

- [x] 新增 `computer.use` scroll invalid amount 回归，确认非整数 amount 在 sidecar 校验层返回而不是落到 delegate unavailable。
- [x] 将 `computer.use` descriptor 的 `amount` 对齐为 `integer`，范围为 `1..1000`，并在 sidecar 中复用同一边界校验。
- [x] 复跑 focused computer-use/external descriptor tests、computer-use live smoke、check、docs、真实闭环与 `git diff --check`。

## 2026-05-27 Tool Call Strict JSON Prompt Boundary

- [x] 真实 `smoke:live:closure` 在 citizen permission resume 后暴露 `<agent_tool_calls>` 非严格 JSON parse failure。
- [x] 收紧 `mcp.context` 中英文提示词，明确 tool call block 内只能使用严格 JSON，并优先使用 `input` object 形态。
- [x] 复跑 prompt lint、docs/check、真实闭环与全量门禁。

## 2026-05-27 Computer Use Target Integer Schema

- [x] 对齐 Hermes computer-use target schema：`element/fromElement/toElement`、`maxElements`、坐标数组 items 在模型可见 descriptor 中使用 integer 语义。
- [x] sidecar 在 delegate spawn 前拒绝小数 element / drag target / coordinate item，避免不可执行目标进入外部后端。
- [x] 新增 focused 回归与追加文档，复跑 computer-use/external descriptor tests、live smoke、check、docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser Always-Blocked URL Floor

- [x] 参考 Hermes `url_safety.py`，为 `browser.use` 与原子 `browser.cdp` 增加 cloud metadata / link-local URL 地板拦截。
- [x] 保持本地开发与真实 browser smoke 可用：不扩大到 localhost/file/private 全量 SSRF 策略，只阻断不可协商 metadata 端点。
- [x] 新增 focused 回归与追加文档，复跑 browser-use/browser-cdp tests、browser live smoke、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser URL DNS Safety Floor

- [x] 对齐 Hermes `is_always_blocked_url`：普通 hostname 若解析到 metadata/link-local 凭据地址，`browser.use` 与原子 `browser.cdp` 必须在 backend/delegate 前阻断。
- [x] 将 URL 安全地板收敛到 browser sidecar owner helper，避免 kernel 引入 browser/desktop runtime，同时减少两个 sidecar 的安全常量漂移。
- [x] 新增 focused DNS 回归并更新追加文档，复跑 browser-use/browser-cdp/browser-url-safety tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Use Sidecar Resource Bounds

- [x] 为 `browser.use` 与 `computer.use` delegate/CUA 资源配置增加硬上限，避免 `timeoutMs` 或 `maxOutputBytes` 静默扩大单次子进程执行窗口。
- [x] 保持 ASK、plan、yolo、动态预算和默认工具暴露不变；非法资源配置在 command resolution / delegate spawn 前结构化失败。
- [x] 新增 focused 回归与追加文档，复跑 browser-use/computer-use tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 External Manifest Resource Bounds

- [x] 在 `external.tools.jsonc` normalization 层同步限制 `timeoutMs` 与 `maxOutputBytes`，避免坏 manifest 先进入模型可见 catalog。
- [x] 保持 sidecar 执行期资源边界不变；manifest 层失败必须发生在 command resolution / executor 暴露之前。
- [x] 新增 focused 回归与追加文档，复跑 external-tools tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 External Stability PATHEXT Portability

- [x] 让 external manifest stability preflight 与 sidecar delegate execution 使用一致的 PATHEXT executable suffix 解析，避免 Windows package entry 被 catalog 层误判 unavailable。
- [x] 新增 app-relative 与 PATH command focused 回归，确认 `.cmd` 等后缀在模型可见前可被解析。
- [x] 归档旧路径可移植性文档后重写 active 文档，复跑 external-tools tests、docs/check、真实闭环与 `git diff --check`。

## 2026-05-27 User Tool Project CWD Boundary

- [x] 区分 `.flyflor/tools.jsonc` user manifest tools 与 `tools/external.tools.jsonc` external sidecars 的 `cwd: "project"` anchor。
- [x] 保持 external sidecar 兼容语义不变；user manifest process-json tool 必须从真实 `paths.projectDir` 启动。
- [x] 新增 focused 回归与追加文档，复跑 user-tool cwd tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 User Tool Resource Bounds

- [x] 在 `.flyflor/tools.jsonc` user manifest normalization 层限制 process-json executor 的 `timeoutMs` 与 `maxOutputBytes`。
- [x] 与 external sidecar 资源边界保持一致，避免本地 user tool manifest 静默扩大单次子进程执行窗口或输出缓存。
- [x] 新增 focused 回归与追加文档，复跑 executive manifest tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Tool Call Parse Failure Closure

- [x] malformed `<agent_tool_calls>` 严格 JSON 失败必须进入结构化 tool failure + Executive ASK，不允许冒泡成 `turn.error`。
- [x] 失败路径必须保留 socket/TUI/history/brain 可见的 execution metadata，且不能猜测或修复工具调用意图。
- [x] 新增 focused runtime 回归与追加文档，复跑 MCP runtime tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Computer Use Hermes Snake Case Descriptor

- [x] `computer.use` 模型可见 descriptor 暴露 Hermes 风格 snake_case target aliases：`capture_after`、`from_element`、`to_element`、`from_coordinate`、`to_coordinate`、`max_elements`、`raise_window`。
- [x] sidecar 对 `capture_after` 的语义与 `captureAfter` 对齐，不能只在 descriptor 中展示但执行期忽略。
- [x] 新增 focused descriptor/sidecar 回归与追加文档，复跑 external/computer-use tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser Use Hermes Actions

- [x] 为 `browser.use` 增加 Hermes 风格 `scroll` 和 `press` action，仍只通过 process-json sidecar/CDP/delegate 执行。
- [x] 模型可见 descriptor 暴露 `direction`、`amount`、`key`/`keys`，并保持高权限 browser control opt-in。
- [x] 新增 focused browser-use/external descriptor 回归与追加文档，复跑 browser-use tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser Use Hermes Navigation

- [x] 为 `browser.use` 增加 Hermes 风格 `back` 与 `get_images` action，仍只通过 process-json sidecar/CDP/delegate 执行。
- [x] 模型可见 descriptor 暴露 `maxImages` 资源上限，并保持高权限 browser control opt-in。
- [x] 新增 focused browser-use/external descriptor/live smoke 回归与追加文档，复跑 browser-use tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser Use Hermes Console

- [x] 为 `browser.use` 增加 Hermes 风格 `console` action，仍只通过 process-json sidecar/CDP/delegate 执行。
- [x] 模型可见 descriptor 暴露 `expression` 与 `clear`，并保持高权限 browser control opt-in。
- [x] 新增 focused browser-use/external descriptor/live smoke 回归与追加文档，复跑 browser-use tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Computer Use Capture-After Context

- [x] `computer.use` 后置 capture 保留 `app`、`mode`、`maxElements` / `max_elements` 上下文，避免 `focus_app` 后回看错范围。
- [x] 保持 delegate/CUA 都只通过 process-json 子进程执行，不新增 kernel browser/desktop runtime import。
- [x] 新增 focused computer-use 回归与追加文档，复跑 computer-use tests、check/docs、真实闭环与 `git diff --check`。

## 2026-05-27 Browser Use Hermes Vision

- [x] 为 `browser.use` 增加 Hermes 风格 `vision` action：CDP 只负责截图，视觉分析必须委派给外部 process-json `visionDelegateCommand`。
- [x] 模型可见 descriptor 暴露 `question` 与 `annotate`，并保持高权限 browser control opt-in、ASK、plan、yolo、动态预算不变。
- [x] 新增 focused browser-use/external descriptor/live smoke 回归与追加文档，复跑 browser-use tests、check/docs、真实闭环、全量测试与 `git diff --check`。
