# Flyflor 日志

## 2026-05-27

- 状态：已完成
  执行者：kernel-ask-permission
  范围：ask-citizen-permission-tool-event-loop
  摘要：为 Executive 工具暂停 ASK 增加结构化 citizen-permission answer contract，Runtime 拒绝裸文本继续授权并要求 `metadata.askAnswer`；同时补齐 Executive pause、MCP tool lifecycle 和 `process.run` start/exit 事件。
  原因：ASK 权限选择必须通过 socket/control metadata 显式回传，不能把 `continue-tools`、`keep-budget`、`keep-subagents` 当作普通用户消息推断；工具、子代理和进程失败也必须在 event 和 job detail 面可见。
  验证：`bun test tests/skill.mcp.test.ts`; `bun test tests/computer.coding.tools.test.ts tests/ask.presentation.test.ts tests/ask.normalizer.test.ts`; `bun run check`

## 2026-05-26

- 状态：已完成
  执行者：main-codex
  范围：documentation-tool-call-closure
  摘要：按“文档只添加；语义修改先归档再重写”的规则，归档并重写 Flyflor 核心文档中的 architecture、memory、blackboard、executive、control、ws 和 docs index，同时归档并重写 sibling `flyflor-cli` 的 docs index、architecture、protocol、tui-model 和 development 文档。
  原因：需要在实现工具调用闭环前，把智能生命体哲学分层、socket 血管边界、Executive 外骨骼、ASK/Blackboard/Memory/Crystal/Scope/Fork 关系，以及 CLI 当前缺口写成一致文档。
  验证：待运行 `bun run docs:check`、focused docs tests 和 `cargo test`。

## 2026-05-25

- 状态：已完成
  执行者：flyflor-codex-docs-agent
  范围：documentation-regeneration
  摘要：根据当前 Bun kernel/gateway 源码重产活跃文档，归档旧版 README/docs 到 `docs/old-docs/2026-05-25-docs-refresh/`，新增中英文同步的 architecture、directory、runtime、memory、blackboard、crystal、executive、control、ws、events、workflow 和 project report。
  原因：旧活跃文档与当前 `src/cognitive`、`src/executive`、`src/agent/runtime`、`src/socket`、`src/events`、`src/config` 分层口径不完全一致，且 docs 索引曾写成不强制中英同步。
  验证：进行中，先运行 `bun run docs:prompts --write`，随后执行 `bun run docs:check` 并按 guard 失败项修正文档锚点。

## 2026-05-24

- 状态：已完成
  执行者：xtools-docs-ws
  范围：external-tools-docs-seal
  摘要：补齐 External Kit 与 External Tools Seal 的三层工具模型，明确内建 coding 工具、原子 sidecar 和未来 `computer.use` 的边界，并记录 provider/delegate 失败语义、`.config/tools` 运行治理和 WS/TUI 只读消费边界。
  原因：本 worktree 负责 WS 场景、文档示例、能力矩阵和封板报告；外挂工具面需要先用文档固定分层和失败契约，避免 TUI 或 sidecar 把 discovery 当执行 API。
  验证：`bun run docs:check`; `bun test tests/docs.references.test.ts tests/docs.index.test.ts`; `git diff --check`

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

- 状态：进行中
  执行者：main-codex
  范围：xtools-browser-cdp-orchestration
  摘要：从主线 `56b1962` 创建 `feature/xtools-browser-cdp` worktree，并启动同名 tmux 子进程实现 Browser CDP 外挂 sidecar 最小闭环；本轮只允许 manifest、安装脚本、process-json sidecar、测试和文档，不允许引入重依赖或改动记忆/Scope/ASK 主链。
  原因：Browser CDP 是外挂工具层第一优先级，必须先证明 external tool 能从专用 tools 控制面发现、进入 Runtime 执行链、经过 sandbox 审计并给 TUI/前端暴露能力面。
  验证：待子分支完成后 review、focused tests、docs check、type check。

- 状态：已完成
  执行者：main-codex
  范围：xtools-browser-cdp-sidecar-merge
  摘要：review `feature/xtools-browser-cdp` 并 cherry-pick 到主线为 `603e1b1`。新增轻量 Browser CDP process-json sidecar、安装脚本、focused tests 和 External Kit 文档；sidecar 只连接已启动的 Chrome/Chromium CDP endpoint，不打包 Playwright/Chrome/native dependency。
  原因：Browser CDP 必须作为外挂能力通过 `~/.flyflor/.config/tools/external.tools.jsonc` 注册，进入 Executive Tool Runtime、PluginRunner、sandbox/approval/quota/audit 链路；内核不直接 import sidecar 实现，也不触碰 Memory、Scope、Crystal、ASK 或 fork 主链。
  效率：合入提交 `603e1b1`，8 files changed，634 insertions。
  验证：`bun test tests/browser.cdp.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts` 28 pass；`bun run docs:check` 26 pass；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：xtools-browser-cdp-cleanup
  摘要：移除已合并的 `xtools-browser-cdp` worktree 和本地 `feature/xtools-browser-cdp` 分支，确认没有同名远端分支，也没有 `xtools-*` tmux 会话残留。
  原因：该 lane 的业务提交已通过 patch 等价方式进入主线；保留已完成 worktree 会制造下一轮协调误判。
  验证：`git worktree list --porcelain`；`git branch -r --list 'origin/feature/xtools-browser-cdp'`；`tmux list-sessions | rg '^xtools-'`。
- 状态：进行中
  执行者：xtools-ws-e2e-seal
  范围：ws-tool-e2e-seal
  摘要：初始化 WS 工具封板 lane，准备补齐真实 socket 场景、文档示例和最终报告。
  原因：工具层不是只有单元测试，必须从 `/ws` 协议层证明工具目录、执行、事件、审计和回放完整。
  验证：待实现后补充。

- 状态：已完成
  执行者：xtools-ws-e2e-seal
  范围：ws-tool-e2e-seal
  摘要：合入 search-web、media、computer-native、utility 全部工具 lane，新增 `docs/external.tools.seal*.md` 能力矩阵与封板报告，并补 `gateway.ws.test` 确认 `/ws` kit catalog 暴露完整 26 个 external tool surface。
  原因：TUI/前端需要通过 `/ws` 获得完整工具能力面；缺失 sidecar 也必须以 disabled capability 暴露，而不是让前端猜测或导入 sidecar 实现。
  效率：WS 封板 lane 只改测试和文档，不新增业务 sidecar；工具实现来自已验证子 lane。
  验证：`bun test tests/web.search.sidecar.test.ts tests/media.sidecar.test.ts tests/computer.native.sidecar.test.ts tests/utility.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`；`bun test tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts`；`bun run docs:check`；`bun run check`；`git diff --check`。

- 状态：进行中
  执行者：xtools-lsp-task-data
  范围：lsp-task-data-sidecar
  摘要：初始化 LSP、后台任务和轻量数据工具 lane。
  原因：这些能力属于功能性外挂，应该通过 process-json sidecar 注册，不进入内建文件/git/process 原语。
  验证：待实现后补充。

- 状态：已完成
  执行者：xtools-lsp-task-data
  范围：lsp-task-data-sidecar
  摘要：新增 `scripts/utility.sidecar.ts` 和安装脚本，覆盖 `lsp.symbols`、`lsp.diagnostics`、`task.background`、`file.hash`、`archive.create`、`archive.extract`、`data.convert`。轻量 hash/archive/data 在 sidecar 内完成，LSP 与 background task 必须通过显式 delegate。
  原因：这些能力属于功能性外挂，不应回写内建 workspace/git/process/shell 原语，也不应侵入 Memory、Scope、ASK、Crystal 或 fork 主链。
  效率：本 lane 扩展 external registry，新增 utility sidecar、installer、process-json 测试、manifest 测试和安装脚本测试。
  验证：`bun test tests/utility.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`；`bun run docs:check`；`bun run check`；`git diff --check`。

- 状态：进行中
  执行者：xtools-computer-native
  范围：native-computer-sidecar
  摘要：初始化电脑原生控制 lane，准备实现屏幕、鼠标、键盘和窗口能力。
  原因：电脑控制必须通过外部 sidecar 进入 Executive/sandbox/approval/audit 链路，不能污染内核。
  验证：待实现后补充。

- 状态：已完成
  执行者：xtools-computer-native
  范围：native-computer-sidecar
  摘要：新增 `scripts/computer.native.sidecar.ts` 和安装脚本，覆盖 `screen.screenshot`、`computer.mouse`、`computer.keyboard`、`computer.window`。截图和窗口观察按平台探测系统命令；鼠标键盘必须通过 `external.tools.jsonc` 显式 delegate，缺失时返回 `unavailable`，不做隐藏控制兜底。
  原因：电脑控制能力必须跨 macOS/Windows/Linux 保持可探测、可失败、可审计；真正控制动作仍在 Executive Tool Runtime、sandbox、approval、quota 和 audit 链路后执行。
  效率：本 lane 新增 native computer sidecar、installer、process-json 测试、manifest 测试和安装脚本测试。
  验证：`bun test tests/computer.native.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`；`bun run docs:check`；`bun run check`；`git diff --check`。

- 状态：进行中
  执行者：xtools-media
  范围：media-sidecar
  摘要：初始化媒体 lane，准备实现视觉、OCR、语音转写和 TTS 外挂能力。
  原因：媒体能力需要支持 provider 或本地工具检测，但不能把重依赖和密钥打进 Bun 内核。
  验证：待实现后补充。

- 状态：已完成
  执行者：xtools-media
  范围：media-sidecar
  摘要：新增 `scripts/media.sidecar.ts` 和 `install.xtools.media.sh`，覆盖 `vision.analyze`、`vision.ocr`、`audio.transcribe`、`audio.speak`。sidecar 只接受 `external.tools.jsonc` 透传的 `config.providerUrl`、`config.providerHeaders`、`config.localCommands`，不从环境变量读取业务配置，不打包 OCR/Whisper/TTS/视觉 SDK 或模型资产。
  原因：媒体能力必须是外挂桥接层，真实 provider 或本地命令可替换，但内核只负责 manifest 发现、sandbox/approval/quota/audit 链路和失败显式暴露。
  效率：本 lane 新增 media sidecar、installer、process-json 测试、manifest 测试和安装脚本测试；focused diff 约 8 files changed。
  验证：`bun test tests/media.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`；`bun run check`；`git diff --check`。

- 状态：进行中
  执行者：xtools-search-web
  范围：search-web-sidecar
  摘要：初始化搜索网页 lane，准备实现 `web.search` 一等能力以及 `web.fetch`、`web.extract`、`web.download`。
  原因：网络搜索是本轮最高优先级，必须具备 provider 聚合、去重、来源标注、缓存、失败显式暴露和 WS 可回放能力。
  验证：待实现后补充。

- 状态：已完成
  执行者：xtools-search-web
  范围：search-web-sidecar
  摘要：新增 `web.search`、`web.fetch`、`web.extract`、`web.download` process-json sidecar；支持 Brave、Tavily、SerpAPI、Bing、generic provider，provider 聚合、URL 去重、warnings、Top N 补抓、TTL 缓存和项目目录内下载；`external.tools.jsonc` 支持向 sidecar 透传 opaque config。
  原因：搜索能力必须成为外挂工具层的一等能力，同时内核不能 import provider SDK 或 sidecar 实现；失败必须显式返回非零并写 stderr，不能被 hidden fallback 吞掉。
  效率：当前 lane diff 约 12 files changed，新增 `scripts/web.search.sidecar.ts`、`scripts/install.xtools.search.web.sh`、`tests/web.search.sidecar.test.ts`，核心注册表只增加 web 工具与 executor config 透传。
  验证：`bun test tests/web.search.sidecar.test.ts tests/external.tools.test.ts tests/executive.manifest.test.ts tests/install.script.test.ts`；`bun run check`；`git diff --check`。
- 状态：已完成
  执行者：main-codex
  范围：executive-ask-tools-relative-path-complete
  摘要：完成 `PLAN.md` 全部 Phase 0-15：ASK owner 分层、多问题推荐方案和固定 other；Durable Execution Job 与 brain.db execution-job ledger；`execution.job.*` socket 只读查询；外部工具 stability snapshot；package staging/next/apply/previous 升级事务；工具稳定性触发 `tool-stability` Executive ASK；ASK/job/tool-stability 结构化 evidence 进入 Crystal candidate；同步 runtime/external/crystal/boundaries/ws/OpenAPI/Apifox 文档。
  原因：执行层需要可暂停、可恢复、可审计、可查询，外挂工具需要相对路径、稳定性判定和升级状态，ASK 作为一等闭环器官要能承接预算、子代理、工具稳定性和结晶候选。
  效率：保持 `brain.db` 只做 ledger/query/replay/audit/detail，不参与 prompt/context assembly；socket job query 不调用 Runtime、模型或工具；工具层仍是 descriptor-only + process-json，内核不 import `tools/packages`。
  验证：`bun test tests/ask.parse.test.ts tests/ask.wire.test.ts tests/ask.normalizer.test.ts tests/ask.presentation.test.ts tests/executive.tool.runtime.test.ts tests/runtime.mcp.tool.plan.test.ts tests/external.tools.test.ts tests/install.script.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/reflection.thread.test.ts tests/computer.coding.tools.test.ts --timeout 30000`；`bun test tests/skill.mcp.test.ts tests/ask.reply.test.ts --timeout 30000`；`bun run check`；`bun run docs:check`；`bun run build:binary`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：main-planning-socket-seal
  摘要：收口当前 `master` 未提交改动，新增 runtime planning route、`task.plan.decide` WS 控制命令、planning/blackboard 边界提示词、事件分类和 OpenAPI/Apifox 示例；修正 Apifox 中 `task.plan.decide` 期望返回，真实返回为 `task.snapshot`。
  原因：TUI/Rust 前端需要区分 act/plan 交互模式，计划确认必须走显式 WS 控制命令和 DB read model，而不是让 live turn 或前端自行猜测状态。
  效率：主线封口 diff 为 27 个已跟踪文件约 949 行新增、8 行删除，另新增 `src/agent/runtime/planning/route.ts`、`templates/prompts/planning.route.md`、`templates/prompts/planning.route.zh.cn.md`、`tests/runtime.planning.route.test.ts`。
  验证：`bun test tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts tests/runtime.planning.route.test.ts`；`bun run docs:check`；`bun run check`；`bun run build:binary`；`git diff --check`。

