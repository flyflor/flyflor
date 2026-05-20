# Refactor Roadmap

## 当前阶段

主线已经从“保留第一方迁移期 CLI/TUI/Gateway surface”切到“只保留生命内核 + 外骨骼 + 事件血管协议”。

当前阶段看根目录 [TODO.md](../TODO.md)。

## 已完成

- R0-R6 完成
- R7 当前轮已完成主线 `src/command` 与 `src/agent/gateway/channels` 删除
- 主线 `gateway` 收敛为 WS/control/event
- R9 已完成：computer exoskeleton capability/tool/trust/sandbox 契约冻结
- R10 已完成：long-horizon loop pause/resume contract 冻结

## 封板状态

- Bun 内核封板已完成：`kernel:seal` 已在真实 provider 下跑通，`docs:check`、`check`、deterministic tests、smoke、build、`test:live` 与 `smoke:agent:live` 全绿。
- R7/R8 当前剩余工作转为“0 漂移维护”：活跃文档、测试注释与少量主线边界表述继续和现状保持同步，不再是阻塞封板的实施项。
- `src/protocol/control/*`、`docs/control.protocol.md`、`runtime.events` 与 Rust handoff 文档已经冻结主面；后续重点从 Bun 内核封板切换到 Rust 外壳接线与实现切片。
- `kernel:seal` 继续保留为 Bun 内核回归门禁；`smoke:runtime:live` 保持 Docker 扩展验证，不进入当前封板硬门槛。

## 后续

- 继续收紧文档与测试，维持 Bun 主线只保留生命内核、Executive 外骨骼和 WS/event 血管。
- 把 Runtime-Memory、Blackboard、Executive、Sandbox、MCP 的主链异常面与 chaos/fuzz 门禁补到内核封板标准。
- 后续 CLI / Gateway / TUI 第一方实现转向 Rust，对接基线保持在 control protocol 与 runtime events。
