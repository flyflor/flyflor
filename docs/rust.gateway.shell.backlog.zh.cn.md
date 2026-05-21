# Rust Gateway Shell Backlog

## 一句话定位

本文把 [rust.integration.md](rust.integration.md) 中的 Rust 外壳接入要求拆成可执行 backlog，供后续第一方 Rust `gateway / channel / cli / tui` 重写阶段直接使用。

## 范围

本 backlog 只覆盖 Rust 外壳，不覆盖 Bun 主线认知内核本身。

Rust 外壳的目标职责：

- 连接 `/ws`
- 处理 control/event envelope
- 渲染 stream / ask / planning / loop 状态
- 展示事件时间线
- 闭环用户输入

不做：

- 重写 Bun runtime
- 重写 memory / executive / blackboard 内核
- 在 Rust 侧新增私有 transport 协议

## Slice 1: Connection Core

目标：先拿到一个稳定可连的 Rust shell 内核。

实现契约固定参照：[rust.connection.core.md](rust.connection.core.md)

交付：

1. 建立 `/ws` 连接并接收 `server.hello`
2. 发送可选 `client.hello`
3. 处理 `ping` / `pong`
4. 支持 `gateway.status.get`
5. 支持 `capability.catalog.get`

完成标准：

- 能把连接状态打印或渲染出来
- 能缓存 hello/status/catalog 三级连接态 snapshot
- 能明确区分 `idle` / `connecting` / `open-waiting-hello` / `ready` / `degraded` / `reconnecting` / `closed`
- 能把连接级 cache ownership、心跳和重连退避收敛在同一层
- 不依赖 Bun 私有类

## Slice 2: Stream Renderer

目标：把最小聊天流闭环跑通。

交付：

1. 发送 `gateway.message.send`
2. 渲染 `turn.delta`
3. 渲染 `turn.final`
4. 渲染 `turn.error`
5. 处理 `error.payload.code`

完成标准：

- 用户输入能经过 Rust shell 发到 Bun 主线
- assistant 增量和 final 都能稳定显示
- `turn.error` 与 control `error` 不混淆

## Slice 3: Ask Loop

目标：把 ask 作为第一优先级闭环能力做完整。

交付：

1. 读取 `turn.final.reply.metadata.kind`
2. 读取 `turn.final.reply.metadata.ask`
3. 渲染：
   - prompt
   - choices
   - questions
   - freeform
4. 把用户回答作为下一轮 `gateway.message.send` 发回

完成标准：

- 不从 reply 文本猜 ask
- ask UI 完全由结构化 metadata 驱动
- pending ask 能被用户显式回答并继续对话

## Slice 4: Planning Panel

目标：把 planning 结构化展示做成稳定旁路面板。

交付：

1. 读取 `turn.final.reply.metadata.planning.taskPlans`
2. 读取 `contextForks`
3. 读取 `replays`
4. 用事件：
   - `memory.task_plan.written`
   - `memory.context_fork.written`
   - `memory.replay_record.written`
   做刷新提示

完成标准：

- planning 展示只依赖 `turn.final.reply.metadata.planning`
- 事件只做提示，不做 planning 权威数据源

## Slice 5: Long-Horizon Loop Recovery

目标：把 Executive 暂停/恢复 UI 闭环跑通。

交付：

1. 读取 `turn.final.reply.metadata.executiveToolLoop`
2. ask 组件局部回退读取 `ask.executiveToolLoop`
3. 消费事件：
   - `executive.loop.paused`
   - `executive.loop.resumed`
   - `executive.loop.guard.blocked`
4. 为当前 pending loop 渲染恢复状态

完成标准：

- loop snapshot 的权威来源仍是 `turn.final.reply.metadata.executiveToolLoop`
- 事件只做审计与提示

## Slice 6: Event Timeline

目标：给 Rust shell 一个独立的事件时间线与审计面。

交付：

1. 发送 `event.subscribe`
2. 发送 `event.unsubscribe`
3. 处理 `ack.payload.subscriptions`
4. 渲染 `event.publish.payload.event`
5. 按 `RuntimeEvent.type` / class 做分组显示

完成标准：

- timeline 与主聊天流解耦
- 不把事件流当作当前轮结果快照

## Slice 7: Shell UX

目标：做成可日常使用的第一版 Rust 外壳体验。

交付：

1. 连接状态栏
2. 主聊天流视图
3. ask 表单区
4. planning 面板
5. 事件时间线
6. 错误提示区

完成标准：

- 在单连接前提下可完成日常对话、ask 回答、planning 浏览、event 观察

## 建议顺序

推荐按下面顺序落地：

1. Slice 1 Connection Core
2. Slice 2 Stream Renderer
3. Slice 3 Ask Loop
4. Slice 5 Long-Horizon Loop Recovery
5. Slice 4 Planning Panel
6. Slice 6 Event Timeline
7. Slice 7 Shell UX

原因：

- ask 和 loop 恢复是产品闭环核心
- planning 和 event timeline 可以在聊天主流程跑通后补成旁路面

## 验收对照

Rust shell backlog 每个 slice 都应回对这些文档：

- [control.protocol.md](control.protocol.md)
- [runtime.events.md](runtime.events.md)
- [rust.integration.md](rust.integration.md)
- [TODO.md](../TODO.md)

## 红线

- 不新增 Rust 私有协议分支去绕开 `/ws`
- 不从文本猜测 ask / todo / loop / routing 语义
- 不把事件流直接当成 turn 级权威状态
- 不把历史 Bun CLI/TUI 作为兼容目标回灌主线
