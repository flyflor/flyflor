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
  范围：kernel-runtime-executive-ws-bootstrap
  摘要：为 runtime-executive-ws 代码 worktree 初始化了显式所有权，负责 gateway、runtime、executive 及 ws/executive 闭环测试面。
  原因：这个切片需要把可见 `/ws` 协议与执行 loop 推向完整的智能生命体契约，同时避免与 memory 或 crystal 内部实现冲突。
  验证：`wt/kernel-runtime-executive-ws` 的本地控制文件已更新

- 状态：completed
  操作者：main-codex
  范围：kernel-runtime-executive-ws-closure
  摘要：完成 runtime/ws 切片，打通 requestId 稳定关联的 control turn，补齐 thin-client ask 暂停/恢复契约文档，并新增可重复执行的 smoke 与 ws 定向测试来覆盖 loop 闭环和 history 回放。
  原因：协调者需要一个已经审过的 `/ws` 表面，使新 session 或后续 Rust shell 不必重新摸索 ask-loop 闭环、事件订阅和 history 回放之间的关系。
  验证：`bun test tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/docs.references.test.ts`

- 状态：completed
  操作者：wt/kernel-runtime-executive-ws
  范围：runtime-executive-ws-thin-client-closure
  摘要：补齐本地 ws thin-client control flow 缺口，把 envelope `requestId` 保留进 runtime 关联键，扩展确定性 gateway smoke 覆盖 event subscribe、loop pause-resume 闭环与 history replay，并把稳定的 lifecycle/history 面补进 Rust 后续对接文档。
  原因：在 Rust shell 继续依赖 Gateway/Runtime 边界之前，这个切片必须先给出可执行的 ws control flow 契约，以及可观察的 event/history 面和 executive loop pause-resume 闭环，避免再靠私有 transport patch。
  验证：`bun test tests/gateway.control.smoke.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts`；`bun run test:kernel`；`bun run docs:check`

## 2026-05-22 Runtime-Executive-WS Peer Count 补充

- 状态：completed
  操作者：wt/kernel-runtime-executive-ws
  范围：runtime-executive-ws-peer-count
  摘要：在 gateway status snapshot 中加入 live `clientCount`，让 thin Gateway 可以暴露实时 peer 压力，而不必恢复已退役的 HTTP `/channels` surface。
  原因：live hub 需要一个 peer-count 信号服务 `/ws` status snapshot，但这个信号属于 hub 级 runtime 状态，不应该回到已经移除的 REST channel registry。
  验证：本地已更新 gateway 与 protocol 的定向测试；完整 worktree 验证仍待执行
