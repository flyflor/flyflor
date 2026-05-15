# TODO

仅记录**未完成 / 进行中**的工作。已完成条目转入 git log、核心文档或 [docs/old-docs/todo.history.md](docs/old-docs/todo.history.md)，不在本文件留痕。

新增缺口请直接补到对应章节，并在相关文档的「运行边界 / 后续增强」同步描述。

## 优先级口径

- **P0**：阻碍主用例（chat / gateway / memory）正常运行
- **P1**：影响生产稳定性 / 多副本部署 / 长期演进
- **P2**：功能增强 / 体验 / 二级路径

## 当前对齐

- 生命体主线 LF-R0~R15 已落地，历史路线归档在 [docs/old-docs/life.form.md](docs/old-docs/life.form.md) 和 [docs/old-docs/todo.history.md](docs/old-docs/todo.history.md)。
- 当前契约以根目录 [README.md](README.md)、[docs/README.md](docs/README.md)、[docs/boundaries.md](docs/boundaries.md)、[docs/memory.system.md](docs/memory.system.md) 和本 TODO 为准。
- `docs:check` 已覆盖 prompt docs、CLI docs、docs 索引、测试引用与 TODO 状态 lint。

## 下一阶段候选（按依赖先后）

| 优先级 | 主题 | 状态 | 备注 |
| --- | --- | --- | --- |
| P1 | memory 层剩余 best-effort 语义硬失败化 | 进行中 | 已完成 provider fallback、stream fallback、MCP/schema、plugin/shell/audit/inflight/blackboard/reflection/feedback/consolidation/hot compression 的显式失败；summary embedding、retrospective audit、project memory snapshot 与 ghost content patch 已从 best-effort 改为显式失败；hippocampus context 与 `inbox list` 已切到 brain.db 权威源，不再读 legacy journal。剩余 legacy journal 写入策略 / 个别异步审计路径需按风险拆批。 |
| P1 | daemon 安装体验实机验证 | 未开始 | gateway daemon helper 已实现；launchd/systemd 安装脚本和跨平台真实机器回归仍未固化。 |
| P2 | 真实第三方 MCP 长期断链回归 | 未开始 | 本地 mock 已覆盖短暂断链与长结果回灌；还缺真实 server 长时间断链、重连、catalog stale 的实测矩阵。 |
