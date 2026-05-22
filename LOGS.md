# Flyflor 日志

## 2026-05-21

- 状态：进行中
  执行者：main-codex
  范围：documentation-architecture-alignment
  摘要：启动主线文档对齐，把 Flyflor 对齐到“智能生命体内核”叙事，补充控制文件 workflow 脚手架，并准备文档向 worktree。
  原因：多 worktree 开发前，项目哲学、核心设计和实现文档需要把 Flyflor 描述为 lifeform-oriented cognitive kernel，而不是 generic agent runtime。
  验证：待验证

- 状态：已完成
  执行者：main-codex
  范围：documentation-architecture-alignment
  摘要：落地主线 architecture-anchor 文档 pass，增加 append-only LOGS 脚手架，并从新 baseline 创建三个 sibling 文档 worktree。
  原因：主 worktree 必须拥有 canonical lifeform framing，并从稳定已 review base 初始化并行文档 worktree。
  验证：`bun run docs:check`; `bun test tests/todo.status.test.ts tests/docs.index.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; git commit `ae038bd`

- 状态：已完成
  执行者：main-codex
  范围：documentation-architecture-alignment
  摘要：落地主线 anchor docs，review 三个文档 worktree，并只把它们归属的 lifeform-architecture 文档更新合回 coordinator branch。
  原因：主 worktree 拥有 canonical project history，必须用已 review、无冲突的文档集闭合 worktree split。
  验证：待验证

- 状态：已完成
  执行者：main-codex
  范围：development-workflow-handoff
  摘要：新增 canonical development workflow 文档，描述 `git worktree + tmux + Codex`，并从活动索引链接它，同时记录已 review 的 worktree snapshot 供后续 session 使用。
  原因：新 session 需要显式仓库侧交接，覆盖 parallel execution、worktree ownership、merge discipline 和当前 branch state，而不是从聊天历史重建。
  验证：待验证

- 状态：已完成
  执行者：main-codex
  范围：seal-blocker-recovery
  摘要：关闭剩余 seal blocker：在 owner-key index 创建前升级旧月度 `brain.db` shard，保护 archive locator import 兼容旧表，并强制 isolated `FLYFLOR_HOME` recovery smoke，避免 repo worktree 把 prompt/config 状态泄漏进 warmup。
  原因：仓库在 docs、check、deterministic tests 和 agent smoke 上已经通过；最终 release blocker 是一个窄 recovery/migration gap，会阻止新环境与新 session 干净完成 `kernel:seal`。
  验证：`bun test tests/brain.store.test.ts`; `bun test tests/config.memory.tuning.test.ts`; `bun run smoke:recovery`; `bun run kernel:seal`

- 状态：已完成
  执行者：main-codex
  范围：rust-shell-gateway-control-smoke
  摘要：新增确定性 `/ws` gateway control smoke，通过真实 GatewayModule 和 RuntimeModule 使用 `server.hello`、`gateway.status.get`、`capability.catalog.get`、`gateway.message.send`、`turn.delta`、`turn.final` 覆盖 thin-client bootstrap 与 stream path。
  原因：下一条 implementation lane 是 Rust shell backlog；任何外部 shell rewrite 前，Bun 主线需要一个可执行 guard，锁住 Rust 会消费的 exact control surface。
  验证：`bun run smoke:gateway:control`

- 状态：已完成
  执行者：main-codex
  范围：coordinator-mode-upgrade
  摘要：将仓库 handoff contract 从短 seal sprint 升级为 long-running coordinated refactor mode，显式目标是完整 intelligent-lifeform kernel，并要求每次停止时更新 workflow/handoff 且 push 所有分支。
  原因：下一阶段需要比单线程线性 loop 更高吞吐；新 session 必须能恢复 coordination 与 worktree/tmux execution，而不用从聊天历史重建意图。
  验证：下一次 worktree split 前已在主线更新仓库 handoff docs

- 状态：已完成
  执行者：main-codex
  范围：kernel-worktree-bootstrap
  摘要：新增可复现 `bun run kernel:tmux` 恢复入口，创建 context-memory、scope-crystal-ask 和 runtime-executive-ws 三个代码 worktree 分支，并更新 handoff docs 记录新的并发 kernel-development layout。
  原因：下一阶段是 broad kernel refactor；新机器与新 session 需要稳定方式重建 worktree、tmux window 和 child-Codex ownership，不能依赖 ephemeral shell state。
  验证：`bun run kernel:tmux`

- 状态：已完成
  执行者：main-codex
  范围：kernel-slice-integration-wave-1
  摘要：review 并整合前三个 code worktree slice 到 `main-codex-docs`，加入 live brain shard rollover hardening、crystal/scope/ask closure work、ws thin-client loop smoke 与 request-correlation guard。
  原因：项目需要一个已 review 主线 snapshot，让 memory rollover、crystal recall/forget、ask/scope solidification 和 ws loop visibility 同时存在，支撑下一轮长线 kernel pass。
  验证：`bun test tests/brain.store.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts tests/ask.parse.test.ts tests/scope.scaffolder.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/docs.references.test.ts`; `bun run smoke:gateway:ask-loop`; `bun run smoke:gateway:control`; `bun run check`

- 状态：进行中
  执行者：main-codex
  范围：gateway-http-surface-prune
  摘要：规划 active-priority prune，从 minimal Gateway 中移除 HTTP `/channels` surface，同时保持 WS `gateway.status.get` snapshot lane 不变。
  原因：当前迭代目标是更小 Gateway surface 和更快闭合；一旦 WS control 已暴露结构化 connection state，REST status endpoint 就是重复 surface。
  验证：待验证

- 状态：已完成
  执行者：main-codex
  范围：gateway-http-surface-prune
  摘要：移除活动 `/channels` HTTP surface，退役 live gateway.channels docs，并对齐活动 docs、tests 和 gateway module，使 HTTP 侧只保留 `/ws` 与 `/health`。
  原因：WS control 已携带 `gateway.status.get` 与 `gateway.status.snapshot` 后，thin Gateway 不应重复 connection snapshot 语义。
  验证：`bun test tests/gateway.module.test.ts tests/todo.status.test.ts tests/docs.references.test.ts`; `bun run docs:check`

- 状态：已完成
  执行者：main-codex
  范围：kernel-integration-wave-2
  摘要：保持主线 surface 收缩为 `/ws` 和 `/health`，记录 live peer-count status lane，并将 context-memory clock-driven recall 切片合回 coordinator branch。
  原因：活动 gateway 应保持轻薄，同时仍暴露可观测 hub pressure；memory/context 切片需要在下一轮 kernel pass 前回到主线。
  验证：`bun run check`; `bun run docs:check`; `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/brain.store.test.ts tests/brain.archive.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts tests/background.scheduler.test.ts tests/activation.test.ts tests/decay.anti.bloat.project.test.ts tests/dream.worker.test.ts tests/hot.memory.compression.worker.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/docs.references.test.ts`; `bun run build:binary`

- 状态：已完成
  执行者：main-codex
  范围：gateway-status-peer-count-contract
  摘要：在活动 WS/control docs 中固定 `clientCount` 为 live WS peer pressure，并添加 docs guard，使 Rust/thin-client handoff 保持该字段可见。
  原因：minimal Gateway 不再暴露 HTTP `/channels`，因此 peer observability 必须在 WS status snapshot 上保持显式，且不能与静态 channel availability 混淆。
  验证：`bun test tests/docs.references.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts`

- 状态：进行中
  执行者：main-codex
  范围：kernel-wave2-tmux-orchestration
  摘要：保留之前的 scope child branch，从 `main-codex-docs@c6d963f` 创建新的 wave2 worktree，并启动包含 memory、runtime 和 scope 子 Codex 窗口的 `flyflor-wave2`。
  原因：下一轮 kernel pass 需要更快闭合，同时不能让 child session 继续跑在 stale pre-merge worktree baseline 上。
  验证：`git worktree list`; `tmux list-windows -t flyflor-wave2`; `bun test tests/provider.readiness.test.ts tests/ask.cap.runtime.test.ts`

- 状态：已完成
  执行者：main-codex
  范围：kernel-wave2-reviewed-integration
  摘要：review 三个 wave2 子分支，并把它们归属的 implementation surface staged 到 `main-codex-docs`：deterministic memory recall clock 与 tie-breaker、WS-published executive loop lifecycle event、显式 codename-to-scope ledger persistence、nested ask validation 和 crystal consolidation provenance。
  原因：wave2 tmux split 产出窄 implementation commit；coordinator branch 需要单个已 review snapshot，在保持 Gateway surface 收缩的同时推进 memory、runtime、scope 与 crystal closure。
  验证：`bun test tests/activation.test.ts tests/graph.recall.test.ts tests/context.scope.test.ts tests/brain.store.test.ts tests/decay.anti.bloat.project.test.ts`; `bun run smoke:gateway:control`; `bun test tests/executive.tool.runtime.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/runtime.executive.boundaries.test.ts`; `bun test tests/ask.parse.test.ts tests/codename.promote.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/reflection.gem.consolidation.test.ts`; `bun run docs:check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-wave3-tmux-orchestration
  摘要：从 `main-codex-docs@281108e` 新增 wave3 tmux/worktree lane，同时保留所有之前的 kernel 和 wave2 worktree。
  原因：下一轮 development pass 需要最大并行吞吐，同时不能丢失 prior execution history；每个新 branch 都从已 review 的 wave2 mainline snapshot 开始并保持 ownership narrow。
  验证：`bun run kernel:tmux -- --wave3`; `git worktree list`; `tmux list-windows -t flyflor-wave3`

