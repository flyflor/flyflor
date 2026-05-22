# Flyflor 日志

## 2026-05-21

- 状态：open
  操作者：main-codex
  范围：documentation-architecture-alignment
  摘要：开始主线文档对齐，把 Flyflor 更新为“智能生命体内核”口径，补齐控制文件协作脚手架，并为文档 worktree 初始化做准备。
  原因：在进入多 worktree 并发开发前，项目哲学、核心设计和实现文档必须先明确描述 Flyflor 不是通用 agent runtime，而是面向智能生命体的认知内核。
  验证：pending

- 状态：completed
  操作者：main-codex
  范围：documentation-architecture-alignment
  摘要：完成主线架构锚点文档改造、追加式 LOGS 脚手架，并从新基线创建三个并列文档 worktree。
  原因：主 worktree 必须先拥有 canonical 的智能生命体口径，再从稳定基线派生并行文档 worktree。
  验证：`bun run docs:check`；`bun test tests/todo.status.test.ts tests/docs.index.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`；git commit `ae038bd`

- 状态：completed
  操作者：main-codex
  范围：documentation-architecture-alignment
  摘要：主线锚点文档已落地，三个文档 worktree 也已完成 review，并只把各自负责的智能生命体架构文档更新合并回协调主线。
  原因：主 worktree 持有 canonical 项目历史，需要以审查后的无冲突文档集收束这次 worktree 拆分。
  验证：pending

- 状态：completed
  操作者：main-codex
  范围：development-workflow-handoff
  摘要：新增 canonical 的 `git worktree + tmux + Codex` 开发流程文档，并从活动索引入口挂出，记录当前已 review 的 worktree 快照，方便后续 session 接续。
  原因：新的 session 需要仓库内显式交接并发执行、worktree 所有权、合并纪律和当前分支状态，不能只靠聊天历史反推。
  验证：pending

- 状态：completed
  操作者：main-codex
  范围：coordinator-mode-upgrade
  摘要：把仓库交接契约从短周期 seal sprint 升级为长线协调式重构模式，明确下一阶段目标是完整的智能生命体内核，并要求每次停下前都更新 workflow/handoff 文档并全量 push。
  原因：下一阶段需要比单线程串行推进更高的吞吐，而新的 session 也必须能不依赖聊天历史，直接恢复协调职责和 worktree/tmux 并发执行方式。
  验证：主线 handoff 文档已在下一轮 worktree 拆分前更新

- 状态：completed
  操作者：main-codex
  范围：kernel-worktree-bootstrap
  摘要：新增可复现的 `bun run kernel:tmux` 恢复入口，切出 context-memory、scope-crystal-ask、runtime-executive-ws 三个代码 worktree 分支，并把交接文档更新为新的并发内核开发布局。
  原因：下一阶段是大范围内核重构，所以新机器和新 session 需要稳定地重建 worktree、tmux 窗口和 child Codex 所有权，不能依赖瞬时 shell 状态。
  验证：`bun run kernel:tmux`

- 状态：completed
  操作者：main-codex
  范围：kernel-slice-integration-wave-1
  摘要：完成第一波代码 worktree 切片 review 与整合，把 live brain shard 轮换加固、crystal/scope/ask 收口，以及 ws thin-client loop smoke 和 request correlation 守卫合回 `main-codex-docs`。
  原因：项目需要一个已经审过的主线快照，使记忆轮换、crystal 召回/遗忘、ask/scope 固化以及 ws loop 可见性可以同时存在，作为下一轮长线内核推进的起点。
  验证：`bun test tests/brain.store.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts tests/ask.parse.test.ts tests/scope.scaffolder.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/docs.references.test.ts`；`bun run smoke:gateway:ask-loop`；`bun run smoke:gateway:control`；`bun run check`

- 状态：open
  操作者：main-codex
  范围：gateway-http-surface-prune
  摘要：计划把活动最小 Gateway 的 HTTP `/channels` 暴露面收掉，同时保留 WS `gateway.status.get` 快照通道不动。
  原因：当前迭代追求更小的 Gateway 表面积和更快的闭环，所以在 WS 控制面已经提供结构化连接状态后，REST 状态口是冗余的。
  验证：pending

- 状态：completed
  操作者：main-codex
  范围：gateway-http-surface-prune
  摘要：移除了活动 `/channels` HTTP 暴露面，退役了 live gateway.channels 文档，并把活动文档、测试和 gateway 模块收口到只保留 `/ws` 和 `/health`。
  原因：thin Gateway 不应在 REST 和 WS 两侧重复表达连接状态快照语义，因为 WS 控制面已经承载了 `gateway.status.get` 与 `gateway.status.snapshot`。
  验证：`bun test tests/gateway.module.test.ts tests/todo.status.test.ts tests/docs.references.test.ts`；`bun run docs:check`

- 状态：completed
  操作者：main-codex
  范围：kernel-wave2-reviewed-integration
  摘要：已 review 三个 wave2 子分支，并把各自拥有的实现面暂存进 `main-codex-docs`：确定性的 memory recall 时钟与 tie-breaker、通过 WS 发布的 executive loop 生命周期事件、codename 到 scope 的显式台账持久化、嵌套 ask 校验，以及 crystal consolidation 溯源。
  原因：wave2 tmux 拆分已经产出窄实现提交；协调者分支需要一个已 review 的主线快照，在保持 Gateway 暴露面收紧的同时推进 memory、runtime、scope、crystal 的闭环。
  验证：`bun test tests/activation.test.ts tests/graph.recall.test.ts tests/context.scope.test.ts tests/brain.store.test.ts tests/decay.anti.bloat.project.test.ts`；`bun run smoke:gateway:control`；`bun test tests/executive.tool.runtime.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/runtime.executive.boundaries.test.ts`；`bun test tests/ask.parse.test.ts tests/codename.promote.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/reflection.gem.consolidation.test.ts`；`bun run docs:check`

