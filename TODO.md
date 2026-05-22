# Flyflor TODO

## 当前交接

状态：Bun 内核已封板。主线已经进入 Cognitive-Executive-Agent Architecture，外显面保持最小 WebSocket/event 血管层；旧第一方 shell 代码已移除，不再保留兼容备份目录。

本文件是下一段对话的交接说明，只描述当前契约与下一步工作。历史计划统一放在 `docs/old-docs/`，不得重新定义运行时行为。

最新 owner 口径：`src/socket` 拥有 socket 血管层。TODO 旧段落里把 gateway 放在 `src/agent` 下的说法只作为历史任务状态保留，后续新工作一律以当前口径为准。

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
- `bun run test`，820 个测试通过
- `bun run build:binary`

## 搜索 Guard

结束重构回合前，运行活动测试套件中的仓库连续性词汇 guard。不要为了记录检查而把禁用 token 粘贴进文档或 prompt。

```bash
bun test tests/todo.status.test.ts tests/naming.boundaries.test.ts
```

预期结果是 clean pass。

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
- [ ] 监控 `flyflor-kernel-v2` tmux lane，并中断任何漂移出归属 surface 的 child lane。
- [ ] 按顺序 review child commit：docs-contracts-report、scope-memory、fork-ask-crystal、runtime-executive、socket-protocol、release-seal。
- [ ] 只合并已 review 的 implementation/docs surface；有价值的 child control-file 历史摘要进 root handoff docs，而不是盲目合并本地噪声。
- [ ] 每个被接受的 child merge 后运行 focused validation。

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
- [ ] 继续 review 并选择性合并剩余 child commits，优先级：fork-ask-crystal、runtime-executive residue、socket-protocol residue、release-seal、docs-report。
- [ ] 最终 seal 前重新跑完整主线验证，并提交/push coordinator snapshot。