- 状态：已完成
  执行者：main-codex
  范围：wave3-scope-constitution-review
  摘要：review 并整合 wave3 scope constitution 切片，使 promoted scope 获得完整双语 AGENTS/TODO/LOGS/README/project.memory constitution 文件集，同时保持 idempotent no-overwrite 行为。
  原因：Scope worktree 需要在 scaffold 时立刻获得 redlines、task state、logs、handoff docs 和 local project-memory guidance，而不是依赖 chat context 或后续人工修复。
  验证：`bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

- 状态：已完成
  执行者：main-codex
  范围：wave3-residual-cleanup
  摘要：推送所有 wave3 子分支，停止 child Codex 进程，保留已合并的 scope constitution 实现，在 memory/runtime 分支保留 validation notes，并在不进入主线前丢弃不完整 runtime/protocol prototype。
  原因：项目规则是 additive worktree history 且 zero dirty tails；失败或不完整探索必须被记录，但不能留下 broken code 或未推送本地状态。
  验证：`git status --short --branch` across mainline and all wave3 worktrees; `tmux list-windows -t flyflor-wave3`

- 状态：进行中
  执行者：main-codex
  范围：kernel-wave4-runtime-capability-orchestration
  摘要：启动 wave4 runtime-capability split，拆为 smoke、metadata 和 history lane，让剩余 P0 并行推进，同时避免重复 wave3 的 broad protocol prototype。
  原因：Runtime capability E2E observability 仍是主要 closure gap；拆分 tests、runtime metadata 和 history replay 能让每个 child branch 保持 narrow 且可 review。
  验证：`git push origin main-codex-docs`; `git push -u origin wt/wave4-runtime-smoke`; `git push -u origin wt/wave4-runtime-metadata`; `git push -u origin wt/wave4-runtime-history`; `bun run kernel:tmux -- --wave4 --launch-codex`

- 状态：进行中
  执行者：main-codex
  范围：kernel-wave4-child-run
  摘要：从已推送 additive worktree 启动 `flyflor-wave4`，包含 runtime-smoke、runtime-metadata 和 runtime-history 子 Codex 窗口。
  原因：用户要求最大并行吞吐，同时保留 coordinator review、clean worktree 和 no residual tails。
  验证：`tmux list-windows -t flyflor-wave4 -F '#I:#W #{pane_current_path} #{pane_current_command}'`

- 状态：已完成
  执行者：main-codex
  范围：kernel-wave4-runtime-capability-review
  摘要：review 并整合 wave4 metadata、history 和 smoke 切片到 `main-codex-docs`，新增 live `executiveToolExecutions`、来自 structured ledger provenance 的 replay-only execution metadata、compact planning replay metadata，以及成功 approved capability execution 的端到端 WS smoke。
  原因：Runtime capability execution 需要通过 live `turn.final`、subscribed runtime events 和 `history.list` replay 可观测，同时不能扩大 HTTP Gateway、恢复 `/channels` 或依赖 text-derived history classification。
  验证：`bun test tests/gateway.control.smoke.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/tui.chat.history.test.ts tests/skill.mcp.test.ts`; `bun run check`; `bun run docs:check`; `git diff --check`; `bun run build:binary`

- 状态：已完成
  执行者：main-codex
  范围：kernel-wave4-cleanup
  摘要：停止活动 wave4 child Codex 进程，将 tmux layout 保留为 shell window，并确认 mainline 与所有 wave4 worktree clean 且已推送。
  原因：每一轮并行开发 wave 都必须在下一次迭代前以无活动子进程、无 dirty tail、无未推送分支状态结束。
  验证：`tmux list-windows -t flyflor-wave4 -F '#I:#W #{pane_current_path} #{pane_current_command}'`; `git status --short --branch` for `main-codex-docs`, `wt/wave4-runtime-smoke`, `wt/wave4-runtime-metadata`, and `wt/wave4-runtime-history`

- 状态：已完成
  执行者：main-codex
  范围：socket-wire-closure
  摘要：将活动 vascular transport owner 从 `src/agent/gateway` 移到 `src/socket`，引入 `SocketModule` / `SocketControlHub`，保留 `flyflor.ws.v1` 与 `gateway.*` wire-v1 compatibility string，并为 `/health`、`/ws`、live turn、event、status、capability、history、ask、planning 和 executive-loop 示例新增 Apifox 可导入 OpenAPI 契约。
  原因：项目模型是 intelligent lifeform，不是 session/chat gateway；socket 才是 live turns、events、operations 和 ledger query/replay 的正确 owner，同时 `brain.db` 保持 ledger/query/replay/audit only，context assembly 保持 Memory + Crystal + explicit Scope/Fork。
  验证：待最终完整验证；早期检查已通过 `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts`; `bun test tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/runtime.executive.boundaries.test.ts`; `bun run docs:check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：socket-wire-closure-final-validation
  摘要：完成 socket wire closure review，移除仍把 `src/agent/gateway` 当 owner 的活动 future-work prompt，修正 directory docs 使 live `src/executive` 保持活动 owner，并将历史 gateway 引用限制在 wire-v1 compatibility、old-docs、logs、TODO history 和 naming fixtures。
  原因：vascular transport layer 移到 `src/socket` 后，最终 handoff 不能为未来 tmux/worktree wave 留下 stale owner instructions。
  验证：`bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts`; `bun test tests/tui.chat.history.test.ts tests/memory.brain.wire.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts`; `bun test tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/runtime.executive.boundaries.test.ts`; `bun run docs:check`; `bun run check`; `bun run build:binary`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：socket-polish-pass
  摘要：将 `socket` 提升为 primary CLI/package/service naming，保留 `gateway` 作为 compatibility alias 与 wire-v1 vocabulary，收紧 Apifox OpenAPI client envelope schema，修正 event subscription class 示例，并用 docs/tests 防止 active gateway-as-owner drift。
  原因：物理 `src/socket` migration 后，release-facing docs、scripts、service plans 和 OpenAPI 需要 polish，使新用户和 Apifox scenario 从 socket semantics 开始，同时不破坏现有 v1 client。
  验证：`bun run docs:check`; `bun run check`; `bun test tests/gateway.control.smoke.test.ts tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts tests/naming.boundaries.test.ts tests/install.script.test.ts tests/docs.references.test.ts`; `bun run test`; `bun run build:binary`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：socket-owner-polish-pass-2
  摘要：将 working-memory recovery smoke startup 移到 primary `socket` 命令，把 composition-root internals 重命名为 `socket` 并保留 legacy `gateway` injection alias，同时 polish 活动 Executive/README/tmux 措辞，远离 Gateway owner language。
  原因：socket migration 已在功能上封板，但少数 active startup 和 coordination surface 仍让后续工作看起来应该启动或依赖 Gateway owner，而不是 socket vascular layer。
  验证：`bun run check`; `bun test tests/docker.runtime.smoke.test.ts tests/gateway.control.smoke.test.ts tests/install.script.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; `bun run scripts/working.memory.recovery.smoke.ts`; `bun run docs:check`; `bun run test`; `bun run build:binary`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：control-state-reconciliation
  摘要：协调 root TODO 中已 review 的 wave2/wave3 状态标记，追加最新 socket-owner/full-suite 状态，并更新双语 workflow handoff，使 wave4 和 socket-wire layout 被描述为已 review/可恢复历史，而不是活动 child-agent work。
  原因：代码和验证状态已经超过旧 orchestration notes；如果这些 note 继续 open，会误导下一轮并行 Codex wave 判断哪些 branch 仍需 review 或 validation。
  验证：`bun test tests/todo.status.test.ts tests/docs.index.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; `bun run docs:check`; `bun run check`; `bun run test`; `bun run build:binary`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：socket-smoke-entrypoint-polish
  摘要：提升 socket-primary smoke/dev scripts，同时把 legacy gateway-named scripts 保留为 thin compatibility wrapper。
  原因：活动 vascular owner 是 `src/socket`；面向用户的 smoke 和 dev entrypoint 不应继续教贡献者运行 gateway-named implementation files，同时 v1 wire 和 CLI compatibility 保持不变。
  验证：`bun run check`; `bun test tests/gateway.control.smoke.test.ts tests/install.script.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`; `bun run smoke:socket:control`; `bun run smoke:socket:ask-loop`; `bun run smoke:socket:service`; `bun run docs:check`; compatibility wrappers `bun run scripts/gateway.control.smoke.ts`, `bun run scripts/gateway.ask.loop.smoke.ts`, `bun run scripts/gateway.service.smoke.ts`; `git diff --check`; `bun run test`; `bun run build:binary`

