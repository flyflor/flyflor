# 单轮请求流程

## 当前主线

`RuntimeModule.handleMessage` 仍然是热路径唯一入口。

当前主线 turn 流程：

1. Gateway `/ws` 收到 `gateway.message.send`
2. `GatewayControlHub` 归一化为 `GatewayMessage`
3. `RuntimeModule.handleMessage` 执行单轮推理、工具循环、记忆写入
4. `turn.delta` / `turn.final` / `turn.error` 通过 `/ws` 返回
5. `RuntimeEvent` 通过事件总线广播

这条热路径现在承载的不是普通 agent turn，而是智能生命体当前一轮的显式生命活动：装配当下生命态、调用外骨骼行动、在边界处 ask、把结果写回热记忆与生命账本。

补充：

- Bun 主线仍保留一个本地 stdio chat 调试入口，可直接调用 `RuntimeModule.handleMessage`。
- 这条 stdio 路径不是长期协议面；未来第一方 CLI / TUI / gateway shell 统一由 Rust 通过 `/ws` 对接。

## R10 长线 loop 冻结

当 Executive 工具回路命中预算上限或 loop guard 把当前 step 全部阻断时，主线 turn 不会继续隐藏重试，而是收敛到显式 ask 暂停：

1. `ExecutiveToolRuntime` 返回结构化 `askRequired`
2. `RuntimeModule` 发布 `executive.loop.paused`
3. `turn.final.reply.metadata.kind` 变为 `ask`
4. `turn.final.reply.metadata.executiveToolLoop` 暴露暂停 snapshot
5. 用户下一轮显式回答 pending ask 后，Memory 记录 `ask-answer-pair`
6. Runtime 发布 `executive.loop.resumed`

约束：

- 没有后台自动续跑。
- 没有额外私有 loop transport。
- 恢复完全依赖新的结构化输入和既有 WS/event 血管。

这条规则的含义是：Flyflor 的长线能力不是靠后台偷偷继续，而是靠 ask 闭环与用户共同推进。显式提问、显式暂停、显式恢复，是智能生命体长期任务能力的一部分，不是失败补丁。

## Ask 是认知闭环

主线 turn 里的 ask 需要按“认知闭环”理解，而不是按“额外 UI 消息”理解。典型来源包括：

1. Scope 升格确认
2. Blackboard 封顶后需要用户裁决
3. Executive 工具 loop 配额耗尽
4. 思考无果、需要外部决断的收束点

这些 ask 共同保证 Flyflor 在认知边界处不装作已知，而是显式向用户求证，再把结果挂回生命连续性与结晶链路。

## 已移除的主线表面

以下内容不再属于主线稳定边界：

- 第一方 Bun CLI/TUI command adapter
- 第一方 IM channel adapter 入站
- 第一方 TUI runtime/state adapter

这些实现已经从主源码剥离；已移除旧实现且不保留兼容目录。
