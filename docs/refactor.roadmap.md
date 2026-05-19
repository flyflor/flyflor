# Refactor Roadmap

## 当前阶段

主线已经从“保留第一方迁移期 CLI/TUI/Gateway surface”切到“只保留生命内核 + 外骨骼 + 事件血管协议”。

当前阶段看根目录 [TODO.md](../TODO.md)。

## 已完成

- R0-R6 完成
- R7 当前轮已完成主线 `src/command` 与 `src/agent/gateway/channels` 删除
- 主线 `gateway` 收敛为 WS/control/event
- R8 已完成：血管协议冻结到 `src/protocol/control/*`
- R9 已完成：computer exoskeleton capability/tool/trust/sandbox 契约冻结
- R10 已完成：long-horizon loop pause/resume contract 冻结

## 后续

- 继续收紧文档与测试，维持 Bun 主线只保留生命内核、Executive 外骨骼和 WS/event 血管。
- 后续 CLI / Gateway / TUI 第一方实现转向 Rust，对接基线保持在 control protocol 与 runtime events。