- 状态：已完成
  执行者：xtools-provider-hardening
  范围：external-sidecar-provider-hardening
  摘要：强化 `web.search`、media HTTP/local provider、utility LSP/task delegate 与 archive 平台命令失败结构；缺配置、非法 JSON shape、非 JSON stdout、`ok:false` delegate/provider 和缺 `tar` 都返回带 `code` 的结构化失败。
  原因：外挂 provider/delegate 不能通过假结果、空结果或吞错伪成功进入工具链；公开工具名保持不变。
  效率：只修改 sidecar 与直接测试，不触碰 computer.use、docs、OpenAPI、Executive tool registry 或认知主链。
  验证：`bun test tests/web.search.sidecar.test.ts tests/media.sidecar.test.ts tests/utility.sidecar.test.ts`；`git diff --check`。

- 状态：已完成
  执行者：xtools-computer-use
  范围：computer-use-sidecar
  摘要：新增高层 `computer.use` process-json sidecar 和安装脚本，支持 delegate/cua backend、动作输入校验、危险输入阻断、`captureAfter` 二次捕获，并把 `computer.use` 纳入 external tool catalog。descriptor 携带 `ToolPermission.Computer`、exclusive、computer profile 和 `approval:computer` 标签，真实执行仍经 Executive user tool runtime、computer approval、quota 和 audit 链路。
  原因：高层电脑使用能力必须作为外挂 sidecar 暴露，内核只负责 manifest 发现、工具目录、sandbox/approval/audit metadata 和结构化失败，不能导入桌面控制实现或回写 Memory、Scope、ASK、Crystal 主链。
  效率：本 lane 新增 sidecar、installer、process-json 测试、manifest/catalog 测试和安装脚本测试；修复 external specs public getter 返回内部单例导致测试 matcher 污染的问题。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：routing-prompt-stability
  摘要：修复 fastRoute 短文本预算绕过 route LLM 的问题；短的形式定义冲突请求不再直接走 direct。同步强化 blackboard route、planning route 和 runtime system 提示词，解释交叉检查、非收敛、act/plan/yolo 边界，并保持 canonical 与中文镜像一致。
  原因：严格几何“正方形的圆”这类短请求包含互斥硬约束，必须由模型结构化路由判断进入交叉检查模式，不能被资源指标短路吞掉；同时提示词必须让模型能稳定理解模式边界，且继续遵守零字符匹配红线。
  效率：只触碰路由短路、提示词和直接测试；未新增任何基于用户文本的关键词、正则或 includes 语义规则。
  验证：`bun test tests/runtime.perf.test.ts tests/blackboard.boundaries.test.ts tests/runtime.planning.route.test.ts tests/prompt.lint.test.ts`；`bun run check`。

- 状态：已完成
  执行者：main-codex
  范围：blackboard-ask-boundary
  摘要：修复黑板封顶后的 ASK 边界：runtime 在 prepareTurn 读取 active ASK 结构化状态，下一轮用户回答 pending ASK 时直接进入模型消化，不再重新 route、planning 或启动第二个 blackboard；persist snapshot 在 ASK 创建或消费时清零黑板 failure/watch 计数。
  原因：黑板 `NeedsUser` 已经代表需要用户决策，继续用 failure retry 升级器重开黑板会让系统在用户回答前重复辩论，并可能生成违反原约束的最终方案。
  效率：主链只增加 `activeAsk` 门控和 `askBoundary` 计数器输入；未新增用户文本关键词、正则或句式判断。补 runtime 回归覆盖黑板封顶 ASK、choices、用户回答后不再二次黑板。
  验证：`bun test tests/route.escalation.test.ts tests/runtime.perf.test.ts tests/blackboard.boundaries.test.ts tests/runtime.planning.route.test.ts tests/prompt.lint.test.ts tests/ask.cap.runtime.test.ts`；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：tool-call-routing-fix
  摘要：合入 `xtools-tool-call-fix`：Act 模式直接进入正常回复/MCP 工具循环，不再先调用 planning route 生成计划草稿；显式 Plan 模式仍保留 planning route。新增绝对路径项目分析回归，覆盖模型先输出“看一下结构”类草稿时，`mcp.tool.need` 必须生成 `workspace.tree` 并执行。
  原因：读本地项目、分析代码这类请求属于执行层工具闭环；前置 planning gate 会消耗模型响应并让工具循环失焦，导致用户看到“我先看看”但没有真实工具调用。
  效率：只修改 `RuntimeModule.resolvePlanningGate` 和直接测试；未触碰 Memory、Scope、ASK、Crystal 主链，未新增关键词、正则或语义字符匹配。
  验证：`bun test tests/runtime.planning.route.test.ts tests/skill.mcp.test.ts --timeout 30000`；`bun test tests/gateway.ws.test.ts --timeout 30000`；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：local-path-hard-execution
  摘要：修复本地路径执行入口：runtime 在工具循环首轮模型生成前识别已存在的本地绝对路径，目录强制注入 `workspace.tree`，文件强制注入 `workspace.read`；目录/文件存在性改用 `fs.stat`，中文粘连路径改用最长存在路径前缀；workspace tree provenance 摘要优先保留条目文件名。
  原因：Codex/OpenCode/Claude-Code 风格的本地项目阅读不能依赖模型自觉输出工具 JSON。之前目录探测和粘连路径都会漏，导致用户看到“我先看看项目结构”但没有真实工具调用，或工具结果摘要被长路径截断后丢掉关键文件名。
  效率：只触碰 Runtime 本地路径探测、workspace tree 摘要和直接测试；保持零字符工程边界，该逻辑只做资源定位，不做意图/语义分类；未修改 Memory、Scope、ASK、Crystal 主链。
  验证：`bun test tests/skill.mcp.test.ts --timeout 30000`；`bun test tests/runtime.planning.route.test.ts tests/runtime.mcp.tool.plan.test.ts tests/gateway.ws.test.ts --timeout 30000`；`bun run check`；`git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：model-planned-subtask-batch
  摘要：新增 `mcp.subtask.plan` 提示词和 `RuntimeSubagentPlanner`，在首轮工具草稿缺失或本地目录广域分析时，由模型结构化决定是否把工作委派给 `subagent.batch`。子任务规划只接受 catalog 中真实可用工具，支持收窄 allowlist、并发数和子任务工具轮次；OpenAPI/Apifox 同步补齐 `fork.memory.*` 与全量 runtime event subscription 枚举。
  原因：用户要求“读完整项目”“搜索多个在线资料”“浏览器登录截图上传”等复合动作压缩成一个父级额度，而不是让主执行循环被许多底层工具调用耗尽；是否拆分必须由模型决策，不能硬编码关键词或任务类型。
  效率：新增模型规划提示词、planner、runtime 注入路径和 focused 回归；保留 `subagent.batch` 原有 sandbox/audit/provenance 链路，未修改 Memory、Scope、ASK、Crystal 主链。
  验证：`bun run docs:check`；`bun run check`；`bun test tests/skill.mcp.test.ts tests/gateway.ws.test.ts tests/event.component.test.ts tests/runtime.planning.route.test.ts tests/runtime.mcp.tool.plan.test.ts --timeout 30000`；`git diff --check`。

- 状态：部分完成
  执行者：main-codex
  范围：executive-ask-tools-relative-path-v1
  摘要：按用户要求先创建 `PLAN.md` 执行账本；修复子代理 child `needs_user` 不稳定进入 ASK 的结构问题；扩展 ASK 协议为 authority/source/resumePolicy + 多问题推荐方案 + 固定 other；Executive pause ASK 现在输出执行策略、预算策略和子代理策略三组结构化问题；外挂工具 manifest 支持 schema v2 与 `cwd:"app"`，默认 xtools registry/installer 使用 app-relative 路径，绝对 sidecar command 变为 unavailable。
  原因：执行层需要具备长 loop 可暂停、可恢复、可审计的能力；ASK 是高权限闭环器官，不能让子代理阻塞降级成普通工具失败；外挂工具配置必须减少绝对路径复杂度，避免 `.config`、源码、二进制和工具 package 对不上。
  效率：本次先完成 Phase 0/1/2/4/8/9 的可验证切片，未展开 Durable Job store、brain.db job ledger、socket job query、稳定性状态机和升级事务，避免一次改动过大。
  验证：`bun test tests/ask.parse.test.ts tests/ask.wire.test.ts tests/executive.tool.runtime.test.ts tests/skill.mcp.test.ts --timeout 30000`；`bun test tests/external.tools.test.ts tests/install.script.test.ts --timeout 30000`；`bun run check`。

- 状态：已完成
  执行者：main-codex
  范围：executive-ask-job-ledger-v1
  摘要：完成 Phase 3/5/6：ASK 拆成 `AskComponent` owner，parser/normalizer/policy/presentation/ledger 分层；`subagent.batch` 升级为 Execution Job v1，返回 jobId、childJobId、progress 和 ASK job 引用；Execution Job 生命周期写入 `brain.db` append-only `execution-job` 事件。
  原因：执行层暂停、子代理阻塞和长任务进度必须可见、可审计、可恢复；`brain.db` 只做 ledger/query/replay/audit/detail，不能存完整 prompt 或大型工具输出。
  效率：保持旧 `parseAgentAsk`、`AgentAskParser`、runtime `renderAskReplyText`/`buildAskMetadata` 兼容导出；新增 job owner 不改变工具 sandbox/approval/audit 边界。
  验证：`bun test tests/ask.parse.test.ts tests/ask.reply.test.ts tests/ask.wire.test.ts tests/ask.normalizer.test.ts tests/ask.presentation.test.ts tests/executive.tool.runtime.test.ts tests/skill.mcp.test.ts tests/external.tools.test.ts tests/install.script.test.ts --timeout 30000`；`bun run check`；`git diff --check`。

## 2026-05-27

- 状态：进行中
  执行者：kernel-ask-permission
  范围：ask-citizen-permission-tool-loop
  摘要：启动内核侧 ASK 公民权限与工具闭环修复，限定修改 Executive ASK、结构化权限答案、tool/subagent/process event 和 execution job detail 可见性。
  原因：TUI 曾把 `continue-tools keep-budget keep-subagents` 写成普通用户消息，且工具/子进程/ASK loop 失败时处于黑盒状态。
  验证：待运行 targeted tests 与 `bun run check`。

- 状态：已完成
  执行者：kernel-ask-permission-review
  范围：ask-citizen-permission-validation
  摘要：复核当前 worktree diff，移除误生成的 singular `AGENT.md`，并收紧 citizen-permission ASK 恢复门控：`metadata.askAnswer` 必须携带结构化 choice/value/patch，空对象不会恢复工具执行。
  原因：公民权限恢复不能只检查 metadata 对象存在；空结构仍缺少用户选择，必须继续返回 ASK。
  验证：`bun test tests/skill.mcp.test.ts`; `bun test tests/computer.coding.tools.test.ts tests/ask.presentation.test.ts tests/ask.normalizer.test.ts`; `bun run check`; `git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：ask-citizen-permission-final-hardening
  摘要：按协调红线恢复 `AGENT.md -> AGENTS.md` 软链，并将 citizen-permission ASK 恢复门控从“存在结构化字段”收紧为“结构化答案能解析出有效执行策略”；未知 choice/value 不会恢复工具执行。
  原因：本轮明确要求保留 `AGENT.md` 兼容入口；同时随机结构化字段不等于公民授权，必须继续 ASK。
  验证：待重新运行 `bun test tests/skill.mcp.test.ts`、`bun run check` 与 `git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：ask-citizen-permission-final-verification
  摘要：完成主控补丁后的最终验证，确认空结构、未知 choice 和裸文本都不会恢复 Executive 工具执行；有效结构化 permission choice 才能继续。
  原因：收紧 ASK 公民授权恢复语义后必须重新验证 focused suite、类型检查和 diff hygiene。
  验证：`bun test tests/skill.mcp.test.ts`; `bun test tests/computer.coding.tools.test.ts tests/ask.presentation.test.ts tests/ask.normalizer.test.ts`; `bun run check`; `git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：socket-control-smoke-permission-resume
  摘要：修复 `scripts/socket.control.smoke.ts` 中旧式 ASK 恢复请求，第二轮不再发送普通文本继续语义，而是发送安全授权文本与结构化 `metadata.askAnswer`、`citizenPermission`，对齐公民权限 ASK 契约。
  原因：内核已经禁止裸文本或空结构恢复 Executive 工具循环；smoke 仍使用旧隐式恢复会反复得到 ASK，导致 socket control 闭环验证失败。
  验证：`bun run smoke:socket:control`; `bun test tests/gateway.control.smoke.test.ts --timeout 30000`; `bun test tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/tui.chat.history.test.ts tests/context.fork.store.test.ts tests/gateway.dedup.test.ts --timeout 30000`; `bun run check`; `git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：real-llm-loop-closure
  摘要：新增 `scripts/live.loop.closure.ts` 与 `smoke:live:closure`，在隔离 temp home/workspace 中使用真实 DeepSeek provider 覆盖 baseline turn、workspace/process/git 工具、预算 ASK、普通文本不恢复、结构化公民权限恢复、subagent batch、history replay、execution job ledger、brain.db phantom message guard 和外部 sidecar descriptor 可见性。
  原因：单元测试不足以证明 flyflor 与 flyflor-cli 的工具调用闭环；必须用真实模型、真实 socket、真实账本和真实工具面验证 ASK loop 不再黑盒卡住。
  验证：`bun run provider:ready -- --require-ready`; `bun run build:binary`; `bun run install:xtools:utility`; `bun run smoke:live:closure` 输出 `ok: true`，`askAnswerPairs=1`、`executionJobCount=11`、`phantomPermissionUserEvents=0`、`toolExecutionKeys` 包含 `workspace.read`、`workspace.write`、`process.run`、`git.status`、`subagent.batch`；`bun run test:live`; `bun run smoke:socket:live`; `bun run smoke:agent:live`; `bun run smoke:socket:control`; `bun run check`; `bun run test:kernel`; `bun run docs:check`; `bun run test`; `git diff --check`。
  风险：真实 LLM smoke 依赖当前 home provider 可用性；外部工具 payload 位于 ignored `tools/packages`，不作为提交内容。

- 状态：已完成
  执行者：main-codex
  范围：template-install-case-sensitive-prune
  摘要：修复 `scripts/install.templates.ts` legacy memory template prune，在大小写不敏感文件系统上只删除 readdir 中实际精确匹配的旧文件名，不再误删 canonical `self.md`、`memory.md`、`user.md`。
  原因：真实 TUI tmux 场景使用隔离 `FLYFLOR_HOME` 安装模板时，macOS 会把 `SELF.md` 删除请求作用到 `self.md`，导致 kernel turn error 并暴露模板安装不可靠。
  验证：`bun test tests/prompt.templates.docs.test.ts`; `bun run smoke:live:closure`; `bun run test`; `git diff --check`。

- 状态：已完成
  执行者：main-codex
  范围：safe-real-xtools-surface
  摘要：收紧默认真实 xtools manifest 与初始化脚本，只默认开放 Browser 只读/截图探测、Computer 只读窗口/截图探测和本地 Utility 工具；click/type/navigate/evaluate、mouse/keyboard/computer.use、provider/delegate-backed web/media/LSP/task 不再作为默认 available 工具暴露。同步更新 live closure，使真实 LLM 场景校验安全 probe available、危险控制和缺 provider 工具 unavailable。
  原因：真实高权限闭环需要看到外部工具能力，但默认工具面不能把鼠标、键盘、浏览器执行等控制动作交给模型；缺 provider 的工具必须结构化 unavailable，不能黑盒吞错。
  验证：`bun test tests/install.script.test.ts tests/external.tools.test.ts --timeout 30000`; `bun run check`; `bun run install:xtools:utility`; `bun run smoke:live:closure`; `bun run docs:check`; `bun run test:kernel`; `bun run test`; `git diff --check`。
  风险：`tools/packages` 是本地 ignored payload，不作为提交内容；真实 smoke 仍依赖 home DeepSeek provider 当前可用。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-xtools-v1
  摘要：新增 `browser.use` 高层 browser-use 外挂工具：`scripts/browser.use.sidecar.ts` 通过 process-json 子进程提供 delegate/CDP 后端，`src/executive/external/tools.ts` 登记 descriptor，`src/executive/sidecar/runner.ts` 登记 bundled runner，`tools/init.*` 与 mock/install wrapper 增加 `browser-use` 包。默认真实 manifest 只写 `browser.use` sidecar 配置和 `tools: []`，不会自动暴露控制工具。
  原因：用户要求补齐 Browser Use / Computer Use 工具层，并参考 Hermes 的高层 browser/computer use 思路；Flyflor 需要保持外挂、相对路径、跨平台初始化、子进程执行、ASK/plan/yolo 不受影响。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts tests/gateway.ws.test.ts tests/install.script.test.ts --timeout 30000`; `bun test tests/runtime.mcp.tool.plan.test.ts tests/computer.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts tests/executive.tool.runtime.test.ts --timeout 30000`; `bun run check`; `git diff --check`。
  风险：本阶段只完成高层 `browser.use` descriptor/sidecar/installer 骨架和 CDP/delegate 可测路径；真实 Browser Use 云/本地 provider 安装与真实浏览器 high-privilege smoke 仍是后续项。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-docs-alignment
  摘要：新增 `docs/external/browser.use.md` 与 `docs/external/browser.use.zh.cn.md`，只做文档追加，不改写既有 active docs；文档明确 owner、执行契约、默认不暴露控制面、ASK/权限边界与验证入口。
  原因：合并工具层代码时需要同步文档口径，同时遵守“只做添加；若需修改先移动 old-docs 再重写”的约束。
  验证：待 push 前复跑 docs 与工具层门禁。
  风险：新文档放在 `docs/external/` 子目录，避免触发 active top-level docs index 改写；后续若要进入主阅读顺序，需要按 old-docs 规则重写索引。

