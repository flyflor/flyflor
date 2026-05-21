# Docs Protocol Events — 日志

## 2026-05-21

- 状态：open
  操作者：main-codex
  范围：wt/docs-protocol-events
  摘要：已初始化当前文档 worktree，并分配其负责的文档集合。
  原因：第一批文档工作需要拆成聚焦分支，避免跨分支互改同一文档面。
  验证：worktree 基于提交 `ae038bd` 创建

- 状态：completed
  操作者：main-codex
  范围：wt/docs-protocol-events
  摘要：补强控制协议与运行时事件文档，明确显式 scope、ask、loop 表面与 transport 连续性、事件时间线之间的边界。
  原因：协议分支需要说明 `turn.final.reply.metadata` 仍是当前轮权威面，而事件流只承担时间线与审计职责。
  验证：等待主线 review

## 2026-05-22

- 状态：completed
  操作者：child-codex
  范围：wt/docs-protocol-events
  摘要：已最终收口当前分支负责的 protocol 与 runtime event 文档，明确 `activeScope`、显式 ask/pause/resume 表面，以及 `turn.final.reply.metadata` 的当前轮权威地位，同时再次强调 transport 元数据和 runtime events 都不是认知连续性。
  原因：在提交前，需要让本 worktree 的负责文档、TODO 状态与追加日志共同对齐架构锚点。
  验证：`bun test tests/docs.references.test.ts`
