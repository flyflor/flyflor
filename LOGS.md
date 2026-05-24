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

- 状态：已完成
  执行者：main-codex
  范围：tui-phase1-fork-create-control
  摘要：审查并收口 TUI 第一阶段所需的最小 `fork.create` WS control command；保留协议枚举、payload reader、socket/control handler 与 SocketModule 注入回调，修正 fork record 使用标准化 parentId，并同步 OpenAPI/Apifox、测试与 WS 文档。
  原因：TUI 需要在不入侵 Runtime/Memory/Executive 主链的前提下创建显式 ContextFork；状态变更必须走 control command，只读详情继续走 socket query/read model。
  验证：`bun test tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/docs.references.test.ts`; `bun run docs:check`; `bun run check`; `git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：tui-phase1-query-event-contract-review
  摘要：确认 TUI 第一阶段 detail query 与 event.subscribe/event.publish 的真实 WS envelope shape；补充 WS 文档中 detail query matrix，明确 `history.detail.get` 响应类型为 `history.snapshot` 且 detail 数据位于 `payload.data`。
  原因：TUI 联调需要直接可用的请求/响应样例，避免把 `history.list` 的 `payload.history` 与 detail query 的通用 `payload.data` 混用。
  验证：`bun test tests/docs.references.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts`; `bun run docs:check`; `bun run check`; `git diff --check`
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

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-runtime-loop-resume-merge
  摘要：开始 review 并合并 `wt/runtime-loop-resume` 的提交 `c600050`。
  原因：该 lane 将 Executive loop pause 的 ASK ghost 与显式 continue 后续工具执行打通，补齐长线工具 loop 的恢复链路。
  效率：child 用时约 18m55s；4 files changed，128 insertions，9 deletions；分类为 control `+18/-7`，src `+24/-2`，tests `+86/-0`。
  验证：待主线重跑 executive/runtime/MCP focused tests、`bun run check`、`git diff --check`

- 状态：进行中
  执行者：main-codex
  范围：kernel-v3-scope-solidification-merge
  摘要：开始 review 并合并 `wt/scope-solidification-vector` 的提交 `2e4a19f`。
  原因：该 lane 通过结构化 ASK confirmation 和 codename evidence 升格补齐 Scope durable work domain 固化闭环。
  效率：child 用时约 17m08s；7 files changed，377 insertions，8 deletions；分类为 control `+16/-7`，src `+187/-1`，tests `+174/-0`。
  验证：待主线重跑 scope solidification/vector/codename focused tests、`bun run check`、`bun run docs:check`、`bun run build:binary`、`git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v3-scope-solidification-merge
  摘要：`wt/scope-solidification-vector` 已合入主线提交 `9592ccd`。
  原因：Scope 创建 ASK confirmation、codename evidence 物化和 scope-local `scope.db` 证据链已通过 review。
  效率：主线合入 7 files changed，370 insertions，1 deletion；分类为 control `+9/-0`，src `+188/-1`，tests `+174/-0`。
  验证：`bun test tests/scope.solidification.test.ts tests/scope.vector.test.ts tests/codename.promote.test.ts tests/context.scope.test.ts tests/scope.offer.test.ts` 1.65s；`bun run docs:check` 0.47s；`bun run build:binary` 0.69s；`bun run check` 16.92s；`git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：kernel-v3-docs-contract-sync-review
  摘要：拒绝直接合并 `wt/docs-contract-sync` 的 `56c84a7`，改为在主线手动同步已合入事实。
  原因：该分支相对当前主线过期，整分支 diff 会删除已接受的 ASK ghost、Scope 固化、Scope Vector、Crystal Gate、Socket control、Runtime loop、Docker release 与 OpenAPI 内容。
  效率：拒绝 stale broad merge，避免 39 files 中约 2029 行删除回退；保留文档事实同步为主线小范围 patch。
  验证：待最终 docs/focused/seal validation

- 状态：已完成
  执行者：main-codex
  范围：kernel-v3-final-seal-validation
  摘要：完成 Kernel V3 主线闭合验证，ASK ghost/continue、Scope 固化、Scope Vector、Crystal Gate、Runtime loop resume、Socket control snapshot、Release seal 和文档契约均已进入主线事实。
  原因：用户要求把智能生命体内核推进到上线可用闭环，并用主线验证而不是子 worktree 自报结果作为最终口径。
  效率：从 `origin/master` 到当前主线累计 36 files changed，2031 insertions，47 deletions；分类约为 control/docs `+74/-4`、docs/openapi `+174/-0`、scripts/config/package `+5/-5`、src `+908/-36`、tests `+870/-2`。
  验证：focused seal `bun test ...` 25 files / 251 tests / 17.69s；`bun run docs:check` 0.41s；`bun run build:binary` 0.58s；`bun run check` 13.24s；`git diff --check`

- 状态：已完成
  执行者：main-codex
  范围：ws-tui-read-model-query
  摘要：为 Rust TUI 对接补齐 `/ws` 只读查询面，新增 `src/socket/query`，并把 history/scope/fork/ask/blackboard/task/replay/thought/crystal 查询统一为 DB/read-model snapshot。
  原因：TUI 展开黑板、深度思考、ASK、fork、scope 记忆树和对话记录时，应能直接查 DB 的就只查 DB；除 `gateway.message.send` 输入输出外，不应入侵智能体核心或触发 prompt/context assembly。
  效率：20 files changed，约 2232 insertions，25 deletions；分类约为 control `+18/-0`，docs/openapi `+629/-2`，docs/ws `+138/-12`，src/protocol/socket `+183/-5`，src/socket/query `+1088/-0`，tests `+176/-6`。
  验证：`bun test tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts` 60 pass；`bun run docs:check` 25 pass；`bun run check`；`bun run build:binary` 生成 `dist/flyflor` 65M；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：kernel-99-plus-final-close
  摘要：完成 99%+ 内核封版收口：worktree/`wt/*` 分支清空，旧 tmux session 停止，`/ws` TUI read-model query 变更纳入最终 seal。
  原因：用户要求剩余工作全部完成，把智能生命体核心推到 99%+，为后续 Rust TUI/CLI 开发提供稳定 `/ws` 契约。
  效率：tracked diff 13 files changed，1144 insertions，25 deletions；新增 `src/socket/query` 7 files / 1088 lines，合计约 2232 insertions，25 deletions；`dist/flyflor` 65M。
  验证：`bun test tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts tests/scope.solidification.test.ts tests/scope.vector.test.ts tests/codename.promote.test.ts tests/context.scope.test.ts tests/scope.offer.test.ts tests/ask.reply.test.ts tests/ask.parse.test.ts tests/executive.tool.runtime.test.ts tests/crystal.local.backend.test.ts tests/reflection.gem.consolidation.test.ts` 124 pass；`bun run docs:check` 25 pass；`bun run check`；`bun run build:binary`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：apifox-ws-example-collection
  摘要：新增 Apifox 专用 WS 示例集合与展开视图：`docs/apifox/flyflor.socket.apifox.json` 提供 project-style WebSocket raw frame 条目，`docs/apifox/flyflor.socket.apifox.openapi.json` 提供 doc-only `/__apifox/ws/...` 视图，便于 Apifox 左侧路径树逐项测试。
  原因：canonical OpenAPI 真实 surface 只有 `/health` 和 `/ws`，Apifox 路径视图只显示两个接口，无法满足 TUI/WS frame 测试示例展开需求；必须在不污染真实服务契约的前提下补齐可测试示例。
  效率：新增生成脚本 701 行；生成 Apifox project JSON 12410 行、Apifox OpenAPI 视图 12499 行；手写 docs/test/package 约 127 insertions、21 deletions。
  验证：`bun run docs:check` 26 pass；`bun test tests/docs.references.test.ts` 13 pass；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：apifox-real-ws-correction
  摘要：纠正 Apifox 产物方向，移除导入承载体和辅助伪路径，只保留真实 `/health`、`/ws`、WS raw frame 消息目录和浏览器测试页；默认 `GatewayMessageSend` 示例改为无 Scope 的第一条对话；补齐旧 `brain.db` / `memory.sqlite` owner_key 迁移。
  原因：前端需要真实可用的 WebSocket 联调材料；任何 HTTP 伪发送入口或不可写占位 Scope 路径都会误导实现和测试，旧本地 DB schema 也必须能自动升级，不能让 TUI/前端为后端迁移兜底。
  效率：最终合并统计见 `ws-client-id-and-soul-profile-seal`；本轮大幅删除旧 Apifox project JSON，改为真实 OpenAPI + messages catalog + tester HTML。
  验证：已通过真实 `bun run socket` + WebSocket `GatewayMessageSend` 冒烟，收到 `turn.delta` 和 `turn.final`；最终 `bun run docs:apifox`、focused tests、`bun run docs:check`、`bun run check`、`bun run build:binary`、`git diff --check` 全部通过。

- 状态：已完成
  执行者：main-codex
  范围：legacy-db-destructive-reset
  摘要：按用户最新要求改为旧数据全部清空：旧 `brain.db` 检测到旧表/旧列/缺失当前关键列时直接 drop 运行态账本表并重建；旧月份 legacy brain 不再走 archive；旧 `memory.sqlite` 的 pending offer / memory 表同样清空重建，不再生成 `memory.project.sqlite` 旁路文件。
  原因：当前 release-seal 之后不保留旧本地运行态数据，避免旧 user/session/project/scene 语义混入新的 Scope/ASK/Fork/Brain 分层。
  效率：最终合并统计见 `ws-client-id-and-soul-profile-seal`；DB reset 变更集中在 brain schema/store、sqlite memory store 与对应测试。
  验证：`bun test tests/brain.store.test.ts tests/skill.offer.test.ts` 25 pass；最终 seal 通过 focused/docs/check/build/diff。

- 状态：已完成
  执行者：main-codex
  范围：ws-client-id-and-soul-profile-seal
  摘要：修复真实 `/ws` 连续复用 Apifox 示例时的 `UNIQUE constraint failed: memory_events.id`：WS 内部 turn id 改为 runtime UUID，客户端 `payload.id` 只作为 public messageId/metadata 回显；已生成回复后的 memory/ledger 写入失败不再降级为 `turn.error`。同时明确全局 Markdown 灵魂画像只读取 `.config/workspace/{SELF.md,IDENTITY.md,USER.md,MEMORY.md}`，`.zh.cn.md` 与旧 `SOUL.md` 不进入 prompt/context，并清理本地 `.config` 旧模板残留。
  原因：前端/Apifox 会重复发送示例 message id，协议层 id 不能污染内部账本主键；`.zh.cn.md` 是审查副本，不能进入灵魂画像，否则会制造中英双份和旧 SOUL 双身份源。
  效率：当前 tracked diff 合计 34 files changed，6631 insertions，16707 deletions；删除主要来自旧 `docs/apifox/flyflor.socket.apifox.json` 和旧伪路径视图收缩。新增/变更集中在 `src/socket/control.ts`、`src/protocol/control/envelope.ts`、`src/cognitive/hippocampus/memory/*`、Apifox 生成脚本/产物、安装脚本、文档和测试。
  验证：`bun test tests/install.script.test.ts tests/memory.brain.wire.test.ts tests/runtime.perf.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts` 134 pass；`bun run docs:check` 26 pass；`bun run check`；`bun run build:binary`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：scope-recall-gate-and-ws-full-e2e
  摘要：新增 Scope 回忆门控实现、scope recall 提示词与 runtime events，并补充真实 `/ws` 全场景 E2E 脚本；文档同步说明自然语言提起 Scope 时必须先由 LLM 判断 `none | load | ask`。
  原因：用户指出之前 Scope 装配路径偏差：触发关键字后不能先装配，必须先进入“回忆中”并由 LLM 语义裁决；scope-local `scope.db` 是项目热区记忆树和向量索引，独立于 `brain.db` 生命账本。
  效率：当前工作区累计 49 files changed，约 6933 insertions，16728 deletions；删除主要来自废弃 Apifox 伪 project JSON 与控制模板 `.zh.cn.md` 残留，新增集中在 scope recall component、真实 WS E2E、Apifox WS messages/tester、DB reset/migration guard、文档和测试。
  验证：`bun test tests/scope.recall.test.ts tests/inflight.tracker.test.ts tests/naming.boundaries.test.ts tests/scope.scaffolder.test.ts tests/release.assets.test.ts tests/scope.vector.test.ts tests/memory.brain.wire.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts` 123 pass；`bun run e2e:ws:full` 通过，覆盖 live turn、scope recall events、scope vector/memory recall、history/scope/fork/ask/task/replay/thought/crystal snapshots；`bun run docs:check` 26 pass；`bun run check`；`bun run build:binary`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：prompt-engineering-neutral-language-seal
  摘要：清理 `templates/prompts/**` 模型可见提示词，把产品名、内部 DB 名、器官隐喻和 Scope/Fork/ASK/MCP/Crystal/Gem 等开发黑话改成中性的任务/输入/输出/决策规则；`agent_*` 结构化块命名和 scope recall 语义裁决提示词已同步测试。
  原因：模型只理解同轮注入的文字，不能假设它知道内部开发定义；提示词必须像交给外部临时执行者的任务说明，避免把内部术语当作模型可执行语义。
  效率：当前工作区累计 107 files changed，7349 insertions，17164 deletions；本轮增量集中在 `templates/prompts/*`、`src/agent/prompts/*`、`src/protocol/structured.block.ts`、`tests/prompt.lint.test.ts` 和 `tests/scope.recall.test.ts`。
  验证：`rg` 禁词扫描 `templates/prompts` 零命中；`bun test tests/prompt.lint.test.ts` 10 pass；`bun test tests/structured.block.test.ts tests/scope.recall.test.ts tests/ask.parse.test.ts tests/continuation.decisions.parse.test.ts tests/identity.parse.test.ts tests/planning.blocks.test.ts tests/skill.mcp.test.ts` 78 pass；`bun run docs:prompts:check`；`bun run docs:check` 26 pass；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：dream-graph-legacy-schema-reset
  摘要：修复真实运行中 `memory.dream.failed` / `SQLiteError: no such column: owner_key`：`SQLiteGraphStore` 初始化现在会检测旧 `crystal.db` graph 表缺少 `owner_key` / recall 关键列时 drop graph tables 并重建当前 schema；同时修正 WS full E2E scripted fallback 不再依赖旧提示词内部短语。
  原因：旧 `crystal.db` 已存在时，`CREATE TABLE IF NOT EXISTS` 不会补新列，dream collect 的 owner-scoped 查询会直接失败；当前策略是不保留旧运行态 DB 数据，旧 schema 应自动清空重建。
  效率：本轮改动集中在 3 files：`src/cognitive/hippocampus/memory/graph/store.ts` 增加 legacy schema guard，`tests/graph.recall.test.ts` 增加回归测试，`scripts/socket.full.e2e.ts` 更新中性提示词探测条件。
  验证：`bun test tests/graph.recall.test.ts tests/dream.worker.test.ts tests/dream.zero.write.test.ts` 25 pass；`bun run e2e:ws:full` 真实 WS 全场景通过，`failedChecks: []`；`bun run check`；`bun run docs:check` 26 pass；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：executive-socket-tool-approval-closure
  摘要：收束核心调度与执行审批契约：WS `gateway.message.send.payload.context.toolApprovals` 现在在 OpenAPI、Apifox messages、tester、WS 文档和 docs guard 中完整可见；runtime 类型出口同步暴露 `RuntimeStreamOptions`，socket 不再引用未导出的类型。
  原因：TUI/前端需要通过真实 `/ws` 发起本轮显式工具审批，执行层必须保持 Executive catalog/schema/sandbox gate 清晰，不把 `shell.run` 伪装成跨平台脚本，也不能靠提示词补执行兼容性。
  效率：本轮新增/调整集中在 8 个文件，138 insertions、5 deletions；派生 Apifox 产物由 `bun run docs:apifox` 自动刷新，未新增运行时依赖。
  验证：`bun test tests/docs.references.test.ts tests/protocol.control.test.ts` 30 pass；`bun test tests/gateway.ws.test.ts tests/app.cli.test.ts tests/runtime.mcp.tool.plan.test.ts tests/skill.mcp.test.ts` 92 pass；`bun run docs:check` 26 pass；`bun run check`；`bun run e2e:ws:full` 真实 WS 全场景通过且 `failedChecks: []`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：local-code-inspection-tool-call-layer
  摘要：修复本地代码阅读调用层偏弱的问题：新增 `workspace.tree` 作为项目结构扫描第一步，并把模型可见工具提示词改为本地路径、仓库、代码库、文件内容和项目审查请求必须先调用文件工具，收到工具结果后才能声明已读。
  原因：真实对话中模型会在没有工具结果时声称“可以查看/已经阅读项目”，导致它无法像 Codex/OpenCode 一样先扫描、再读关键文件、最后基于证据输出架构和进度判断；调用层必须用能力目录和提示词共同压住这条行为红线。
  效率：本轮新增/调整集中在 workspace 工具、MCP 提示词、工具文档和测试；提交前统计以 `git diff --stat` 为准。
  验证：`bun test tests/skill.mcp.test.ts --test-name-pattern "workspace tree|workspace tools|workspace glob"`；`bun test tests/skill.mcp.test.ts tests/runtime.mcp.tool.plan.test.ts`；`bun test tests/prompt.lint.test.ts tests/naming.boundaries.test.ts`；`bun run docs:check`；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：codex-lane-socket-tool-events
  范围：socket-tool-events
  摘要：本 lane 只补工具生命周期事件、socket 订阅/查询可见面和文档契约。
  原因：TUI 需要看到执行血管事件，但 gateway/socket 能查 DB 或订阅事件解决的内容不能侵入智能体核心。
  验证：待补 focused tests、docs check、`bun run check`、`git diff --check`。

- 状态：已完成
  执行者：codex-lane-computer-coding-tools
  范围：computer-coding-tools
  摘要：本 lane 只补电脑控制基础工具面：文件、patch、git、process/shell 风险边界。
  原因：智能体需要像 Codex/OpenCode 一样真正读写和执行，但不能靠提示词硬凑，也不能破坏现有认知/记忆主链。
  验证：待补 focused tests、`bun run check`、`git diff --check`。

- 状态：已完成
  执行者：codex-lane-exec-runtime-loop
  范围：exec-runtime-loop
  摘要：在 `ExecutiveToolRuntime` 内落地三层预算 `modelToolTurnBudget` / `executionOperationBudget` / `riskQuota`，ASK 暂停 payload 增加 pause/continue/narrow/stop 与 crystal candidate 结构；Runtime MCP adapter 透传预算并把预算阻断保留为结构化工具结果。
  原因：执行循环需要把模型工具轮次、内部操作数和高风险额度分开表达，普通工具失败不能被吞掉或升级成 turn error。
  验证：`bun test tests/executive.tool.runtime.test.ts`；`bun test tests/skill.mcp.test.ts --test-name-pattern "runtime returns an ask when maxToolTurns is exhausted|runtime resume turn carries Executive pause ghost and continues tool execution|runtime feeds Executive loop guard diagnostics back after repeated failed tool calls"`；`bun run check`；待最终 `git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：computer-control-tool-loop-stage-isolation
  摘要：收拾电脑控制调用层半成品：补齐 `mcpToolNeed` prompt manifest/render 校验，新增模型结构化工具需求裁决，修正 WS 流式首轮不先外显无工具草稿，新增 `workspace.delete` 并纳入 catalog/schema/审批/Executive descriptor。
  原因：当前智能体遇到本地代码阅读、文件整理和项目检查时可能只输出自然语言草稿而不进入工具循环；阶段性补洞必须先恢复可验证状态，再把完整电脑控制设计隔离到独立 worktree 慢慢推进，避免继续污染 master。
  效率：当前未提交 diff 统计为 12 files changed，约 392 insertions、15 deletions；运行时代码集中在 `src/agent/runtime/mcp`、`src/agent/runtime/module.ts`、`src/executive/mcp.adapter.ts`，测试集中在 `tests/skill.mcp.test.ts`。
  验证：`bun test tests/prompt.lint.test.ts tests/naming.boundaries.test.ts tests/skill.mcp.test.ts --timeout 60000` 93 pass；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：exec-core-tmux-worktree-merge-closure
  摘要：确认并收口 `flyflor-exec-core-v1` tmux session 下的 `socket-events`、`coding-tools`、`exec-loop` 三条 worktree lane，并吸收 `computer-control-tool-loop` 的有效阶段性补洞；所有 lane 均通过 cherry-pick 或 no-ff merge 进入 `master`，避免旧分支整体 diff 回退主线文档、WS 契约和电脑工具能力。
  原因：用户要求主 Codex 使用 `git worktree + tmux + codex` 并发，并负责 review、合并、回收和防止需求漂移；本次重点是电脑控制能力、执行预算、工具事件和本地代码阅读调用层闭环。
  效率：当前 `master` 相对 `origin/master` 为 11 commits ahead，58 files changed，4892 insertions，122 deletions；本轮新合入重点提交包括 `88f06cf`、`0f0f26c`、`8dbff2e`、`aa0f477`。
  验证：`bun test tests/prompt.lint.test.ts tests/naming.boundaries.test.ts tests/skill.mcp.test.ts --timeout 60000` 93 pass；`bun test tests/computer.coding.tools.test.ts tests/executive.tool.runtime.test.ts tests/runtime.mcp.tool.plan.test.ts tests/event.component.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/docs.references.test.ts` 97 pass；`bun run docs:check` 26 pass；`bun run check`；`git diff --check`。

## 2026-05-24

- 状态：进行中
  执行者：main-codex
  范围：xtools-worktree-tmux-orchestration
  摘要：从干净 baseline 创建 `xtools-core-exec`、`xtools-subagent`、`xtools-external-kit` 三个 worktree/tmux 子进程；所有新资源统一 `xtools-*` 前缀，并同步 baseline 测试/文档修复到子分支。
  原因：本轮需要并发推进真实执行层、子代理和外挂功能工具，但用户明确要求不要影响其他正在工作的 session，且合并稳定性优先于并发数量。
  效率：启动时 master 为 15 commits ahead；新增 3 个 worktree、3 个 tmux Codex 子进程；每个 lane 已提交控制文件，后续按 core-exec -> subagent -> external-kit 顺序 review/merge。
  验证：`git worktree list --porcelain`；`tmux list-sessions | rg '^xtools-'`；最终验证待子分支完成后执行。

- 状态：已完成
  执行者：xtools-core-exec
  范围：底层执行原语
  摘要：审查并封住内建 workspace/git/process/shell 执行原语：确认 `workspace.tree/read/search/glob/stat/write/edit/delete/patch`、`git.status/diff/show`、`process.run` 和 `shell.run` 的 runtime 接线；修正 Executive descriptor 中 `workspace.patch` 的写权限分类，使工具可见性、预算风险和审批语义与真实写入行为一致；补充真实临时项目读树、glob、搜索、截断读取、二进制拒绝、patch add/update/move/delete 和 `process.run` 成功/失败结构化结果覆盖。
  原因：`workspace.patch` 已经是实际写能力，但 catalog/trust descriptor 漏判为只读会导致本地 TUI/WS 写权限面不稳定；Codex/OpenCode 风格底层执行原语需要用可执行测试证明读写、执行和错误回灌，而不是依赖提示词约束。
  验证：`bun test tests/computer.coding.tools.test.ts tests/runtime.mcp.tool.plan.test.ts tests/executive.core.test.ts`；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：xtools-subagent
  范围：子代理批处理执行
  摘要：新增 `subagent.batch` 内建工具、`RuntimeSubagentBatchComponent`、子任务事件、父级预算 batch 扣减、`brain.db` 行为快照 provenance 和 focused tests；子任务会复用真实模型生成，不是伪执行。
  原因：用户要求多个子代理由 LLM 决定并发数量，多个子代理只占用一个工具额度，同时所有子代理调用必须写入 `brain.db` 形成审计关联。
  效率：合入提交 `284c171`，19 files changed，787 insertions，11 deletions。
  验证：`bun test tests/skill.mcp.test.ts tests/event.component.test.ts tests/executive.tool.runtime.test.ts tests/runtime.mcp.tool.plan.test.ts` 81 pass；主线综合 focused tests 161 pass；`bun run check`。

- 状态：已完成
  执行者：xtools-external-kit
  范围：外挂功能工具目录
  摘要：新增 descriptor-only external tool registry，覆盖 browser/screen/computer/vision/audio/web/LSP/background task；运行时检测 `external.tools.jsonc` sidecar，有则注册，无则 hidden/unavailable；新增 mock sidecar installer 和 socket kit catalog 暴露。
  原因：浏览器、屏幕、鼠标键盘、视觉、OCR、语音、搜索、LSP 等属于可外挂能力，不应把重依赖打进 Bun kernel；核心读写仍走内建执行原语，外部能力只做功能扩展。
  效率：合入提交 `25fedc7`，16 files changed，1036 insertions，6 deletions；契约修正另补 `EventSubscription.types` 4 个子代理事件。
  验证：`bun test tests/external.tools.test.ts tests/runtime.mcp.tool.plan.test.ts tests/gateway.ws.test.ts tests/sandbox.gate.test.ts tests/plugin.runner.test.ts tests/computer.coding.tools.test.ts` 84 pass；`bun run docs:check` 26 pass；主线综合 focused tests 161 pass；`bun run check`。

- 状态：已完成
  执行者：main-codex
  范围：external-tools-local-dev-layout
  摘要：确认本地开发期可在仓库根目录使用与 `src/` 平级的 `tools/` 目录承载外挂工具源码和实验实现，并把该目录加入 `.gitignore`；同时把正式用户态治理面固定为 `~/.flyflor/.config/tools`，正式 payload 固定为 `~/.flyflor/tools`；本轮继续把 external sidecar manifest 读取路径从 kits 目录迁到专用 tools 控制面，kit catalog manifest 仍留在 kits 目录。
  原因：用户要求本地开发 tools 与 src 平级但不要进入 git；这能提高 Browser CDP 等 sidecar 迭代效率，同时保持内核仓库纯净和正式安装路径清晰。
  验证：`bun test tests/external.tools.test.ts tests/gateway.ws.test.ts --test-name-pattern "external|kit|sidecar"` 13 pass；`bun run docs:check` 26 pass；`bun test tests/computer.coding.tools.test.ts tests/gateway.ws.test.ts tests/event.component.test.ts tests/sandbox.gate.test.ts tests/plugin.runner.test.ts` 87 pass；`bun run check`；`git diff --check`。