- 状态：完成
  执行者：main-codex
  范围：browser-use-final-gates
  摘要：修正模型面 prompt 中新增 browser/computer facade 说明，避免使用内部大写缩写；复跑 focused、docs、typecheck、全量离线测试和 diff 空白检查。
  原因：全量测试发现 prompt lint 禁止模型面模板出现内部缩写，必须保持提示词分层对模型友好。
  验证：`bun test tests/prompt.lint.test.ts tests/prompt.templates.docs.test.ts --timeout 30000`; `bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts tests/gateway.ws.test.ts tests/install.script.test.ts --timeout 30000`; `bun test tests/runtime.mcp.tool.plan.test.ts tests/computer.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts tests/executive.tool.runtime.test.ts --timeout 30000`; `bun run docs:check`; `bun run check`; `bun run test`（1059 pass, 0 fail）; `git diff --check`。
  风险：真实 Browser Use provider/delegate 安装与真实浏览器高权限 smoke 仍保留为后续项，默认 manifest 继续不暴露 `browser.use` 控制面。

- 状态：完成
  执行者：main-codex
  范围：browser-use-live-closure
  摘要：使用 home DeepSeek provider 跑真实闭环 smoke，覆盖普通 turn、工具执行、预算/权限 ASK、拒绝恢复、结构化授权恢复、subagent batch、history 与 execution job 查询；默认工具面中 `browser.use` 保持 unavailable。
  原因：单元测试不足以证明闭环质量，push 前需要真实 LLM 场景确认 ASK/tool/subagent/history/brain.db 没有回归。
  验证：`bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`，结果 `ok: true`、`failedChecks: []`、`phantomPermissionUserEvents: 0`、`askAnswerPairs: 1`、`executionJobCount: 11`。
  风险：live smoke 依赖当前 home provider；docker provider 不作为本轮阻塞。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-capture-after
  摘要：`browser.use` 增加动作后捕获能力，支持 `captureAfter` 与 `captureMode`；CDP click/type 改为 `Runtime.evaluate` DOM IIFE，并在目标缺失时返回结构化 `failed`。
  原因：高层 browser-use 需要更接近 Hermes 式 capture/action/verify 循环，同时保持 sidecar 子进程边界和内核不 import 浏览器自动化 runtime。
  验证：已跑 `bun test tests/browser.use.sidecar.test.ts --timeout 30000`；待补全 focused/docs/check。
  风险：真实默认 manifest 仍为 `tools: []`，本改动不会把 `browser.use` 暴露给普通模型轮次。

- 状态：完成
  执行者：main-codex
  范围：browser-use-capture-after-verification
  摘要：完成 `browser.use` capture/action/verify 小闭环验证，覆盖 CDP action 后 snapshot、registry descriptor 输入 schema、socket catalog 与 computer/browser use focused tests。
  原因：确认本轮增强没有破坏 ASK/plan/yolo 可见性和血管层 catalog 边界。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts tests/gateway.ws.test.ts tests/runtime.mcp.tool.plan.test.ts tests/computer.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts --timeout 30000`（98 pass, 0 fail）；`bun run docs:check`; `bun run check`; `git diff --check`。
  风险：真实浏览器高权限 CDP 点击仍依赖用户显式启用 `browser.use` 或配置相应 manifest，默认工具面保持不暴露控制能力。

- 状态：进行中
  执行者：main-codex
  范围：browser-cdp-atomic-consistency
  摘要：原子 `browser.cdp` sidecar 与高层 `browser.use` 安全语义对齐：DOM click/type 改为 `Runtime.evaluate`，缺失目标结构化失败，open/navigate 拦截危险协议；新增 Browser CDP 外挂说明文档。
  原因：工具层需要保持原子工具与高层 facade 语义一致，避免高层路径已修复但原子路径仍脆弱。
  验证：已跑 `bun test tests/browser.cdp.sidecar.test.ts --timeout 30000`（7 pass, 0 fail）；待补全 focused/docs/check。
  风险：`browser.evaluate` 仍保留为显式代码执行工具，依赖 Executive approval/quota/audit 控制可见性。

- 状态：完成
  执行者：main-codex
  范围：browser-cdp-atomic-consistency-verification
  摘要：完成原子 Browser CDP 与高层 Browser Use 的一致性验证，覆盖危险协议拦截、DOM action failed 语义、sidecar registry、socket catalog 和工具可见性 gate。
  原因：确认原子 sidecar 修复没有破坏默认不可见控制面、ASK/plan/yolo 预算边界和血管层只读 catalog。
  验证：`bun test tests/browser.cdp.sidecar.test.ts tests/browser.use.sidecar.test.ts tests/external.tools.test.ts tests/gateway.ws.test.ts tests/runtime.mcp.tool.plan.test.ts --timeout 30000`（96 pass, 0 fail）；`bun run docs:check`; `bun run check`; `git diff --check`。
  风险：真实 CDP endpoint 仍由用户环境提供，sidecar 不安装浏览器 runtime；默认真实 manifest 仍只暴露 read-only/open Browser CDP probe。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-hermes-schema-parity
  摘要：`computer.use` 补齐 Hermes-style compact action schema：新增 `middle_click`，补充 capture/targeting/modifier/focus 字段，并把 CUA backend payload 归一化为 delegate 友好的 snake_case 字段；新增 Computer Use 外挂说明文档。
  原因：高层 computer-use 工具需要更接近参考实现的 capture/action/verify 和 SOM 元素工作流，同时保持内核不引入桌面 runtime。
  验证：已跑 `bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（24 pass, 0 fail）；待补全 focused/docs/check。
  风险：真实桌面控制仍依赖显式 delegate/CUA backend 配置，默认 manifest 不暴露 `computer.use`。

