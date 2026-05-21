# TODO

仅记录**未完成 / 进行中**的工作。已完成条目转入 git log、核心文档或 [docs/old-docs/todo.history.md](docs/old-docs/todo.history.md)，不在本文件留痕。

新增缺口请直接补到对应章节，并在相关文档的「运行边界 / 后续增强」同步描述。

## 优先级口径

- **P0**：阻碍主用例（chat / gateway / memory）正常运行
- **P1**：影响生产稳定性 / 多副本部署 / 长期演进
- **P2**：功能增强 / 体验 / 二级路径

## 当前对齐

- 生命体主线 LF-R0~R15 已落地，历史路线归档在 [docs/old-docs/legacy.architecture.history.md](docs/old-docs/legacy.architecture.history.md) 和 [docs/old-docs/todo.history.md](docs/old-docs/todo.history.md)。
- 当前契约以根目录 [README.md](README.md)、[docs/README.md](docs/README.md)、[docs/boundaries.md](docs/boundaries.md)、[docs/memory.system.md](docs/memory.system.md) 和本 TODO 为准。
- `docs:check` 已覆盖 prompt docs、CLI docs、docs 索引、测试引用与 TODO 状态 lint。

## 下一阶段候选（按依赖先后）

| 优先级 | 主题 | 状态 | 备注 |
| --- | --- | --- | --- |
| P1 | daemon 安装体验实机验证 | 进行中 | gateway daemon helper、`gateway service plan`、`tests/gateway.daemon.test.ts`、安装脚本测试与 `smoke:gateway:service` 已覆盖本地生命周期、服务文件生成和临时 HOME 写入；launchd/systemd 跨平台真实机器回归仍待实机验收。 |
| P2 | 真实第三方 MCP 长期断链回归 | 进行中 | `scripts/mcp.transport.recovery.smoke.ts`、`tests/mcp.sse.test.ts`、`tests/skill.mcp.test.ts` 与 `smoke:recovery` 已覆盖本地断链 / 重连 / catalog stale / 长结果回灌；`smoke:mcp:live` 已提供 opt-in 真实 server 多轮 `tools/list` / 显式 tool call 探测，仍待真实第三方矩阵跑数。 |