- 状态：open
  操作者：main-codex
  范围：kernel-wave3-tmux-orchestration
  摘要：从 `main-codex-docs@281108e` 新增 wave3 tmux/worktree 通道，同时保留此前所有 kernel 与 wave2 worktree。
  原因：下一轮开发需要最大化并发吞吐，但不能丢失既有执行历史；每个新分支都从已 review 的 wave2 主线快照出发，并保持窄所有权。
  验证：`bun run kernel:tmux -- --wave3`；`git worktree list`；`tmux list-windows -t flyflor-wave3`

- 状态：completed
  操作者：main-codex
  范围：wave3-scope-constitution-review
  摘要：已 review 并整合 wave3 scope constitution 切片，使晋升后的 scope 能获得完整双语 AGENTS/TODO/LOGS/README/project.memory 宪法层文件集，同时保持不覆盖已存在文件的幂等行为。
  原因：Scope worktree 在 scaffold 时就需要红线、任务状态、日志、交接文档和本地项目记忆指引，不能依赖聊天上下文或后续人工补救。
  验证：`bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

- 状态：completed
  操作者：main-codex
  范围：wave3-residual-cleanup
  摘要：已推送所有 wave3 子分支、停止子 Codex 进程、保留已合入的 scope constitution 实现，把 memory/runtime 验证记录保存在各自分支，并在进入主线前丢弃未完成的 runtime/protocol prototype。
  原因：项目规则要求追加式 worktree 历史且不能留下 dirty tail；失败或未完成探索必须记录，但不能留下破损代码或未推送本地状态。
  验证：对主线与所有 wave3 worktree 执行 `git status --short --branch`；`tmux list-windows -t flyflor-wave3`

- 状态：open
  操作者：main-codex
  范围：kernel-wave4-runtime-capability-orchestration
  摘要：启动 wave4 runtime-capability 拆分，把同一个剩余 P0 分成 smoke、metadata、history 三条通道，避免重复 wave3 里过宽的 protocol prototype。
  原因：Runtime capability E2E observability 仍是主要闭环缺口；拆开测试、runtime metadata 和 history replay 能让每个子分支更窄、更容易 review。
  验证：`git push origin main-codex-docs`；`git push -u origin wt/wave4-runtime-smoke`；`git push -u origin wt/wave4-runtime-metadata`；`git push -u origin wt/wave4-runtime-history`；`bun run kernel:tmux -- --wave4 --launch-codex`

- 状态：open
  操作者：main-codex
  范围：kernel-wave4-child-run
  摘要：已从推送后的追加式 worktree 启动 `flyflor-wave4`，包含 runtime-smoke、runtime-metadata、runtime-history 三个子 Codex 窗口。
  原因：用户要求把并发吞吐拉满，同时保留协调者 review、干净 worktree 和零残留尾巴。
  验证：`tmux list-windows -t flyflor-wave4 -F '#I:#W #{pane_current_path} #{pane_current_command}'`

- 状态：completed
  操作者：main-codex
  范围：kernel-wave4-runtime-capability-review
  摘要：已 review 并整合 wave4 metadata、history、smoke 三个切片到 `main-codex-docs`，新增 live `executiveToolExecutions`、从结构化 ledger provenance 投影的 replay-only execution metadata、compact planning replay metadata，以及成功批准 capability execution 的端到端 WS smoke。
  原因：Runtime capability execution 需要能通过 live `turn.final`、订阅 runtime event 和 `history.list` 回放被观察到，同时不能扩大 HTTP Gateway、不能恢复 `/channels`，也不能依赖从文本推断 history 分类。
  验证：`bun test tests/gateway.control.smoke.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/tui.chat.history.test.ts tests/skill.mcp.test.ts`；`bun run check`；`bun run docs:check`；`git diff --check`；`bun run build:binary`

- 状态：completed
  操作者：main-codex
  范围：kernel-wave4-cleanup
  摘要：已停止活跃 wave4 子 Codex 进程，保留 tmux 布局为 shell 窗口，并确认主线与所有 wave4 worktree 都 clean 且已推送。
  原因：每轮并发开发结束时必须没有活跃子进程、没有 dirty tail、没有未推送分支状态，才能进入下一轮迭代。
  验证：`tmux list-windows -t flyflor-wave4 -F '#I:#W #{pane_current_path} #{pane_current_command}'`；对 `main-codex-docs`、`wt/wave4-runtime-smoke`、`wt/wave4-runtime-metadata` 和 `wt/wave4-runtime-history` 执行 `git status --short --branch`

- 状态：completed
  操作者：main-codex
  范围：socket-smoke-entrypoint-polish
  摘要：已提升 socket-primary smoke/dev 脚本，同时把旧 gateway 命名脚本保留为极薄兼容包装。
  原因：活跃血管层 owner 已经是 `src/socket`；面向用户和贡献者的 smoke/dev 入口不应继续教大家运行 gateway 命名实现文件，但 v1 wire 与 CLI 兼容仍需保留。
  验证：`bun run check`；`bun test tests/gateway.control.smoke.test.ts tests/install.script.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`；`bun run smoke:socket:control`；`bun run smoke:socket:ask-loop`；`bun run smoke:socket:service`；`bun run docs:check`；兼容包装 `bun run scripts/gateway.control.smoke.ts`、`bun run scripts/gateway.ask.loop.smoke.ts`、`bun run scripts/gateway.service.smoke.ts`；`git diff --check`；`bun run test`；`bun run build:binary`