- 状态：完成
  执行者：main-codex
  范围：computer-use-hermes-schema-parity-verification
  摘要：完成 Computer Use Hermes-style schema parity 验证，覆盖 `middle_click`、capture mode/max elements、modifiers、CUA payload snake_case 归一化、browser/computer focused tests、socket catalog 与工具可见性 gate。
  原因：确认高层 computer-use schema 扩展仍保持子进程外挂、默认不暴露控制面，并且不影响 ASK/plan/yolo 预算边界。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/browser.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts tests/external.tools.test.ts tests/gateway.ws.test.ts tests/runtime.mcp.tool.plan.test.ts --timeout 30000`（103 pass, 0 fail）；`bun run docs:check`; `bun run check`; `git diff --check`。
  风险：真实 CUA/desktop delegate 仍由用户显式安装配置；本轮只补 schema/payload/validation，不把 `computer.use` 加入默认真实工具面。

- 状态：完成
  执行者：main-codex
  范围：browser-computer-use-opt-in-runtime-closure
  摘要：新增 `tests/external.use.runtime.test.ts`，用显式 external manifest 启用 `browser.use` / `computer.use`，验证 `loadExternalTools`、Tool Plan、本地 computer-capable surface、`RuntimeMcpToolExecutor`、process-json sidecar 和 delegate response 全链路连通；新增 `docs/external/use.runtime.closure.md` 与中文镜像。
  原因：此前只证明默认不暴露和 sidecar 直跑，缺少“显式启用后内核执行器真的能跑 sidecar”的闭环证据。
  验证：`bun test tests/external.use.runtime.test.ts --timeout 30000`; focused 工具层套件；`bun run docs:check`; `bun run check`; `bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`; `bun run test`。
  风险：测试使用 `scripts/mock.sidecar.ts` 作为确定性 delegate，不执行真实浏览器/桌面控制；真实高权限 delegate 仍需用户显式安装与授权。

- 状态：完成
  执行者：main-codex
  范围：plugin-runner-path-env
  摘要：`src/agent/plugin/runner.ts` 在默认 spawn 时补充最小命令查找环境：PATH；Windows 下补充 Path、PATHEXT、SystemRoot、WINDIR。
  原因：external descriptor 稳定性检查允许 PATH 命令，但 process-json 执行阶段给子进程传空 env，导致 `bun` 这类 PATH 命令在真实执行时失败。
  验证：`bun test tests/external.use.runtime.test.ts --timeout 30000`; focused 工具层套件；`bun run docs:check`; `bun run check`; `bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`; `bun run test`。
  风险：该修复不继承全量环境变量，只补命令查找所需最小环境，避免把密钥扩散到 sidecar。

- 状态：完成
  执行者：main-codex
  范围：computer-use-install-alignment
  摘要：默认真实 external registry 与 `tools/init.*` 现在登记 `computer.use` sidecar，使用 `./tools/packages/computer-use/bin/flyflor`、`xtool-sidecar computer.use`、delegate/CUA 空配置和 `tools: []`；新增安装对齐文档。
  原因：`computer-use` package 已经被创建，但 manifest 缺少 sidecar 条目，和 `browser.use` 的“已安装、可诊断、默认不暴露”策略不一致。
  验证：`bun test tests/install.script.test.ts tests/external.tools.test.ts tests/external.use.runtime.test.ts tests/gateway.ws.test.ts --timeout 30000`（100 pass, 0 fail）；`bun run docs:check`; `bun run check`; `bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`; `bun run test`。
  风险：该改动只登记 sidecar 配置，不把 `computer.use` 放入 sidecar `tools`，因此默认模型工具面仍不可调用桌面控制。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-live-smoke
  摘要：新增 `scripts/browser.use.live.smoke.ts`，用真实 Chrome/Chromium 临时 profile 和本地 HTML 页面验证 `browser.use` CDP 后端 open/navigate/type/click/captureAfter/evaluate/screenshot；新增 `smoke:browser-use:live` package 入口与中英文说明文档。
  原因：mock CDP 和 opt-in runtime 测试不足以证明真实浏览器 action/read 小闭环，需补齐不共享用户 profile、不写真实 memory、不把高风险工具默认暴露的 live 证据。
  验证：待跑 `bun run smoke:browser-use:live`、focused 工具层测试、`bun run docs:check`、`bun run check`、真实闭环 smoke、全量测试与 `git diff --check`。
  风险：该 smoke 依赖本机 Chrome/Chromium；默认无浏览器时结构化 skip，`--require-browser` 才作为硬失败。

- 状态：完成
  执行者：main-codex
  范围：browser-use-live-smoke-verification
  摘要：完成真实 Chrome CDP browser-use smoke 与全量回归；`browser.use` 真实动作链已覆盖 open/navigate/wait/type/click/captureAfter/evaluate/screenshot，默认模型工具面仍不暴露 `browser.use`。
  原因：把 Browser Use 从 mock CDP / deterministic delegate 推进到本机真实浏览器闭环，同时不破坏 ASK、plan、yolo、动态预算和外部工具默认安全面。
  验证：`bun run smoke:browser-use:live`（macos-google-chrome，checks 全部通过）；focused 工具层测试（113 pass, 0 fail）；`bun run docs:check`; `bun run check`; `bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1066 pass, 0 fail）；`git diff --check`。
  风险：真实 browser-use smoke 依赖本机 Chrome/Chromium；无浏览器时默认结构化 skip，CI 若要求真实浏览器需加 `--require-browser`。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-live-smoke
  摘要：新增 `scripts/computer.use.live.smoke.ts`，通过可选 `cua-driver` 真实验证 `computer.use` CUA backend 的只读 capture/list_apps/wait；新增 `smoke:computer-use:live` package 入口与中英文说明文档。
  原因：`computer.use` 已有 sidecar、install alignment 和 opt-in runtime delegate 证明，但缺少真实 CUA backend 的本机闭环入口；本轮只验证只读路径，避免默认打开鼠标/键盘控制面。
  验证：待跑 `bun run smoke:computer-use:live`、focused 工具层测试、`bun run docs:check`、`bun run check`、真实闭环 smoke、全量测试与 `git diff --check`。
  风险：该 smoke 依赖 macOS `cua-driver`；默认无 driver 时结构化 skip，`--require-cua` 才作为硬失败。

- 状态：完成
  执行者：main-codex
  范围：computer-use-live-smoke-verification
  摘要：完成 `computer.use` 可选真实 CUA smoke 与全量回归；同时修复 `scripts/live.loop.closure.ts` 的等待器，让同一 requestId 的 `turn.error` 成为明确终态，避免真实模型/解析异常时 smoke 黑盒卡住。
  原因：工具闭环需要在缺少本机 CUA driver 时结构化 skip，在真实 turn 出错时明确失败，不允许测试器把 socket 错误吞成等待。
  验证：`bun run smoke:computer-use:live`（ok true, skipped true, reason cua-command-not-found）；focused 工具层测试（129 pass, 0 fail）；`bun run docs:check`; `bun run check`; `bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1066 pass, 0 fail）；`git diff --check`。
  风险：本机没有 `cua-driver`，因此真实 CUA 动作链本轮以结构化 skip 验证缺驱动路径；有 driver 的机器可用 `--require-cua` 把缺驱动转为硬失败。

- 状态：进行中
  执行者：main-codex
  范围：use-tool-prompt-boundary
  摘要：收紧 `browser.use` / `computer.use` descriptor 文案，明确 opt-in 高权限、观察优先、不能替代 workspace/git/process/file 工具；新增提示词边界中英文文档与 descriptor 回归测试。
  原因：高层 use 工具显式 opt-in 后会进入模型工具目录，工具 descriptor 本身必须携带执行层红线，避免模型把浏览器/桌面控制误用成 coding 工具。
  验证：待跑 focused descriptor/tool plan tests、`bun run docs:check`、`bun run check`、真实闭环 smoke、全量测试与 `git diff --check`。
  风险：只修改 descriptor 文案和测试，不改变 manifest 默认 `tools: []`、Tool Plan visibility、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：use-tool-prompt-boundary-verification
  摘要：完成高层 use 工具提示词边界回归；`browser.use` / `computer.use` descriptor 现在明确 opt-in 高权限、观察优先、不能替代 workspace/git/process/file 工具，并有中英文文档记录。
  原因：即使本地 manifest 显式开启高层工具，模型看到的工具目录也必须携带执行层红线，避免破坏 coding 工具、ASK、plan、yolo 和动态额度边界。
  验证：`bun test tests/external.tools.test.ts tests/runtime.mcp.tool.plan.test.ts tests/external.use.runtime.test.ts tests/gateway.ws.test.ts --timeout 30000`（84 pass, 0 fail）；`bun run docs:check`; `bun run check`; `bun run provider:ready -- --require-ready`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1066 pass, 0 fail）；`git diff --check`。
  风险：只改 descriptor 文案、文档和测试；默认 manifest 仍保持 `browser.use` / `computer.use` 的 `tools: []` 安全边界。

- 状态：进行中
  执行者：main-codex
  范围：use-tool-path-portability
  摘要：`browser.use` / `computer.use` sidecar delegate command lookup 增加 PATHEXT 风格后缀候选，PATH 或相对 command 可解析到 `.cmd` / `.exe` / `.bat` / `.com` 等平台入口；新增中英文路径可移植性文档。
  原因：工具层要求外挂 sidecar、相对路径和全平台兼容，Windows 风格 delegate 不能依赖 manifest 硬编码平台后缀。
  验证：已跑 `bun test tests/browser.use.sidecar.test.ts tests/computer.use.sidecar.test.ts --timeout 30000`（15 pass, 0 fail）；`bun run check`；待跑 docs/真实闭环/full test。
  风险：只扩展 sidecar 内部 command lookup，不改变默认 manifest 暴露面、Tool Plan visibility、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：use-tool-path-portability-verification
  摘要：完成 `browser.use` / `computer.use` delegate command PATH/PATHEXT 可移植性闭环；无扩展名 delegate command 可在 PATH 中解析到 `.cmd` 入口，文档保持新增文件形式。
  原因：外挂 sidecar 需要支持跨平台 delegate 入口，同时不把平台后缀写死进 manifest 或 prompt 边界。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/computer.use.sidecar.test.ts --timeout 30000`（15 pass, 0 fail）；`bun run check`; `bun run docs:check`; `bun run provider:ready -- --require-ready`; `bun run test`（1068 pass, 0 fail）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只扩展 sidecar 内部 command lookup 和 focused tests；不改变默认 manifest 暴露面、Tool Plan visibility、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：use-tool-path-portability-final-diff-check
  摘要：提交前完成最终 whitespace diff gate。
  原因：确保追加 TODO/LOGS 后仍无空白错误。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-cdp-malformed-frame
  摘要：`browser.use` CDP WebSocket response reader 增加非 JSON 帧结构化失败路径，并补回归测试锁住“不能靠超时暴露协议错误”。
  原因：高层 browser-use 工具必须把外部协议异常转为明确 process-json failure，避免 TUI/socket/job detail 看到黑盒卡住或无意义 timeout。
  验证：已跑 `bun test tests/browser.use.sidecar.test.ts --timeout 30000`（8 pass, 0 fail）；待跑 check/docs/真实闭环/diff。
  风险：只修改 `browser.use` CDP response parsing 和 focused mock test，不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：browser-use-cdp-malformed-frame-verification
  摘要：完成 `browser.use` CDP 非 JSON response frame 的结构化失败闭环；mock CDP 不再等待 timeout，真实 Chrome CDP smoke 仍保持 open/navigate/type/click/captureAfter/evaluate/screenshot 全通过。
  原因：外部浏览器协议异常必须快速进入 process-json failure，保持 socket/event/job detail 可观察，不破坏真实浏览器可用路径。
  验证：`bun test tests/browser.use.sidecar.test.ts --timeout 30000`（8 pass, 0 fail）；`bun run smoke:browser-use:live`（ok true, macos-google-chrome）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只修改 `browser.use` CDP response reader 与 focused mock test；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：browser-use-cdp-malformed-frame-final-diff-check
  摘要：提交前完成最终 whitespace diff gate。
  原因：确保追加 TODO/LOGS 后仍无空白错误。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：browser-cdp-malformed-frame
  摘要：原子 `browser.cdp` sidecar 的 CDP WebSocket response reader 增加非 JSON 帧快速失败路径，并补回归测试锁住“原子浏览器工具不能靠 timeout 暴露协议错误”。
  原因：`browser.cdp` 是 `browser.use` 的底层原子能力，同样需要把外部协议异常转为明确 process-json failure，保持工具层血管可观察。
  验证：已跑 `bun test tests/browser.cdp.sidecar.test.ts --timeout 30000`（8 pass, 0 fail）；待跑 browser-use focused、browser live、check/docs/真实闭环/diff。
  风险：只修改原子 `browser.cdp` CDP response parsing 和 focused mock test，不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：browser-cdp-malformed-frame-verification
  摘要：完成原子 `browser.cdp` CDP 非 JSON response frame 的结构化失败闭环；mock CDP 不再等待 timeout，高层 `browser.use` focused tests 与真实 Chrome browser-use smoke 仍通过。
  原因：原子 browser sidecar 是高层 browser-use 的底座，必须同样把外部协议异常快速转成 process-json failure，保持工具层事件/审计链路可解释。
  验证：`bun test tests/browser.cdp.sidecar.test.ts tests/browser.use.sidecar.test.ts --timeout 30000`（16 pass, 0 fail）；`bun run smoke:browser-use:live`（ok true, macos-google-chrome）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只修改原子 `browser.cdp` CDP response reader 与 focused mock test；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：browser-cdp-malformed-frame-final-diff-check
  摘要：提交前完成最终 whitespace diff gate。
  原因：确保追加 TODO/LOGS 后仍无空白错误。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-readonly-capture-after
  摘要：`computer.use` 修正 `captureAfter` gate：`capture`、`wait`、`list_apps` 等只读动作不再额外触发后置 capture；新增 delegate 回归确认只读 wait 只产生一次子进程调用。
  原因：后置 capture 是 action/verify 语义，应服务变更动作；只读动作追加 capture 会制造无意义子进程与预算消耗，和 READ_ACTIONS 标记不一致。
  验证：已跑 `bun test tests/computer.use.sidecar.test.ts --timeout 30000`（9 pass, 0 fail）；待跑 browser focused、computer live、check/docs/真实闭环/diff。
  风险：只改变 `computer.use` 高层 sidecar 的 read-only `captureAfter` 行为，不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：computer-use-readonly-capture-after-verification
  摘要：完成 `computer.use` 只读动作 captureAfter 语义收口；`wait` 带 `captureAfter: true` 不再额外触发 capture 子进程，变更动作后置观察保持不变。
  原因：只读动作不应制造额外子进程、预算消耗或误导性的 action/verify 语义；这与 READ_ACTIONS、提示词边界和 Hermes-style capture/action/verify 分层一致。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/browser.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts --timeout 30000`（25 pass, 0 fail）；`bun run smoke:computer-use:live`（ok true, skipped true, reason cua-command-not-found）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只修改 `computer.use` read-only captureAfter gate 与 focused test；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：computer-use-readonly-capture-after-final-diff-check
  摘要：提交前完成最终 whitespace diff gate。
  原因：确保追加 TODO/LOGS 后仍无空白错误。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-scroll-direction-schema
  摘要：`computer.use` scroll direction 从自由字符串收紧为 `up/down/left/right` enum；descriptor 与 sidecar 校验同步，invalid direction 在 delegate spawn 前返回结构化失败。
  原因：Hermes computer-use schema 将 scroll direction 定义为枚举；Flyflor 模型可见 schema 和 sidecar runtime 必须一致，避免模型发出不可执行方向后才由 delegate 暴露错误。
  验证：已跑 `bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（27 pass, 0 fail）；待跑 computer live、check/docs/真实闭环/diff。
  风险：只收紧 `computer.use` scroll direction schema/validation；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：computer-use-scroll-direction-schema-verification
  摘要：完成 `computer.use` scroll direction schema/runtime parity；模型可见 descriptor 与 sidecar 校验都只接受 `up/down/left/right`，非法方向在 delegate spawn 前结构化失败。
  原因：保持提示词工具 schema 和 process-json runtime 同步，减少模型不可执行动作进入外部 delegate 的概率。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（27 pass, 0 fail）；`bun run smoke:computer-use:live`（ok true, skipped true, reason cua-command-not-found）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只收紧 `computer.use` scroll direction schema/validation；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：computer-use-scroll-direction-schema-final-diff-check
  摘要：提交前完成最终 whitespace diff gate。
  原因：确保追加 TODO/LOGS 后仍无空白错误。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-scroll-amount-schema
  摘要：`computer.use` scroll amount 从自由 number 收紧为 `1..1000` integer；descriptor 与 sidecar 校验同步，非法 amount 在 delegate spawn 前返回结构化失败。
  原因：Hermes computer-use schema 将 scroll amount 定义为整数滚动刻度；Flyflor 模型可见 schema 和 sidecar runtime 必须一致，避免小数或越界值进入外部 delegate。
  验证：已跑 `bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（28 pass, 0 fail）；待跑 computer live、check/docs/真实闭环/diff。
  风险：只收紧 `computer.use` scroll amount schema/validation；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：进行中
  执行者：main-codex
  范围：tool-call-strict-json-prompt-boundary
  摘要：真实 `smoke:live:closure` 在 `live-budget-resume` 阶段暴露模型输出非严格 `<agent_tool_calls>` JSON，导致 runtime 按协议硬失败；已收紧 `mcp.context` 中英文模板，要求 tool call block 内严格 JSON、禁止注释/尾随逗号/Python/JavaScript 对象语法/代码围栏，并优先使用 `input` object。
  原因：ASK citizen permission resume 后仍要保持工具调用协议稳定，不能让真实模型把恢复执行链路变成 parse error 黑盒。
  验证：已见失败 `bun run smoke:live:closure`（`live-budget-resume` JSON Parse error）；待跑 prompt lint、docs/check、真实闭环与全量门禁。
  风险：只修改模型可见工具协议提示词和对应 prompt lint；不放松 runtime 对坏协议块的拒绝策略，不改变 ASK/plan/yolo/dynamic budget 代码路径。

- 状态：完成
  执行者：main-codex
  范围：computer-use-scroll-amount-schema-verification
  摘要：完成 `computer.use` scroll amount schema/runtime parity；模型可见 descriptor 与 sidecar 校验都只接受 `1..1000` integer，非法小数在 delegate spawn 前结构化失败。
  原因：保持 Hermes-style computer-use schema、提示词工具 schema 和 process-json runtime 同步，减少模型不可执行动作进入外部 delegate 的概率。
  验证：`bun test tests/prompt.lint.test.ts tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（40 pass, 0 fail）；`bun run smoke:computer-use:live`（ok true, skipped true, reason cua-command-not-found）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1073 pass, 0 fail）；`cargo fmt --check && cargo check && cargo test` in `flyflor-cli`（183 pass, 0 fail）；待最终 `git diff --check`。
  风险：只收紧 `computer.use` scroll amount schema/validation；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：tool-call-strict-json-prompt-boundary-verification
  摘要：完成工具调用 strict JSON 提示词边界修复；真实 ASK citizen permission resume 从原先 JSON Parse error 改为继续执行并完成工具循环。
  原因：真实 LLM 闭环必须能跨过 ASK permission resume，且坏协议块仍由 runtime 硬失败暴露，不能改成静默吞错。
  验证：`bun run smoke:live:closure`（ok true, failedChecks [], finalKinds.resumed reply, phantomPermissionUserEvents 0, toolExecutionKeys includes workspace.read/workspace.write/subagent.batch）；`bun run docs:check`; `bun run test`; TUI `cargo fmt --check && cargo check && cargo test`。
  风险：仅修改 `templates/prompts/mcp.context*.md` 与 prompt lint 断言；不修改工具解析器拒绝坏 JSON 的协议约束。