- 状态：进行中
  执行者：main-codex
  范围：seal-wave-real-model-allocation
  摘要：从 clean single `master` 启动下一轮 seal wave，创建 `codex/seal-coordinator`，并分配七个 worktree：docs alignment、Apifox/OpenAPI scenarios、real-model socket scenarios、prompt optimization、DB/context guard、zero-character audit 和 release/binary seal。
  原因：Bun intelligent-lifeform kernel 基本已封板；下一步 closure 需要真实 configured-model scenarios、Apifox-importable contracts、prompt quality、谨慎 DB/context evolution 和 release gates，同时不把 Rust work 带入本仓库。
  验证：待 tmux launch、child branch push、focused slice validation、live scenario、full deterministic suite、binary build 和 final cleanup

- 状态：已完成
  执行者：main-codex
  范围：socket-openapi-scope-narrowing
  摘要：将活动 seal wave 收窄为 socket layer plus OpenAPI/Apifox only，合并 OpenAPI/Apifox 与 real-model socket scenario 切片到 `codex/seal-coordinator`，并推送 coordinator branch。
  原因：用户明确把 external adapters、Rust work、prompt optimization、DB/context evolution、zero-character audit 和 release/binary seal 移出当前轮次，让项目先闭合 socket blood-vessel layer 与 Apifox test surface。
  验证：`bun test tests/docs.references.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/gateway.module.test.ts`; `bun run docs:check`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run provider:ready -- --require-ready`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run smoke:socket:live`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run test:live`; `git push origin codex/seal-coordinator`

- 状态：进行中
  执行者：main-codex
  范围：socket-openapi-only-reallocation
  摘要：停止旧活动 tmux development session，保留现有 worktree 作为 additive history，并为 runtime wire polish、Apifox drift guard polish 和 live scenario coverage 准备新的三 lane socket/OpenAPI-only wave。
  原因：活动 development pool 少了三个有用进程，同时仍带着旧的 broader seal lane；更窄的 worktree wave 能保持吞吐，同时不让已暂停 prompt/DB/release work 泄漏回 socket/OpenAPI closure。
  验证：待 new branch creation、tmux launch、child Codex report、focused validation、review、merge 和 cleanup

- 状态：已完成
  执行者：socket-runtime-wire-polish
  范围：socket-runtime-wire-polish
  摘要：收紧 `/ws` runtime wire edge case：authorized upgrade failure 时返回 structured JSON，并在 invalid-envelope error response 中保留 protocol parser details。
  原因：活动 socket surface 已覆盖 `/health`、`/ws`、hello、ping/pong、status、capability、history、turn 和 event lane；本 pass 在不改变 v1 wire string、不触碰 DB/context 行为的前提下闭合小的 error/upgrade mismatch。
  验证：`bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/protocol.control.test.ts`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：socket-openapi-only-wave-review
  摘要：review 并 merge socket runtime wire polish、OpenAPI drift guard 和 real socket live coverage 到 `codex/seal-coordinator`；在 Apifox contract 中为 `/ws` 400 `gateway_control_upgrade_failed` 增加 coordinator closeout。
  原因：活动轮次限制为 socket layer plus OpenAPI/Apifox；合并切片闭合 runtime error consistency、contract drift 和 real configured-provider scenario coverage，同时不改变 wire-v1 name、DB/context assembly 或最小 `/health` + `/ws` HTTP surface。
  验证：`bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/protocol.control.test.ts`; `bun test tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`; `bun run docs:check`; `bun run check`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run provider:ready -- --require-ready`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run smoke:socket:live`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run test:live`; `git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：scope-vector-seal-wave-orchestration
  摘要：扩展 `flyflor-seal` 覆盖所有活动 lane，创建 `codex/scope-vector-core` 和 `codex/scope-vector-tests`，并在 coordinator 保持已验证 Scope Vector baseline 的同时启动剩余 zero-character 与 Scope Vector child agent。
  原因：用户要求 full worktree firepower 与更强 coordinator control；Scope graph indexing 现在是一等 seal wave，而不是隐式 main-thread patch。
  验证：`git worktree list --porcelain`; `tmux list-windows -t flyflor-seal -F '#I:#W #{pane_current_path} #{pane_current_command}'`

- 状态：已完成
  执行者：main-codex
  范围：scope-vector-coordinator-baseline
  摘要：新增 `ScopeVectorComponent`，带独立 SQLite DB、deterministic vector codec、bounded hot-subtree cache、codename/scope lookup，以及 MemoryModule prompt/turn/scope/codename integration。
  原因：Permanent Scope entities 需要快速 graph/tree index 与 recall layer，不能把所有 Scope 加载进内存，不能对其应用 forgetting curve，也不能把 `brain.db` 变成 prompt context。
  验证：`bun test tests/scope.vector.test.ts tests/context.scope.test.ts tests/codename.promote.test.ts tests/memory.brain.wire.test.ts`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：release-binary-seal
  范围：release-binary-seal-review
  摘要：确认 binary/install/docker-dev/release-assets/socket-service checks 在没有代码或文档变更的情况下通过；`smoke:release` 被本地 Docker daemon 不可用阻塞。
  原因：Bun binary packaging 是硬 seal 标准，但剩余 release smoke blocker 是环境可用性，而不是仓库代码。
  验证：`bun run build:binary`; `bun test tests/install.script.test.ts tests/docker.dev.smoke.test.ts tests/release.assets.test.ts`; `bun run smoke:socket:service`; `git diff --check`; blocked `bun run smoke:release` with `Cannot connect to the Docker daemon at unix:///Users/yi./.docker/run/docker.sock`

