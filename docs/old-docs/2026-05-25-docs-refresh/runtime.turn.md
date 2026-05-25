# 单轮请求流程

## 当前主线

`RuntimeModule.handleMessage` 仍然是热路径唯一入口。

当前主线 turn 流程：

1. Socket `/ws` 收到 `gateway.message.send`
2. `SocketControlHub` 归一化为 `GatewayMessage`
3. `RuntimeModule.handleMessage` 执行单轮推理、工具循环、记忆写入
4. `turn.delta` / `turn.final` / `turn.error` 通过 `/ws` 返回
5. `RuntimeEvent` 通过事件总线广播

这条热路径现在承载的不是普通 agent turn，而是智能生命体当前一轮的显式生命活动：装配当下生命态、调用外骨骼行动、在边界处 ask、把结果写回热记忆与生命账本。

如果当前轮命中了某个 Scope，那么这条热路径装配的不是“某个目录的附带上下文”，而是一个独立生命工作域：局部宪法、局部记忆入口、局部召回面都应在当前生命态中显式生效。

补充：

- Bun 主线仍保留一个本地 stdio chat 调试入口，可直接调用 `RuntimeModule.handleMessage`。
- 这条 stdio 路径不是长期协议面；未来第一方 CLI / TUI / socket shell 统一由 Rust 通过 `/ws` 对接。

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

## Scope、Ask 与长线推进

Scope、Ask 和长线 loop 在主线 turn 里是同一条生命连续性链上的不同节点：

1. 某个长期事情先被显式提起或由 codename 锚住
2. runtime 判断是否需要 ask 来确认 scope 升格或边界裁决
3. 用户确认后，Scope 进入显式生命态
4. 后续复杂执行和黑板讨论都以这个 Scope 为局部工作域
5. 若 loop 或黑板再次抵达边界，再通过 ask 收束并继续

因此，Scope 不是“项目模式开关”，Ask 也不是“失败弹窗”；两者共同构成 Flyflor 的显式长期连续性机制。

## Fork、Ghost 与结晶闭环

`ContextFork` 的行为按分支理解，而不是按聊天副本理解：

1. 用户或模型结构化输出可以让当前交流进入某个 `contextForkId`
2. fork 只在显式传入时参与上下文装配，不从 transport metadata 自动恢复
3. 用户可以要求 LLM 辅助合并 fork
4. merge 输出必须是结构化结果；冲突进入 ASK，而不是静默覆盖父 Scope
5. 如果 ASK 没有得到回答，runtime 保留 ghost / pending snapshot
6. 用户后续显式 `continue` 时，可以恢复该 scope / fork / loop snapshot 并继续闭环
7. 已闭合的 fork merge、ASK answer 和任务收束证据，可以进入 Crystal candidate，再由质量门升格为 Gem

这条链路把“长线 loop”从隐藏后台任务改成可审计、可暂停、可继续、可结晶的生命闭环。`brain.db` 记录过程和回放锚点；`scope.db` 保存 Scope 相关热区记忆、向量树和关联词索引；Crystal 只吸收已经闭合且有证据的长期方法。

## 已移除的主线表面

以下内容不再属于主线稳定边界：

- 第一方 Bun CLI/TUI command adapter
- 第一方 IM channel adapter 入站
- 第一方 TUI runtime/state adapter

这些实现已经从主源码剥离；已移除旧实现且不保留兼容目录。