- 状态：完成
  执行者：main-codex
  范围：computer-use-scroll-amount-and-tool-json-final-diff-check
  摘要：提交前完成最终 whitespace diff gate。
  原因：确保追加 TODO/LOGS 后仍无空白错误。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-target-integer-schema
  摘要：准备对齐 Hermes computer-use target schema：模型可见 descriptor 与 sidecar runtime 都应把 element、drag target、coordinate items 作为整数目标处理。
  原因：桌面控制目标小数没有可执行语义；若 descriptor 暴露为 number 或 sidecar 透传小数，会把工具闭环错误推迟到外部 delegate，降低 ASK/tool loop 可观察性。
  验证：待跑 focused computer-use/external descriptor tests、computer live、check/docs、真实闭环与 diff。
  风险：只收紧 `computer.use` target 字段 schema/validation；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：computer-use-target-integer-schema-verification
  摘要：完成 `computer.use` target schema/runtime parity；descriptor 将 `element/fromElement/toElement/maxElements` 和坐标数组 items 暴露为 integer，sidecar 在 delegate spawn 前拒绝小数 element 与小数 coordinate item。
  原因：对齐 Hermes computer-use 的目标字段语义，把不可执行桌面目标提前转成结构化工具失败，保持外部工具血管可观察。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（30 pass, 0 fail）；`bun run smoke:computer-use:live`（ok true, skipped true, reason cua-command-not-found）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1075 pass, 0 fail）；待最终 `git diff --check`。
  风险：只收紧 `computer.use` target 字段 schema/validation 并新增追加文档；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：computer-use-target-integer-schema-final-diff-check
  摘要：提交前完成最终 whitespace diff gate；未跟踪 `.github/` 与 `.workmux.yaml` 不属于本轮工具层改动，未纳入提交。
  原因：确保追加 TODO/LOGS 后仍无空白错误，并避免混入无 owner 的运行态/工作流文件。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：browser-always-blocked-url-floor
  摘要：准备为 `browser.use` 与原子 `browser.cdp` 增加 Hermes-style always-blocked URL 地板，拦截云 metadata/link-local 凭据端点。
  原因：当前 browser sidecar 只挡危险协议；metadata/link-local 端点没有合法 agent 用途，应在子进程 sidecar 层进入结构化失败，避免外部浏览器工具访问凭据面。
  验证：待跑 focused browser-use/browser-cdp tests、browser live、check/docs、真实闭环与 diff。
  风险：只阻断 metadata/link-local 安全地板，不扩大到 localhost/file/private 全量阻断，不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：browser-always-blocked-url-floor-verification
  摘要：完成 `browser.use` 与原子 `browser.cdp` 的 always-blocked URL 地板；metadata/link-local 凭据端点在 sidecar URL 校验层阻断并返回结构化失败。
  原因：对齐 Hermes 不可协商 URL 安全地板，同时保留 localhost、本地文件与普通私网 URL 给显式高权限本地 browser 工作流使用。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts --timeout 30000`（18 pass, 0 fail）；`bun run smoke:browser-use:live`; `bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks []）；`bun run test`（1077 pass, 0 fail）；待最终 `git diff --check`。
  风险：只收紧 `browser.use` 与 `browser.cdp` 的 metadata/link-local URL floor；不改变默认 manifest 暴露面、ASK、plan、yolo 或动态预算逻辑。

- 状态：完成
  执行者：main-codex
  范围：browser-always-blocked-url-floor-final-diff-check
  摘要：提交前完成最终 whitespace diff gate；未跟踪 `.github/` 与 `.workmux.yaml` 不属于本轮工具层改动，未纳入提交。
  原因：确保追加 TODO/LOGS 与新增文档后仍无空白错误，并避免混入无 owner 的工作流/运行态文件。
  验证：`git diff --check`。
  风险：无代码风险，仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：browser-url-dns-safety-floor
  摘要：准备补齐 Hermes-style URL safety 的 DNS 解析地板：hostname 解析到 metadata/link-local 凭据地址时也应在 sidecar 层阻断。
  原因：上一轮 browser URL floor 只覆盖字面 hostname/IP；Hermes `is_always_blocked_url` 还会检查解析结果，防止普通 hostname 指向 metadata 凭据面。
  验证：已跑 focused `bun test tests/browser.url.safety.test.ts tests/browser.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts --timeout 30000`（21 pass, 0 fail）；待跑 check/docs、真实闭环与 diff。
  风险：只移动 browser sidecar URL 安全地板到 `scripts/browser.url.safety.ts` 并补 DNS 检查；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel 依赖边界。

- 状态：完成
  执行者：main-codex
  范围：browser-url-dns-safety-floor-verification
  摘要：完成 browser URL DNS safety floor；`browser.use` 与原子 `browser.cdp` 现在共享 `BrowserUrlSafetyPolicy`，普通 hostname 解析到 metadata/link-local 凭据地址时会在 backend/delegate 前阻断。
  原因：对齐 Hermes `is_always_blocked_url` 的解析结果检查，同时让 browser sidecar owner 持有 URL 安全地板，kernel 不引入 browser/desktop runtime。
  验证：`bun test tests/browser.url.safety.test.ts tests/browser.use.sidecar.test.ts tests/browser.cdp.sidecar.test.ts --timeout 30000`（21 pass, 0 fail）；`bun run check`; `bun run docs:check`; `bun run smoke:browser-use:live`（ok true）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待全量测试与最终 `git diff --check`。
  风险：只影响 browser sidecar URL preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel 依赖边界。

- 状态：完成
  执行者：main-codex
  范围：browser-url-dns-safety-floor-final-gates
  摘要：提交前完成全量测试与 whitespace diff gate。
  原因：确认新增 `browser.url.safety` helper、sidecar async URL preflight、文档与控制文件追加没有破坏现有工具闭环。
  验证：`bun run test`（1080 pass, 0 fail）；`git diff --check`。
  风险：无新增运行态风险；未跟踪 `.github/` 与 `.workmux.yaml` 仍不属于本轮改动，未纳入提交。

- 状态：完成
  执行者：main-codex
  范围：browser-url-dns-safety-doc-archive
  摘要：将 DNS 扩展前的 browser URL safety 文档快照追加归档到 `old-docs/external/`，active 文档保留重写后的 DNS safety 说明。
  原因：遵守“文档只追加；需要修改则先移动/归档到 old-docs 再重写”的约定。
  验证：待复跑 docs/check 与最终 `git diff --check`。
  风险：仅文档归档，无运行态风险。

- 状态：完成
  执行者：main-codex
  范围：browser-url-dns-safety-doc-archive-verification
  摘要：完成文档归档后的文档门禁与 whitespace diff gate。
  原因：确认 `old-docs/external/` 归档不会破坏文档索引/引用约束。
  验证：`bun run docs:check`（26 pass, 0 fail）；`git diff --check`。
  风险：仅验证记录追加。

- 状态：进行中
  执行者：main-codex
  范围：use-sidecar-resource-bounds
  摘要：准备为 `browser.use` 与 `computer.use` 的 delegate/CUA config 增加 `timeoutMs` 与 `maxOutputBytes` 硬上限。
  原因：当前 sidecar 虽有 timeout/output 截断，但只要配置是正整数就接受；错误 manifest 可静默拉长子进程执行窗口或扩大输出缓存，和动态额限边界不够贴合。
  验证：待跑 focused browser-use/computer-use tests、check/docs、真实闭环与 diff。
  风险：只影响 sidecar config preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel 依赖边界。