- 状态：已完成
  执行者：db-context-guard
  范围：db-context-guard-review
  摘要：review ledger/context boundary，并围绕 history replay assertion 做 test-only fix；没有 runtime code、DB schema 或 context assembly 变更。
  原因：seal wave 只在必要时允许 DB/context evolution；本 pass 确认当前 boundary sound，并修正测试，让它断言 persisted replay content，而不是 original transport message id。
  验证：`bun test tests/brain.store.test.ts tests/brain.archive.test.ts tests/context.scope.test.ts tests/tui.chat.history.test.ts tests/memory.brain.wire.test.ts`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：socket-live-coverage
  范围：socket-regression-coverage
  摘要：新增 socket-level regression coverage，覆盖 successful `/ws` upgrade 与 empty `history.list` replay boundary，不改变 product logic。
  原因：socket vascular layer 需要最小 HTTP surface 与 replay-only history 行为的 regression guard，同时保持 v1 wire compatibility。
  验证：`bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：full-worktree-closeout-review
  摘要：用真实 Codex worker 启动每个已记录的 `flyflor-seal` worktree lane，review 所有 child output，合并安全的 socket-runtime、socket-coverage、OpenAPI drift 与 zero-character guard 增量，并保持 coordinator Scope Vector implementation 为 canonical。
  原因：用户明确要求 coordinator control 和不忽略 worktree；本 closeout 把 parallel wave 转成已验证 mainline increment，同时拒绝重复或偏离架构的 proposal。
  验证：`tmux list-panes -a -F '#{window_index}:#{window_name}:#{pane_current_command}:#{pane_dead}'`; `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`

- 状态：已拒绝
  执行者：main-codex
  范围：child-lane-rejections
  摘要：拒绝 alternate `src/entities/scope` Scope Vector split、skipped/proposal Scope Vector tests，以及 socket-live 将 provider-not-ready 从 fail-fast 改成 `ok: false` report 的变更。
  原因：Scope Vector 已有 canonical coordinator owner：`src/cognitive/hippocampus/scope/vector`；live model gate 在 configured provider 不 ready 时必须清晰失败。
  验证：review `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.core`、`/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.tests` 和 `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios` diffs

- 状态：已完成
  执行者：main-codex
  范围：master-handoff
  摘要：将 handoff target 从 `codex/seal-coordinator` 更新为 `master`，提交 coordinator snapshot，切换当前 worktree 到 `master`，并 fast-forward `master` 到 seal snapshot。
  原因：下一环境/session 应从 canonical mainline 开始，而不是 staging branch。
  验证：`git switch master`; `git merge --ff-only codex/seal-coordinator`; 待 `git push origin master`

- 状态：已完成
  执行者：main-codex
  范围：scope-db-vector-closure
  摘要：将 Scope Vector persistence 提升为 scope-local `.flyflor/scope.db`，新增 tree/hot-memory/association tables，将 active-scope turn 写入 Scope hot memory，并记录与 `brain.db` 的分离。
  原因：Scope 需要自己的 context-equipment index 和 project hot memory plane；月度 `brain.db` 必须保持 life ledger/query/replay/audit/detail store，而不是 prompt 或 Scope-memory container。
  验证：`bun test tests/scope.vector.test.ts tests/context.scope.test.ts tests/codename.promote.test.ts tests/memory.brain.wire.test.ts`; `bun run check`; `bun run docs:check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-clean-slate
  摘要：提交并推送 Scope DB Vector closure，移除所有旧本地 worktree，删除旧本地 development branch，prune stale remote refs，并删除剩余 remote `codex/*` branch，使共享 baseline 只剩 `master`。
  原因：下一轮 development wave 需要更少、更干净的 lane，让主 Codex 作为 architecture guard 和 merge owner，而不是继续携带 stale worktree history。
  验证：`git worktree list --porcelain`; `git branch --format='%(refname:short)'`; `git branch -r --format='%(refname:short)'`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v2-worktree-orchestration
  摘要：用六条 full-kernel lane 替换旧 wave layout：scope-memory、fork-ask-crystal、runtime-executive、socket-protocol、release-seal 和 docs-contracts-report。
  原因：intelligent-lifeform kernel 仍需要 Scope/Memory、fork/ASK ghost/crystal、Runtime/Executive loop、Socket protocol、release validation 和 canonical project-report work 并行推进，同时不违反 owner boundary。
  验证：待 new worktree creation、branch push、child handoff prompts、focused validations 和 coordinator merge review

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-child-launch-paused
  摘要：创建并推送六个 Kernel V2 worktree，短暂启动 child Codex worker，然后在接受任何 child changes 前按用户要求关闭全部六个。
  原因：完整并行开发恢复前，需要收紧每个 worktree 的控制文件与 review protocol。
  验证：六个已启动 agent 均有 child worker shutdown notification；`git status --short --branch`

