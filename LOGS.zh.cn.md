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
  范围：kernel-context-memory-bootstrap
  摘要：为 context-memory 代码 worktree 初始化了显式所有权，负责 hippocampus memory、memory entities、context assembly 及其直接测试。
  原因：这个切片需要在月分片生命周期、遗忘曲线和召回正确性上独立推进，避免与 scope/crystal 或 runtime/executive 工作互相冲突。
  验证：`wt/kernel-context-memory` 的本地控制文件已更新