- 状态：完成
  执行者：main-codex
  范围：use-sidecar-resource-bounds-verification
  摘要：完成 `browser.use` 与 `computer.use` delegate/CUA 资源硬上限；`timeoutMs` 限制为 `1..120000`，`maxOutputBytes` 限制为 `1..2097152`，非法配置在 command resolution / delegate spawn 前结构化失败。
  原因：防止外部 sidecar manifest 静默扩大单次子进程执行窗口或输出缓存，保持工具层预算边界与内核动态额限解耦。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/computer.use.sidecar.test.ts --timeout 30000`（26 pass, 0 fail）；`bun run check`; `bun run docs:check`; `bun run smoke:browser-use:live`（ok true）；`bun run smoke:computer-use:live`（ok true, skipped cua-command-not-found）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待全量测试与最终 `git diff --check`。
  风险：只影响 sidecar config preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel 依赖边界。

- 状态：完成
  执行者：main-codex
  范围：use-sidecar-resource-bounds-final-gates
  摘要：提交前完成全量测试与 whitespace diff gate。
  原因：确认新增资源边界、focused 回归和追加文档没有破坏现有工具闭环。
  验证：`bun run test`（1084 pass, 0 fail）；`git diff --check`。
  风险：无新增运行态风险；未跟踪 `.github/` 与 `.workmux.yaml` 仍不属于本轮改动，未纳入提交。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-install-and-smoke-docs
  摘要：补齐 `browser.use` 安装、CDP backend、delegate backend、真实 browser smoke 与默认 `tools: []` opt-in 边界文档，并收束历史 Browser Use TODO。
  原因：代码层已有真实 `smoke:browser-use:live`，但历史 TODO 仍要求 provider/delegate 安装说明与默认不暴露控制动作的文档闭环。
  验证：待跑 docs/check、browser live smoke 与 diff。
  风险：仅新增文档与 TODO 状态更新；不改变运行态代码、ASK、plan、yolo、动态预算或默认工具暴露。

- 状态：完成
  执行者：main-codex
  范围：browser-use-install-and-smoke-docs-verification
  摘要：完成 `browser.use` 安装与 opt-in 文档闭环；新增中英文文档覆盖 `install:xtools:browser-use`、CDP backend、delegate backend、真实 browser smoke、默认 `tools: []` 与 kernel 不 import browser runtime 的边界。
  原因：收束历史 TODO 中 Browser Use provider/delegate 安装说明和真实高权限 smoke 要求。
  验证：`bun run docs:check`（26 pass, 0 fail）；`bun run smoke:browser-use:live`（ok true）；`git diff --check`。
  风险：仅新增文档与 TODO 状态更新；不改变运行态代码、ASK、plan、yolo、动态预算或默认工具暴露。

- 状态：进行中
  执行者：main-codex
  范围：external-manifest-resource-bounds
  摘要：准备把 sidecar `timeoutMs` / `maxOutputBytes` 硬上限前移到 `external.tools.jsonc` normalization 层。
  原因：上一轮已让 `browser.use` / `computer.use` sidecar 执行期拒绝超大资源配置；但 manifest loader 仍只校验正整数，坏配置可能先进入模型可见 catalog。
  验证：待跑 focused external-tools tests、check/docs、真实闭环与 diff。
  风险：只影响 external manifest preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：external-manifest-resource-bounds-verification
  摘要：完成 `external.tools.jsonc` normalization 层资源上限；`timeoutMs` 与 `maxOutputBytes` 超过 sidecar runner 边界时，manifest 在 catalog/executor 暴露前失败。
  原因：防止坏 external sidecar manifest 先进入模型可见 catalog，再在执行期才暴露资源配置错误。
  验证：`bun test tests/external.tools.test.ts --timeout 30000`（19 pass, 0 fail）；`bun run check`; `bun run docs:check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待全量测试与最终 `git diff --check`。
  风险：只影响 external manifest preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel import 边界。

- 状态：进行中
  执行者：main-codex
  范围：external-stability-pathext-portability
  摘要：准备让 external manifest stability preflight 也支持 PATHEXT executable suffix，和 `browser.use` / `computer.use` sidecar delegate resolution 对齐。
  原因：执行期已支持 `.cmd` / `.exe` 等跨平台入口，但 catalog/stability 层仍只检查原始 command；Windows package entry 可能被误判 unavailable，导致外挂工具在模型可见前被隐藏。
  验证：待跑 focused external-tools tests、docs/check、真实闭环与 diff。
  风险：只影响 external sidecar availability preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel import browser/desktop runtime 边界。

- 状态：完成
  执行者：main-codex
  范围：external-stability-pathext-portability-verification
  摘要：完成 external manifest stability preflight 的 PATHEXT executable suffix 支持；app-relative 与 PATH command 均可解析到 `.cmd` 等平台入口后再决定 catalog 可见性。
  原因：让模型可见前的 availability 判断与 sidecar 执行期 command resolution 对齐，避免 Windows package entry 被误判 unavailable。
  验证：`bun test tests/external.tools.test.ts --timeout 30000`（21 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只影响 external sidecar availability preflight；不改变 ASK、plan、yolo、动态预算、默认工具暴露或 kernel import browser/desktop runtime 边界。

- 状态：完成
  执行者：main-codex
  范围：external-stability-pathext-portability-final-gates
  摘要：完成全量测试 gate，确认 PATHEXT stability preflight 与文档归档不会破坏现有内核、ASK、TUI read-model 和工具闭环。
  原因：本切片影响模型可见 catalog 前的 external sidecar availability 判断，需要覆盖全量工具/ASK/socket 回归。
  验证：`bun run test`（1088 pass, 0 fail）；待最终 `git diff --check`。
  风险：无新增运行态风险；未跟踪 `.github/` 与 `.workmux.yaml` 仍不属于本轮改动，未纳入提交。

- 状态：进行中
  执行者：main-codex
  范围：user-tool-project-cwd-boundary
  摘要：准备区分 user manifest process-json tools 与 external sidecars 的 `cwd: "project"` anchor。
  原因：`.flyflor/tools.jsonc` 是 workspace-local user tool surface，`cwd: "project"` 应从真实 `paths.projectDir` 启动；external sidecar 的兼容别名仍需保持 app-root 语义，避免破坏已封板的 `external.tools.jsonc` 协议。
  验证：待跑 focused user-tool cwd tests、check/docs、真实闭环与 diff。
  风险：只影响 user manifest tool 的 project cwd 解析；external sidecar 通过 stability snapshot 继续走兼容 anchor；不改变 ASK、plan、yolo、动态预算或子进程 JSON 协议。

- 状态：完成
  执行者：main-codex
  范围：user-tool-project-cwd-boundary-verification
  摘要：完成 user manifest process-json tool 与 external sidecar 的 `cwd: "project"` anchor 分离；user tools 从 `paths.projectDir` 启动，external sidecar 仍按 stability snapshot 兼容 app-root anchor。
  原因：修复 `.flyflor/tools.jsonc` 项目工具在真实 appRoot != projectDir 环境下可能从 app/home 启动的问题，同时不改变已封板 external sidecar package entry 语义。
  验证：`bun test tests/runtime.user.tool.cwd.test.ts --timeout 30000`（2 pass, 0 fail）；`bun test tests/skill.mcp.test.ts tests/external.use.runtime.test.ts --timeout 30000`（73 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`; `bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待全量测试与最终 `git diff --check`。
  风险：只影响 user manifest tool project cwd 解析；不改变 ASK、plan、yolo、动态预算、external sidecar protocol 或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：user-tool-project-cwd-boundary-final-gates
  摘要：完成全量测试 gate，确认 user tool project cwd 分离没有破坏 ASK、plan、yolo、external sidecar、TUI read-model 或工具执行闭环。
  原因：本切片调整 process-json 子进程工作目录，需要覆盖 runtime、sandbox、ASK 和 external use 相关回归。
  验证：`bun run test`（1090 pass, 0 fail）；待最终 `git diff --check`。
  风险：无新增运行态风险；未跟踪 `.github/` 与 `.workmux.yaml` 仍不属于本轮改动，未纳入提交。

- 状态：进行中
  执行者：main-codex
  范围：user-tool-resource-bounds
  摘要：准备在 `.flyflor/tools.jsonc` user manifest normalization 层限制 process-json executor `timeoutMs` 与 `maxOutputBytes`。
  原因：external sidecar manifest 已经有资源上限，但 user manifest executor 仍只校验正整数；坏配置可能静默扩大单次子进程执行窗口或输出缓存，削弱动态额限和工具预算边界。
  验证：待跑 focused executive manifest tests、check/docs、真实闭环与 diff。
  风险：只影响 user manifest preflight；不改变 ASK、plan、yolo、动态预算、external sidecar protocol 或 kernel import 边界。

- 状态：进行中
  执行者：main-codex
  范围：tool-call-parse-failure-closure
  摘要：准备把 malformed `<agent_tool_calls>` 严格 JSON 失败从 turn crash 改为结构化 `protocol/agent_tool_calls.parse` tool failure，并由 Executive ASK 暂停。
  原因：真实 DeepSeek `smoke:live:closure` 在 budget resume 场景输出 malformed tool-call block，当前 parse exception 直接冒泡成 `turn.error`，TUI/history/brain 看不到工具失败细节。
  验证：待跑 focused MCP runtime test、check/docs、真实闭环与 diff。
  风险：只处理完整协议块内 JSON parse/shape 失败；不猜测工具意图，不新增执行权限，不改变 ASK/plan/yolo 授权面。

- 状态：完成
  执行者：main-codex
  范围：user-tool-resource-bounds
  摘要：`.flyflor/tools.jsonc` process-json executor 现在拒绝超过 `120000`ms timeout 与 `2097152` bytes output cap 的 user manifest 配置，并补充中英文追加文档。
  原因：user manifest 与 external sidecar 共享子进程资源边界，避免本地工具配置静默扩大单次执行窗口。
  验证：`bun test tests/executive.manifest.test.ts tests/runtime.user.tool.cwd.test.ts --timeout 30000`；`bun run docs:check`；`bun run check`；`bun run smoke:live:closure`；`bun run test`（1091 pass, 0 fail）；`git diff --check`。
  风险：只影响 manifest preflight；默认值不变，ASK、plan、yolo、动态预算和 external sidecar protocol 不变。

- 状态：完成
  执行者：main-codex
  范围：tool-call-parse-failure-closure
  摘要：Executive loop 增加 parse failure 暂停出口；MCP runtime 将 malformed `<agent_tool_calls>` JSON/shape/string arguments 归档为 `protocol/agent_tool_calls.parse` 失败执行并触发结构化 Executive ASK。
  原因：真实 LLM 闭环必须把 malformed tool-call block 暴露给 socket/TUI/history/brain，而不是变成黑盒 `turn.error`。
  验证：`bun test tests/skill.mcp.test.ts --timeout 30000 -t "unrecognized tool call shapes|malformed string arguments|malformed MCP tool-call JSON"`；`bun run docs:check`；`bun run check`；`bun run smoke:live:closure`；`bun run test`（1091 pass, 0 fail）；`git diff --check`。
  风险：不猜测、不修复、不执行 malformed 调用；只把协议失败纳入工具失败与 ASK 闭环。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-hermes-snake-case-descriptor
  摘要：准备让 `computer.use` descriptor 暴露 Hermes 风格 snake_case target aliases，并让 sidecar 执行期真正识别 `capture_after`。
  原因：sidecar 已支持多数字段的 snake_case 输入，但模型可见 schema 只提示 camelCase；真实 LLM 参考 Hermes schema 时可能不会生成已支持的别名。
  验证：待跑 focused external/computer-use tests、check/docs、真实闭环与 diff。
  风险：仅增加结构化 schema alias 和 `capture_after` 布尔读取；不新增权限，不改变 opt-in、ASK、plan、yolo、动态预算或子进程边界。

- 状态：完成
  执行者：main-codex
  范围：computer-use-hermes-snake-case-descriptor
  摘要：`computer.use` descriptor 现在暴露 Hermes 风格 snake_case aliases；sidecar 同步识别 `capture_after`，并允许 drag source/destination 混合使用 element 与 coordinate 目标。
  原因：真实模型参考 Hermes schema 时应看到可执行的字段名；执行期不能只支持 camelCase，也不能拒绝 Hermes 常见的 element-to-coordinate drag 组合。
  验证：`bun test tests/external.tools.test.ts tests/computer.use.sidecar.test.ts --timeout 30000`（37 pass, 0 fail）；`bun run docs:check`；`bun run check`；`bun run smoke:computer-use:live`（structured skip: cua-command-not-found）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1092 pass, 0 fail）；待最终 `git diff --check`。
  风险：只增加结构化 aliases 和校验兼容性；不新增默认可见工具，不改变 opt-in、ASK、plan、yolo、动态预算或子进程授权面。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-hermes-actions
  摘要：准备为 `browser.use` 增加 Hermes 风格 `scroll` 与 `press` action，并在 descriptor 中暴露对应结构化字段。
  原因：Hermes browser 工具包含页面滚动和按键动作；Flyflor 高层 `browser.use` 当前只能 click/type/evaluate/wait，真实浏览器交互闭环还缺两类基础动作。
  验证：待跑 focused browser-use/external tests、check/docs、真实闭环与 diff。
  风险：仅增加 opt-in `browser.use` sidecar action；默认 manifest 仍不暴露高层 browser control，不改变 ASK、plan、yolo、动态预算或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-hermes-actions
  摘要：`browser.use` 现在支持 Hermes 风格 `scroll` 与 `press` action；descriptor 暴露 `direction`、`amount`、`key`/`keys`，sidecar 通过 CDP 或 delegate process-json 执行。
  原因：补齐真实浏览器交互闭环里的页面滚动与按键动作，同时保持 kernel 只拥有 descriptor/gateway/event/audit/visibility/approval/quota/dispatch，不引入浏览器 runtime。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（33 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1093 pass, 0 fail）；待最终 `git diff --check`。
  风险：只影响 opt-in `browser.use` action surface；默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算和子进程 JSON 边界不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-hermes-navigation
  摘要：准备为 `browser.use` 增加 Hermes 风格 `back` 与 `get_images` action，并在 descriptor 中暴露 `maxImages` 资源上限。
  原因：Hermes browser 工具包含历史返回和页面图片枚举；Flyflor 高层 browser sidecar 需要补齐这两个基础导航/观察动作，同时保持执行外挂化。
  验证：待跑 focused browser-use/external tests、browser-use live smoke、check/docs、真实闭环与 diff。
  风险：仅增加 opt-in `browser.use` sidecar action；默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算和 kernel import 边界不变。