- 状态：进行中
  执行者：main-codex
  范围：worktree-control-file-protocol
  摘要：强化 `git worktree + tmux + Codex` workflow，要求每个 child worktree 在 relaunch 前拥有独立 `TODO.md`、`AGENTS.md` 和 `LOGS.md` 控制记录。
  原因：并行 Codex 工作必须可观察、可 review：`TODO.md` 承载任务列表/状态，`AGENTS.md` 承载本地宪法/红线，`LOGS.md` 承载带原因的变更历史。Child control files 采用 append/status-only，每次 merge 都必须通过主 Codex review。
  验证：待六个 worktree 完成本地控制文件初始化、docs check、branch commits 和 push

- 状态：已完成
  执行者：main-codex
  范围：worktree-control-file-protocol
  摘要：在六个 Kernel V2 worktree 中初始化独立 `TODO.md`、`AGENTS.md` 和 `LOGS.md` 段，并提交/推送这些本地控制文件 baseline。
  原因：Child Codex lane 在 implementation start 前必须可 review；它们的 task list、local red lines 和 append-only history 现在随各自 worktree branch 保存。
  验证：六个 worktree 内 `git status --short --branch`；`bun run docs:check`; `bun run check`; `git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v2-parallel-development
  摘要：控制文件初始化后，重新启动 `flyflor-kernel-v2` tmux，包含六条并发 Codex lane。
  原因：项目需要并行吞吐，同时主 Codex 继续负责 design drift control、owned-surface review 和 selective merge。
  验证：`tmux list-windows -t flyflor-kernel-v2 -F '#I:#W #{pane_current_path} #{pane_current_command}'`；待 child commits 和 review

- 状态：已完成
  执行者：main-codex
  范围：documentation-constitution-realignment
  摘要：更新仓库 Markdown contract：`README.md` 是英文入口，`README.zh.cn.md` 是中文对照，prompt templates 保持 canonical `.md` 加 `.zh.cn.md`，活动 `AGENTS.md`/`TODO.md`/`LOGS.md`/`docs/**/*.md` 默认中文且不强制 companion copies，Rust handoff docs 移入 `docs/old-docs/`，`abandon/` 保留给 retired non-runtime code。
  原因：之前 blanket bilingual-document rule 与当前 coordinator requirement 冲突，并持续把活动 docs 拉回 mechanical duplication；历史 Rust handoff material 也需要停止显示为活动 Bun-repo implementation work。
  验证：`bun test tests/docs.index.test.ts tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/prompt.templates.docs.test.ts`

- 状态：已完成
  执行者：main-codex
  范围：installer-readme-no-global-bin
  摘要：重写 installer 与 README contract，使一键 source/binary/Docker/Windows bootstrap 将 Bun kernel 准备到 `~/.flyflor` 或显式 prefix 下，而不创建全局 `flyflor` command link。
  原因：全局 CLI/TUI command 保留给未来外部 `npm i -g flyflor` Rust client，它会通过 `/ws` 连接 Bun kernel；Bun 仓库 installer 不能占用 `~/.local/bin`、`/usr/local/bin` 或其他 host execution directory。
  验证：`bun test tests/install.script.test.ts tests/docs.index.test.ts tests/docs.references.test.ts tests/prompt.templates.docs.test.ts tests/todo.status.test.ts`; `bun run docs:check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：docker-release-socket-command
  摘要：合并 release-seal Docker dev startup correction，使 compose 调用 `socket` command，并让 Docker smoke runner 固定该契约。
  原因：Bun kernel 的外部 surface 是 `/ws` 加 `/health`；socket-layer rename 后 Docker dev 不应继续保留旧 `gateway` command wording 或 startup path。
  验证：`bun test tests/docker.dev.smoke.test.ts tests/install.script.test.ts`; `bun run docs:check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：scope-memory-prompt-boundary
  摘要：合并 scope-memory correction，从 `MemoryModule.buildPrompt` 移除 `brain.db` prompt-atom recall，并让 hippocampus activation 保持在 working-memory episodes 与 explicit Scope hot memory 上。
  原因：`brain.db` 是月度 life ledger/query/replay/audit/detail store；prompt/context equipment 必须来自 current input、MemoryComponent、CrystalComponent、explicit Scope/Fork 和 Executive-visible capabilities，Scope hot memory 存在 scope-local `scope.db`。
  验证：`bun test tests/runtime.perf.test.ts tests/memory.brain.wire.test.ts tests/context.scope.test.ts tests/scope.vector.test.ts`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：docs-template-socket-policy-alignment
  摘要：收紧 socket event subscription selector contract，拆分 README indexing，使英文链接 `docs/*.md`、中文链接 `docs/*.zh.cn.md`，强制 `templates/**` Markdown 双语镜像配对，并从活动仓库 surface 移除 root `AGENTS/TODO/LOGS.zh.cn.md` control-file companion。
  原因：仓库需要单一不漂移的 documentation/template policy：runtime 只加载 canonical template `.md` 文件，`.zh.cn.md` 文件只是 human-review mirror，worktree control files 保持中文 singleton 而不是重复本地历史。
  验证：`bun test tests/docs.index.test.ts tests/naming.boundaries.test.ts tests/prompt.templates.docs.test.ts tests/scope.scaffolder.test.ts tests/codename.promote.test.ts`; `bun run docs:check`; `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts tests/protocol.contracts.test.ts tests/docs.references.test.ts`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：control-files-and-style-rules
  摘要：将根 `TODO.md` / `LOGS.md` 旧叙述翻译为中文，并在 `AGENTS.md`、`docs/boundaries*.md` 和测试中固化控制文件中文单本、append/status-only、约定大于配置、分层先于复用、OOP + use Composition API、禁止函数式业务模块和短文件名规则。
  原因：控制文件必须成为可持续协作协议；架构层面允许少量重复代码，但不能牺牲目录 owner、模块边界、生命周期和 IO 副作用的可读性。
  验证：待相关测试与 docs check

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-progress-doc-alignment
  摘要：核查 `flyflor-kernel-v2` tmux/worktree 真实状态，确认当前为 6 个子 Codex lane 加 1 个主协调 pane；将进度快照、各 lane 状态、闭环逻辑、代码分层和 Scope/ASK/Fork/Crystal 设计口径补入 workflow、architecture、runtime.turn 和 memory.system 文档。
  原因：用户要求当前进度、子进程数量、完成度和项目总体状态，并要求重新对齐文档，清楚讲述闭环逻辑、代码分层和关键信息设计思想；主线在选择性合并前必须防止需求漂移。
  验证：`bun run docs:check`; `bun test tests/docs.index.test.ts tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts`; `bun test tests/ask.reply.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/docs.references.test.ts`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-fork-ask-crystal-merge
  摘要：选择性合并 `wt/kernel-fork-ask-crystal` 的实现和测试，不合并子 worktree 本地控制文件历史；主线现在支持解析 fork merge closure evidence、冲突 fork merge 进入 ASK、已合并 fork 证据进入 Crystal candidate。
  原因：Fork 像 branch、冲突触发 ASK、ASK ghost/continue 和闭合证据结晶是当前智能生命体内核闭环的核心设计点，不能让已完成 child lane 空转。
  验证：`bun test tests/continuation.decisions.parse.test.ts tests/reflection.gem.consolidation.test.ts tests/ask.cap.runtime.test.ts tests/ask.parse.test.ts tests/ask.reply.test.ts tests/crystal.local.backend.test.ts`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-runtime-executive-merge
  摘要：选择性合并 `wt/kernel-runtime-executive` 的剩余有效实现，不回退 fork merge runtime 代码，也不合并会削弱 OpenAPI selector enum guard 的旧分支文档；Executive loop guard snapshot 现在由 runtime 真实生成，重复失败结果会结构化 ASK 暂停。
  原因：nanobot-style runtime 必须在预算耗尽、unknown tool、重复失败和无进展时给出可审计 pause/resume，而不是继续隐藏重试或只在协议文档里声明 snapshot。
  验证：`bun test tests/executive.tool.runtime.test.ts tests/skill.mcp.test.ts tests/ask.reply.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts`

- 状态：已拒绝
  执行者：main-codex
  范围：kernel-v2-socket-protocol-residue
  摘要：review `wt/kernel-socket-protocol` 后不再合入剩余 diff；unknown event subscription selector guard、OpenAPI enum drift guard 和 WS 文档说明已经存在于主线，分支剩余差异会移除 `loopGuardSnapshot`、恢复 old Rust doc 路径并削弱当前协议契约。
  原因：子分支基线早于主线 runtime-executive 和文档政策收口，直接合并会造成设计回退；主 Codex 只接受不漂移的 implementation/docs surface。
  验证：review `git diff master..wt/kernel-socket-protocol`；主线已有 `bun test tests/ask.reply.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/docs.references.test.ts` 通过记录

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-scope-memory-residue
  摘要：review `wt/kernel-scope-memory` 后确认 owned code/test surface 与主线无剩余差异；`brain.db` prompt recall 移除、Scope hot memory 和 `scope.db` guard 已在主线闭合。
  原因：scope-memory lane 已完成且不应继续空转；控制文件历史不直接合并，主线只保留 canonical 摘要。
  验证：`git diff master..wt/kernel-scope-memory -- src/cognitive/hippocampus/memory/module.ts tests/memory.brain.wire.test.ts tests/runtime.perf.test.ts`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-release-seal-residue
  摘要：review `wt/kernel-release-seal` 后确认 installer/Docker scripts 和 install tests 与主线一致；剩余 diff 主要来自旧 README 中文化、`TODO.zh.cn.md` / `LOGS.zh.cn.md` 控制副本和旧文档策略，不合入。
  原因：主线已经满足“不创建全局 bin，只安装到 `~/.flyflor` / prefix，未来 `npm i -g flyflor` 连接 `/ws`”的安装策略；继续合入 release 分支剩余差异会破坏当前 README 英文入口和控制文件中文单本规则。
  验证：`git diff master..wt/kernel-release-seal -- scripts/install.sh scripts/install.source.sh scripts/install.docker.sh scripts/install.ps1 tests/install.script.test.ts docker-compose.yml docker/README.md docker/README.zh.cn.md scripts/docker.dev.smoke.ts tests/docker.dev.smoke.test.ts`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-docs-report-selective-merge
  摘要：review `wt/docs-contracts-report` 后只保留 `docs/project.report.md` 与 canonical index 链接；拒绝过宽 README rewrite、old-docs 回迁、控制文件 `.zh.cn.md` 副本和会回退当前主线协议/运行时事实的旧差异。
  原因：项目需要一个清晰的 Kernel V2 contract anchor，但不能让文档 lane 把已经收口的 README 英文入口、控制文件中文单本、Rust 外部交接口径和 loopGuard/fork merge 实现回退。
  验证：待 `bun run docs:check`、focused docs/naming/protocol/runtime tests、`bun run check`、`git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v2-child-lane-recycle
  摘要：fork-ask-crystal、runtime-executive、socket-protocol、scope-memory 和 release-seal 子 Codex lane 已 review 后停止回收；当前仅剩 `docs-report` 等待最终提交后关闭。
  原因：用户要求主 Codex 及时合并、及时回收、不要让 Codex 空转；review 完成的 worktree 只能保留为 evidence，不能继续消耗 tmux/codex 资源。
  验证：`tmux list-windows -t flyflor-kernel-v2 -F '#{window_index}:#{window_name}:#{pane_current_command}:#{pane_current_path}'`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-child-lane-recycle
  摘要：最终进程核查只剩主 Codex 自己和主 tmux window；无 `flyflor-wt-*` child Codex 进程继续运行。
  原因：并发 lane 已完成 review、合并或拒绝，继续保留子进程会制造空转和状态噪声。
  验证：`tmux list-windows -t flyflor-kernel-v2 -F '#{window_index}:#{window_name}:#{pane_current_command}:#{pane_current_path}'`; `ps -axo pid,ppid,stat,command | rg -i 'flyflor-wt|codex --dangerously-bypass|codex'`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v2-child-lane-recycle
  摘要：停止并回收最后一个 `docs-report` tmux window；`flyflor-kernel-v2` 现在只保留主协调 window。
  原因：docs-report 已选择性合并并完成验证，继续保留 child Codex 会造成空转和状态误判。
  验证：待最终 `tmux list-windows` 与 child Codex process scan

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-high-concurrency-launch
  摘要：按用户要求从低并发窄切调整为 8 条 child Codex 高并发推进；主 Codex 只负责调度、review、合并、验证和纠偏。
  原因：上一轮并发吞吐不够，主线需要尽快把 ASK ghost/continue、Scope 固化、Scope vector recall、Crystal Gem gate、Runtime loop resume、Socket E2E、Release seal 和 Docs sync 全部推到上线闭环。
  验证：`tmux list-windows -t flyflor-kernel-v3 -F '#{window_index}:#{window_name}:#{pane_current_command}:#{pane_current_path}'`; 8 条 child window 均为 Codex `node` 进程

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-merge-efficiency-metrics
  摘要：新增每次 child merge 的效率统计要求：记录 lane 用时、合并提交、文件数、插入/删除、`src`/`tests`/`docs`/`scripts` 分类行数、验证命令与耗时。
  原因：用户要求看到高并发 Codex 的实际效率提升，不能只汇报“已启动并发”，必须用每次合并的数据证明吞吐。
  验证：从下一次 accepted lane merge 开始，在 `LOGS.md` 和最终汇报中附带 `git diff --shortstat`、`git diff --numstat` 分类摘要和验证耗时

- 状态：已完成
  执行者：child-codex
  范围：release-seal-fast
  摘要：移除 Docker dev 容器内 `/usr/local/bin/flyflor` command shim，改为显式执行 `/tmp/flyflor-linux chat`，并用 Docker dev smoke 固定“不创建全局命令链接”的 release 契约。
  原因：Release Seal Fast lane 只负责 Bun kernel release seal；全局 `flyflor` command 归未来外部 CLI/TUI，installer 和 Docker dev 都不应占用全局执行目录。
  验证：`bun test tests/install.script.test.ts tests/docker.dev.smoke.test.ts tests/release.assets.test.ts`; `bun run build:binary`; `bun run check`; `git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-release-seal-fast-merge
  摘要：开始 review 并合并 `wt/release-seal-fast` 的首个可交付提交 `084e872`。
  原因：这是 Kernel V3 高并发后的第一个完成 lane，直接修正 Docker dev release surface，避免容器内继续创建全局 `flyflor` shim。
  效率：child 用时约 10m44s；10 files changed，25 insertions，17 deletions；分类为 control `+15/-8`，docs `+6/-6`，scripts/config `+3/-3`，tests `+1/-0`。
  验证：待主线重跑 release focused tests、`bun run docs:check`、`bun run build:binary`、`bun run check`、`git diff --check`

- 状态：已完成
  执行者：child-codex
  范围：scope-vector-recall
  摘要：让 ScopeVector hot-subtree recall 在 root scope 的 `scope.db` 内读取已物化的 related scope rows、edges、hot-memory 和 association evidence，并补充 scope-local related row 回归测试。
  原因：scope-local `scope.db` 是当前 Scope 的 bounded vector/tree/hot-memory/association 装备；召回 related scope 时不能跳去依赖每个 neighbor 项目的独立 DB，也不能退回 `brain.db` 做 prompt assembly。
  验证：`bun test tests/scope.vector.test.ts tests/memory.brain.wire.test.ts tests/runtime.perf.test.ts`; `bun run check`; `git diff --check`; `bun run docs:check`; `bun run build:binary`; `bun test tests/todo.status.test.ts tests/naming.boundaries.test.ts`; `bun test tests/agent.functional.smoke.test.ts`; `bun run test` 运行到 865 pass，剩余既有环境断言 `tests/provider.readiness.test.ts` 期望路径包含 `/flyflor/.config`，当前 worktree 路径为 `flyflor-wt-scope-vector-recall/.config`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-scope-vector-recall-merge
  摘要：开始 review 并合并 `wt/scope-vector-recall` 的提交 `23572ae`。
  原因：该 lane 已完成 scope-local hot-subtree recall 修复，强化 Scope `scope.db` 作为项目热区记忆与多维关联索引的闭环。
  效率：child 用时约 14m19s；4 files changed，68 insertions，28 deletions；分类为 control `+14/-7`，src `+28/-21`，tests `+26/-0`。
  验证：待主线重跑 scope vector focused tests、`bun run check`、`git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-crystal-gem-quality-gate-merge
  摘要：开始 review 并合并 `wt/crystal-gem-quality-gate` 的提交 `ed0c63c`。
  原因：该 lane 为 Crystal candidate 到 Gem 增加结构化质量门和 replay/audit explainability，是智能体长期晶体知识闭环的核心上线条件。
  效率：child 用时约 14m38s；7 files changed，269 insertions，14 deletions；分类为 control `+17/-7`，src `+144/-5`，tests `+108/-2`。
  验证：待主线重跑 crystal/reflection focused tests、`bun run check`、`bun run docs:check`、`bun run build:binary`、`git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-socket-control-e2e-merge
  摘要：开始 review 并合并 `wt/socket-control-e2e` 的提交 `230f159`。
  原因：该 lane 将 ASK、Scope、Fork、Executive loop snapshot 通过 `/ws` control/event surface 对外显式可见，是上线前外部 client 可观察闭环的关键接口。
  效率：child 用时约 15m16s；11 files changed，667 insertions，8 deletions；分类为 control `+15/-8`，docs/openapi `+174/-0`，src `+224/-0`，tests `+254/-0`。
  验证：待主线重跑 protocol/socket/docs focused tests、`bun run docs:check`、`bun run check`、`git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-ask-ghost-continue-merge
  摘要：开始 review 并合并 `wt/ask-ghost-continue` 的提交 `f748f4b`。
  原因：该 lane 持久化 unanswered ASK ghost continuation，并支持显式 structured `continue` 恢复 scope/fork/loop context，是长线 loop 不丢失的核心闭环。
  效率：child 用时约 18m12s；8 files changed，535 insertions，14 deletions；分类为 control `+14/-7`，src `+301/-6`，tests `+220/-1`。
  验证：待主线重跑 ASK/continuation focused tests、`bun run check`、`git diff --check`
