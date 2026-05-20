# 单轮请求流程

## 当前主线

`RuntimeModule.handleMessage` 仍然是热路径唯一入口。

当前主线 turn 流程：

1. Gateway `/ws` 收到 `gateway.message.send`
2. `GatewayControlHub` 归一化为 `GatewayMessage`
3. `RuntimeModule.handleMessage` 执行单轮推理、工具循环、记忆写入
4. `turn.delta` / `turn.final` / `turn.error` 通过 `/ws` 返回
5. `RuntimeEvent` 通过事件总线广播

补充：

- Bun 主线仍保留一个本地 stdio chat 调试入口，可直接调用 `RuntimeModule.handleMessage`。
- 这条 stdio 路径不是长期协议面；未来第一方 CLI / TUI / gateway shell 统一由 Rust 通过 `/ws` 对接。

## R10 长线 loop 冻结

当 Executive 工具回路命中预算上限或 loop guard 把当前 step 全部阻断时，主线 turn 不会继续隐藏重试，而是收敛到显式 ask 暂停：

1. `ExecutiveToolRuntime` 返回结构化 `askRequired`
2. `RuntimeModule` 发布 `cttl.long_horizon_loop.paused`
3. `turn.final.reply.metadata.kind` 变为 `ask`
4. `turn.final.reply.metadata.executiveToolLoop` 暴露暂停 snapshot
5. 用户下一轮显式回答 pending ask 后，Memory 记录 `ask-answer-pair`
6. Runtime 发布 `cttl.long_horizon_loop.resumed`

约束：

- 没有后台自动续跑。
- 没有额外私有 loop transport。
- 恢复完全依赖新的结构化输入和既有 WS/event 血管。

## 已移除的主线表面

以下内容不再属于主线稳定边界：

- 第一方 Bun CLI/TUI command adapter
- 第一方 IM channel adapter 入站
- 第一方 TUI runtime/state adapter

这些实现已经从主源码剥离，保存在 `abandon/` 仅做备份。