- 状态：完成
  执行者：main-codex
  范围：browser-use-hermes-navigation
  摘要：`browser.use` 现在支持 Hermes 风格 `back` 与 `get_images` action；CDP backend 使用 `Page.getNavigationHistory`/`Page.navigateToHistoryEntry` 和 `Runtime.evaluate`，delegate backend 继续收到同一份 process-json invocation。
  原因：补齐真实浏览器交互闭环里的历史返回与图片枚举能力，同时保持 kernel 不 import 浏览器 runtime，只拥有 descriptor、gateway/event/audit、visibility、approval、quota 和 dispatch。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（35 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖 get-images/navigate-second/back）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1095 pass, 0 fail）；待最终 `git diff --check`。
  风险：只影响 opt-in `browser.use` action surface；默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算和子进程 JSON 边界不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-hermes-console
  摘要：准备为 `browser.use` 增加 Hermes 风格 `console` action，支持页面上下文 `expression` 和读取后 `clear`。
  原因：Hermes browser 工具包含 console/error inspection；Flyflor 高层 browser sidecar 需要把这一类调试观察能力纳入 process-json 外挂面，而不是让 kernel 直接持有浏览器 runtime。
  验证：待跑 focused browser-use/external tests、browser-use live smoke、check/docs、真实闭环与 diff。
  风险：`expression` 可执行页面 JavaScript，因此 action 仍按高权限 opt-in browser control 处理；默认 manifest 暴露策略、ASK/plan/yolo、动态预算和 kernel import 边界不变。

- 状态：完成
  执行者：main-codex
  范围：browser-use-hermes-console
  摘要：`browser.use` 现在支持 Hermes 风格 `console` action；CDP backend 在页面内安装轻量 console buffer，支持 `expression` 执行、`clear` 清理、消息与表达式结果结构化返回，delegate backend 继续收到同一份 process-json invocation。
  原因：补齐真实浏览器调试/观察闭环里的 console/error inspection 能力，同时保持 kernel 不 import 浏览器 runtime，只拥有 descriptor、gateway/event/audit、visibility、approval、quota 和 dispatch。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（37 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`; `bun run smoke:browser-use:live`（ok true，覆盖 console-expression）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1097 pass, 0 fail）；待最终 `git diff --check`。
  风险：`console.expression` 可执行页面 JavaScript，仍只在 opt-in `browser.use` 高权限面暴露；默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算和子进程 JSON 边界不变。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-capture-after-context
  摘要：准备让 `computer.use` 后置 capture 保留 `app`、`mode` 与 `maxElements` / `max_elements` 上下文。
  原因：Hermes backend 在 `capture_after=True` 后会保留 app 上下文；Flyflor 当前后置 capture 只发送 `{ action: "capture" }`，`focus_app` 或 app-scoped action 后可能回看错范围。
  验证：待跑 focused computer-use tests、computer-use live smoke、check/docs、真实闭环与 diff。
  风险：只改变 follow-up capture 的结构化 input；不新增权限，不改变 ASK/plan/yolo、动态预算、默认 manifest 暴露策略或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：computer-use-capture-after-context
  摘要：`computer.use` 后置 capture 现在保留 `app`、`mode`、`maxElements` / `max_elements` 上下文；delegate 与 CUA 后端继续只通过 process-json 子进程接收结构化 invocation。
  原因：对齐 Hermes `capture_after=True` 的 app-scoped 回看语义，避免 `focus_app` 或 app-scoped action 后的 follow-up capture 退回 frontmost app 或 whole screen。
  验证：`bun test tests/computer.use.sidecar.test.ts --timeout 30000`（17 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`; `bun run smoke:computer-use:live`（structured skip: cua-command-not-found）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun test tests/naming.boundaries.test.ts --timeout 30000`（30 pass, 0 fail）；`bun run test`（1098 pass, 0 fail）；待最终 `git diff --check`。
  风险：只改变 follow-up capture input 的上下文保留；不新增权限，不改变默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算或 kernel import 边界。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-hermes-vision
  摘要：准备为 `browser.use` 增加 Hermes 风格 `vision` action；CDP backend 只捕获 screenshot，视觉分析委派给外部 process-json delegate。
  原因：Hermes browser 工具包含 `browser_vision`；Flyflor 需要补齐视觉理解闭环，但不能把 vision provider、browser runtime 或 desktop runtime import 进 kernel。
  验证：待跑 focused browser-use/external descriptor tests、browser-use live smoke、check/docs、真实闭环、全量测试与 diff。
  风险：`vision` 会读取当前页面截图，仍只在 opt-in 高权限 `browser.use` 面暴露；默认 manifest 暴露策略、ASK/plan/yolo、动态预算和子进程 JSON 边界不变。

- 状态：完成
  执行者：main-codex
  范围：browser-use-hermes-vision
  摘要：`browser.use` 现在支持 Hermes 风格 `vision` action；CDP backend 捕获 screenshot 后调用外部 process-json `visionDelegateCommand`，缺少 delegate 时返回结构化 `unavailable`。
  原因：补齐真实浏览器视觉理解闭环，同时保持 kernel 不 import vision provider、browser runtime 或 desktop runtime，只拥有 descriptor、gateway/event/audit、visibility、approval、quota 和 dispatch。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（40 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`; `bun run smoke:browser-use:live`（ok true，覆盖 vision-delegate）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun test tests/naming.boundaries.test.ts --timeout 30000`（30 pass, 0 fail）；`bun run test`（1101 pass, 0 fail）；待最终 `git diff --check`。
  风险：`vision` 会读取当前浏览器页面截图，仍只在 opt-in 高权限 `browser.use` 面暴露；默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算和子进程 JSON 边界不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-selector-alias
  摘要：准备让 `browser.use` 的 `click` / `type` 接收 `selector` 作为 `target` 的显式 CSS selector alias。
  原因：真实模型常用 `selector` 字段描述 DOM 目标；当前 CDP backend 只认 `target`，会把可执行意图变成校验失败。
  验证：待跑 focused browser-use/external descriptor tests、browser-use live smoke、check/docs、真实闭环与 diff。
  风险：只增加字段 alias，不新增 action，不改变默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-selector-alias
  摘要：`browser.use` 的 `click` / `type` 现在接收 `selector` 作为 `target` 的 CSS selector alias；CDP backend 使用同一 `document.querySelector` 路径，delegate backend 保持原始 process-json input 转发。
  原因：减少真实模型以 `selector` 命名 DOM 目标时的工具校验失败，同时保持高权限 browser control opt-in 与子进程边界。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（41 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`; `bun run smoke:browser-use:live`（ok true，覆盖 type-selector-captureAfter）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun test tests/naming.boundaries.test.ts --timeout 30000`（30 pass, 0 fail）；`bun run test`（1102 pass, 0 fail）；待最终 `git diff --check`。
  风险：只增加字段 alias；不新增 action，不改变默认 manifest 暴露策略、高权限 ASK/plan/yolo、动态预算或 kernel import 边界。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-hermes-refs
  摘要：准备让 CDP `browser.use snapshot` 默认生成 Hermes 风格 `@eN` refs，并让 `click` / `type` 能用 ref 定位。
  原因：Hermes browser 工作流是 snapshot -> ref -> click/type；Flyflor 只支持 CSS selector 会让真实模型的 ref 闭环断开。
  验证：待跑 focused browser-use/external descriptor tests、browser-use live smoke、check/docs、真实闭环、全量测试与 diff。
  风险：refs 只作为 browser sidecar 页面局部 hint；kernel 不存 ref map、不 import browser runtime，不改变默认 manifest、高权限 ASK/plan/yolo、动态预算或子进程边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-hermes-refs
  摘要：`browser.use snapshot` 默认返回 Hermes 风格 `@eN` 互动元素 refs，并在页面 DOM 上写入 `data-flyflor-ref`；`click` / `type` 支持 `ref` 和 `@eN` target，`full: true` 保留旧 Accessibility full-tree snapshot。
  原因：补齐真实模型常用的 snapshot -> ref -> action 浏览器闭环，同时保持 refs 只属于 browser sidecar 页面局部 hint，kernel 不存 ref map、不 import browser runtime。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（43 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖 snapshot-refs/type-ref/click-ref）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun test tests/naming.boundaries.test.ts --timeout 30000`（30 pass, 0 fail）；待最终 docs/test/diff 门禁。
  风险：只扩展 opt-in `browser.use` CDP action target 语义；默认 manifest、高权限 ASK/plan/yolo、动态预算和 process-json 子进程边界不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-capture-after-context
  摘要：准备让 `browser.use` 的后置 snapshot 保留 `full` 与 `maxElements`，并接受 `capture_after` 结构化别名。
  原因：真实模型在 Hermes 风格 snapshot -> ref -> action 小闭环中常需要执行后回看；如果 follow-up snapshot 丢掉观察预算，会扩大上下文并削弱 refs 回看稳定性。
  验证：待跑 focused browser-use/external descriptor tests、check/docs、真实闭环与 diff。
  风险：只影响 opt-in `browser.use` 的结构化 follow-up capture；不改变默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota 或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-capture-after-context
  摘要：`browser.use` 现在接受 `capture_after` 作为 `captureAfter` 的结构化别名；后置 snapshot 会保留 `full` 与 `maxElements`，确保 ref 操作后的回看仍按同一观察预算运行。
  原因：补齐 Hermes 风格 snapshot -> ref -> action -> captureAfter 小闭环，避免真实模型字段口径或默认 snapshot cap 让执行后观察变形。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（44 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖 ref/captureAfter/vision/console/screenshot）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `git diff --check`。
  风险：只影响 opt-in `browser.use` 的结构化 follow-up capture；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit 与 process-json 子进程边界不变。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-scroll-defaults
  摘要：准备让 `computer.use scroll` 对齐 Hermes 默认值：省略 `direction` 时默认为 `down`，省略 `amount` 时 CUA payload 默认为 `3`。
  原因：真实模型常发出最短 `{"action":"scroll"}` 调用；当前 sidecar 把缺失 direction 当失败，会造成不必要工具错误和 ASK/预算噪音。
  验证：待跑 focused computer-use tests、check/docs、真实闭环与 diff。
  风险：只放宽结构化 scroll 默认值；非法 direction/amount 仍在 spawn 前失败，不改变默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota 或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：computer-use-scroll-defaults
  摘要：`computer.use scroll` 现在允许省略 `direction`，按 Hermes 语义默认为 `down`；CUA backend payload 在省略 `amount` 时默认为 `3`，delegate backend 继续收到原始 process-json input。
  原因：减少真实模型发出最短 scroll 调用时的不必要工具失败，同时保留非法 direction/amount 的 spawn 前结构化校验。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（40 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:computer-use:live`（structured skip: cua-command-not-found）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；待最终 `bun run test` 与 `git diff --check`。
  风险：只放宽 opt-in `computer.use` 的结构化 scroll 默认值；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit 与 process-json 子进程边界不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-scroll-defaults
  摘要：准备让 `browser.use scroll` 接受最短 `{"action":"scroll"}` 调用，CDP backend 省略 `direction` 时默认 `down`，省略 `amount` 时保持默认 `3`。
  原因：Hermes browser handler 在调度层对缺省 direction 使用 `down`；真实模型常发最短 scroll 调用，当前 sidecar 会在进入后端前失败。
  验证：待跑 focused browser-use tests、check/docs、真实闭环与 diff。
  风险：只放宽 opt-in `browser.use` 的结构化 scroll 默认值；delegate backend 继续收到原始 process-json input，不改变默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota 或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-scroll-defaults
  摘要：`browser.use scroll` 现在允许省略 `direction`，CDP backend 按 Hermes handler 语义默认为 `down`；省略 `amount` 时保持默认 `3`，非法 direction/amount 仍在 sidecar 校验层失败。
  原因：减少真实模型发出最短 scroll 调用时的不必要工具失败，同时保持 delegate backend 原始 process-json input 与内核边界不变。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（46 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖真实 Chrome CDP browser.use 闭环）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1109 pass, 0 fail）；`git diff --check`。
  风险：只放宽 opt-in `browser.use` 的结构化 scroll 默认值；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit 与 process-json 子进程边界不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-snake-case-observation-fields
  摘要：准备让 `browser.use` 的观察预算字段接受 `capture_mode`、`max_elements`、`max_images` aliases，并在模型可见 descriptor 中显式暴露。
  原因：`computer.use` 已对齐 Hermes 风格 snake_case 字段；真实模型也常用 snake_case 表达观察预算，当前 `browser.use` 会忽略这些字段并退回默认 snapshot/image/capture 行为。
  验证：待跑 focused browser-use/external descriptor tests、check/docs、真实闭环与 diff。
  风险：只增加结构化字段 aliases；不改变默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit 或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-snake-case-observation-fields
  摘要：`browser.use` descriptor 暴露 `capture_mode`、`max_elements`、`max_images`；CDP backend 在 snapshot/get_images/captureAfter 路径消费 snake_case aliases，delegate backend 继续接收原始 process-json input。
  原因：降低真实模型用 snake_case 表达观察预算时的工具调用摩擦，并保持工具层外挂、process-json 与内核边界不变。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（47 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖真实 Chrome CDP browser.use 闭环）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1110 pass, 0 fail）。
  风险：只增加可见 schema aliases 与 CDP sidecar 字段读取；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-evaluate-expression-alias
  摘要：准备让 `browser.use evaluate` 接受 descriptor 已暴露的 `expression` 字段作为 `script` alias。
  原因：模型可见 schema 同时暴露 `script` 和 `expression`，但执行期只接受 `script`；真实模型按 `expression` 发 evaluate 时会在 sidecar 校验层失败。
  验证：待跑 focused browser-use tests、check/docs、真实 browser smoke、真实闭环与 diff。
  风险：只修正 opt-in `browser.use` 的 CDP evaluate 字段读取；不改变默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit 或 kernel import 边界。

- 状态：完成
  执行者：main-codex
  范围：browser-use-evaluate-expression-alias
  摘要：`browser.use evaluate` 现在接受 `expression` 作为 `script` alias；CDP backend 用 `script ?? expression` 构造 `Runtime.evaluate`，delegate backend 继续接收原始 process-json input。
  原因：消除模型可见 schema 与执行期字段读取不一致，减少真实模型用 `expression` 发 evaluate 时的无意义工具失败。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（48 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖真实 Chrome CDP browser.use 闭环）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0）；`bun run test`（1111 pass, 0 fail）；待最终 `git diff --check`。
  风险：只修正 opt-in `browser.use` CDP evaluate 字段读取；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：补充验证
  执行者：main-codex
  范围：browser-use-evaluate-expression-alias
  摘要：最终 whitespace 检查通过。
  验证：`git diff --check`。

- 状态：进行中
  执行者：main-codex
  范围：execution-job-detail-query-cache-evidence
  摘要：补充 `execution.job.detail.get` 重复查询 read-cache 回归，并修正旧 TODO 中 Phase 7/10-13 与后续完成记录冲突的状态。
  原因：工具/子进程/子代理失败 detail 必须能通过 socket read-model 稳定读取；旧问题提到 detail get 重复请求，现有测试只覆盖 `execution.job.list` 缓存，缺少 detail get 的显式证据。
  验证：待跑 focused gateway ws tests、check/docs、真实闭环与 diff。
  风险：只补测试证据与 TODO 状态，不改变 socket runtime path、Memory/Scope/Crystal 主链、工具执行或默认 manifest。

- 状态：完成
  执行者：main-codex
  范围：execution-job-detail-query-cache-evidence
  摘要：`tests/gateway.ws.test.ts` 现在覆盖 `execution.job.detail.get` 短 TTL read-cache，连续两次读取同一 job detail 只触发一次 reader 查询，并在 `execution.job.snapshot` 中分别暴露 `cache.hit=false/true`；`TODO.md` 以追加方式记录旧 Phase 7/10-13 状态校正，保留历史原文不改写。
  原因：为工具/子进程/子代理失败 detail 的 socket read-model 去重提供显式回归证据，同时遵守文档 append-only 约束。
  验证：`bun test tests/gateway.ws.test.ts tests/protocol.control.test.ts --timeout 30000`（79 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run test`（1111 pass, 0 fail）；`bun run provider:ready -- --require-ready`（ok true, home deepseek/deepseek-v4-flash）；`bun run smoke:live:closure` 第二轮通过（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11；第一轮预算 ASK 场景遇到一次 provider 空响应并作为外部瞬态记录）；`git diff --check`。
  风险：只新增测试与 append-only 文档记录；不改变 socket runtime path、Memory/Scope/Crystal 主链、工具执行、默认 manifest、ASK/plan/yolo 或动态预算。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-cdp-resource-bounds
  摘要：准备让 `browser.use` CDP backend 和 delegate backend 共享 `timeoutMs` / `maxOutputBytes` 资源配置校验，并把配置后的 timeout 应用到 CDP HTTP/WebSocket 路径。
  原因：当前 delegate backend 会校验资源配置，CDP backend 只读取 `cdpUrl` 且使用固定默认超时；这会造成同一个 `browser.use` sidecar 内资源边界口径漂移。
  验证：待跑 focused browser-use tests、check/docs、真实闭环与 diff。
  风险：只影响 opt-in `browser.use` CDP sidecar 的资源边界；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：完成
  执行者：main-codex
  范围：browser-use-cdp-resource-bounds
  摘要：`browser.use` CDP backend 现在和 delegate backend 共享 `timeoutMs` / `maxOutputBytes` 配置校验；CDP `/json/*` HTTP 请求、WebSocket open 和 command response 等待均使用配置后的 `timeoutMs`。
  原因：消除同一 sidecar 内 delegate 与 CDP 的资源边界漂移，避免 CDP 配置绕过 sidecar 资源窗口或固定默认超时。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（49 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖 open/navigate/wait/snapshot refs/ref captureAfter/evaluate/get_images/back/console/vision/screenshot）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11）；`bun run test`（1112 pass, 0 fail）；待最终 `git diff --check`。
  风险：只影响 opt-in `browser.use` CDP sidecar 的资源边界；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：补充验证
  执行者：main-codex
  范围：browser-use-cdp-resource-bounds
  摘要：最终 whitespace 检查通过。
  验证：`git diff --check`。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-cua-defaults
  摘要：准备让 `computer.use` CUA payload 对齐 Hermes 默认值：`capture` 默认 `mode: "som"` 与 `max_elements: 100`，`wait` 默认 `seconds: 1`。
  原因：当前 CUA payload 只在模型显式提供字段时传递这些值，会让真实 CUA driver 依赖自身隐式默认；sidecar 边界应给 CUA backend 一个明确、可测的 Hermes 兼容 payload。
  验证：待跑 focused computer-use tests、check/docs、真实闭环与 diff。
  风险：只影响 opt-in `computer.use` CUA backend payload；delegate backend 保持原始 process-json input，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：完成
  执行者：main-codex
  范围：computer-use-cua-defaults
  摘要：`computer.use` CUA backend payload 现在在 `capture` 省略观察字段时显式传递 `mode: "som"` 与 `max_elements: 100`，在 `wait` 省略等待时间时显式传递 `seconds: 1`；delegate backend 继续收到原始 process-json invocation。
  原因：对齐 Hermes computer-use 默认语义，让 CUA 子进程边界获得可测、稳定的默认 payload，同时不把 backend 默认值回写进通用工具输入。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（41 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:computer-use:live`（ok true，structured skip: cua-command-not-found）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11）；`bun run test`（1113 pass, 0 fail）；待最终 `git diff --check`。
  风险：只影响 opt-in `computer.use` CUA backend payload；默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链和 kernel import 边界不变。

- 状态：补充验证
  执行者：main-codex
  范围：computer-use-cua-defaults
  摘要：最终 whitespace 检查通过。
  验证：`git diff --check`。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-cua-key-hotkey
  摘要：准备让 `computer.use key` 的 CUA backend 按 Hermes 语义区分普通按键与组合键：普通键走 `press_key`，带 modifier 的组合键走 `hotkey`。
  原因：Hermes CUA backend 会把 `cmd+s` 解析成 `hotkey` + `keys: ["cmd", "s"]`，当前 Flyflor CUA backend 一律走 `press_key` 并传原始 `keys` 字符串，真实 driver 可能无法执行组合键。
  验证：待跑 focused computer-use tests、check/docs、真实闭环与 diff。
  风险：只影响 opt-in `computer.use` CUA backend payload/tool name；delegate backend 保持原始 process-json input，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：完成
  执行者：main-codex
  范围：computer-use-cua-key-hotkey
  摘要：`computer.use key` 的 CUA backend 现在会把普通按键路由到 `press_key` 并发送 `key` 字段，把带 modifier 的组合键路由到 `hotkey` 并发送 Hermes 风格 `keys: [modifier..., key]`；`command/control/alt` aliases 会归一化成 `cmd/ctrl/option`。
  原因：对齐 Hermes computer-use CUA backend 的 key/hotkey 分流，避免真实模型发出 `command+shift+s` 这类组合键时被错误送进 `press_key`。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（42 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:computer-use:live`（ok true，structured skip: cua-command-not-found）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11）；`bun run test`（1114 pass, 0 fail）；待最终 `git diff --check`。
  风险：只影响 opt-in `computer.use` CUA backend payload/tool name；delegate backend 保持原始 process-json input，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链和 kernel import 边界不变。

- 状态：补充验证
  执行者：main-codex
  范围：computer-use-cua-key-hotkey
  摘要：最终 whitespace 检查通过。
  验证：`git diff --check`。

- 状态：进行中
  执行者：main-codex
  范围：browser-use-press-key-aliases
  摘要：准备让 `browser.use press` 的 CDP backend 对常见键名 alias 做 Hermes 风格归一化，例如 `enter/return`、`esc/escape`、`arrow-down` 等映射到 CDP 期望 key。
  原因：Hermes browser_press 面向模型暴露的是浏览器键名语义，真实模型常用小写或短 alias；当前 Flyflor CDP backend 原样透传，可能导致 `Input.dispatchKeyEvent` 收到不可执行 key。
  验证：待跑 focused browser-use tests、check/docs、真实闭环与 diff。
  风险：只影响 opt-in `browser.use` CDP backend 的按键字段；delegate backend 保持原始 process-json input，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链不变。

- 状态：完成
  执行者：main-codex
  范围：browser-use-press-key-aliases
  摘要：`browser.use press` 的 CDP backend 现在会在 `Input.dispatchKeyEvent` 前归一化常见模型键名 alias：`enter/return`、`esc/escape`、`arrow-down/down`、`page-up/page-down`、`space`、`f1` 到 `f24` 等都会映射到 CDP 兼容 key。
  原因：对齐 Hermes browser_press 面向模型的键名语义，减少真实模型用小写或短 alias 时产生的无意义浏览器按键失败。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（50 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true，覆盖真实 Chrome CDP browser.use 闭环）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 7）；`bun run test`（1115 pass, 0 fail）；待最终 `git diff --check`。
  风险：只影响 opt-in `browser.use` CDP backend 的按键字段；delegate backend 保持原始 process-json input，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota、audit、Memory/Scope/Crystal 主链和 kernel import 边界不变。

- 状态：补充验证
  执行者：main-codex
  范围：browser-use-press-key-aliases
  摘要：最终 whitespace 检查通过。
  验证：`git diff --check`。

- 状态：完成
  执行者：main-codex
  范围：browser-use-press-modifier-combos
  摘要：`browser.use press` 的 CDP backend 现在会将 `cmd+k`、`cmd+shift+k`、`ctrl+alt+t` 等 shortcut 字符串解析为 CDP modifier keyDown/main key keyDown/keyUp/modifier keyUp 序列；delegate backend 继续保留原始 process-json input。
  原因：真实模型常把 browser press 用作快捷键入口；原先 CDP backend 会把整段 `cmd+k` 当单个 key 透传，无法稳定触发浏览器快捷键。
  验证：待跑 focused browser-use tests、check/docs、真实 browser smoke、真实闭环与 `git diff --check`。
  风险：只影响 opt-in `browser.use` CDP backend 的 press 行为；manifest visibility、ASK/plan/yolo、动态预算、approval/quota/audit、delegate backend 和 kernel import 边界不变。

- 状态：补充验证
  执行者：main-codex
  范围：browser-use-press-modifier-combos
  摘要：完成 focused、docs、check、真实 browser smoke、真实 LLM closure 和 whitespace 验证。
  验证：`bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（51 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:browser-use:live`（ok true）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11）；`git diff --check`。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-key-alias
  摘要：准备让 `computer.use key` 接受 `input.key` 作为 `input.keys` 的模型字段 alias，并让 CUA backend 继续按 Hermes 语义分流 `press_key` / `hotkey`。
  原因：真实模型常把按键字段写成单数 `key`；当前 sidecar 只接受 `keys`，会在进入 delegate/CUA 前失败，形成无意义工具错误。
  验证：待跑 focused computer-use/external descriptor tests、check/docs、真实 computer/browser smoke、真实闭环与 `git diff --check`。
  风险：只影响 opt-in `computer.use key` 输入兼容；delegate backend 保留原始 process-json input，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota/audit、Memory/Scope/Crystal 主链和 kernel import 边界不变。

- 状态：完成
  执行者：main-codex
  范围：computer-use-key-alias
  摘要：`computer.use key` 现在接受 `input.key` 作为 `input.keys` 的模型字段 alias；CUA backend 使用任一字段继续分流到 `press_key` / `hotkey`，descriptor 也显式暴露 `key`。
  原因：减少真实模型按键调用的字段口径失败，同时保持 delegate 原始 process-json input、默认 manifest 与高权限执行边界不变。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（43 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:computer-use:live`（ok true，structured skip: cua-command-not-found）；`bun run smoke:browser-use:live`（ok true）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11）；`git diff --check`。

- 状态：进行中
  执行者：main-codex
  范围：computer-use-action-aliases
  摘要：准备让 `computer.use` sidecar 接受真实模型常见 action alias，例如 `doubleClick`、`double-click`、`type-text`、`press_key`、`setValue`、`listApps`、`focusApp` 和 `screenshot`。
  原因：模型可见 schema 仍应提示 Hermes canonical snake_case，但真实模型偶发 camelCase/hyphen/backend-shaped action 时不应在 sidecar 入口产生无意义失败。
  验证：待跑 focused computer-use tests、check/docs、真实 computer/browser smoke、真实闭环与 `git diff --check`。
  风险：只影响 opt-in `computer.use` action 读取边界；原始 `input.action` 保留在 process-json payload 中，默认 manifest、高权限 ASK/plan/yolo、动态预算、approval/quota/audit、Memory/Scope/Crystal 主链和 kernel import 边界不变。

- 状态：完成
  执行者：main-codex
  范围：computer-use-action-aliases
  摘要：`computer.use` sidecar 现在接受 `doubleClick`、`double-click`、`type-text`、`press_key`、`setValue`、`listApps`、`focusApp`、`screenshot` 等 action alias，并归一化为 canonical dispatched action。
  原因：真实模型偶发 camelCase/hyphen/backend-shaped action 时仍能进入同一结构化校验和子进程执行路径，减少无意义入口失败。
  验证：`bun test tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000`（44 pass, 0 fail）；`bun run docs:check`（26 pass, 0 fail）；`bun run check`；`bun run smoke:computer-use:live`（ok true，structured skip: cua-command-not-found）；`bun run smoke:browser-use:live`（ok true）；`bun run smoke:live:closure`（ok true, failedChecks [], phantomPermissionUserEvents 0, executionJobCount 11）；`git diff --check`。
