# Runtime Events

## 一句话定位

`RuntimeEvent` 是 Flyflor 主线的事件血管系统。

- 所有可观察运行态事实都应通过 `src/events/*` 发布。
- Gateway `/ws` 的 event stream 只转发这些事件。
- Rust CLI / TUI / Gateway 未来只读这层，不依赖 Bun 私有状态。

## 设计边界

- 事件必须可 JSON 序列化。
- 事件只表达结构化事实，不做自然语言语义判断。
- Gateway 不拥有事件语义，只负责订阅和广播。
- `abandon/` 中的旧 CLI/TUI 事件面不允许回流。

## 当前核心事件面

### Turn

- `agent.turn.start`
- `agent.turn.end`

### Gateway / Control

- `gateway.message.received`
- `gateway.start`
- `gateway.dedup.store.failed`
- `channel.link.changed`
- `channel.error`

### Sandbox / Capability

- `sandbox.tool.approval.requested`
- `sandbox.tool.approval.denied`
- `sandbox.tool.denied`
- `sandbox.shell.hook.start`
- `sandbox.shell.hook.end`
- `sandbox.shell.hook.failed`
- `plugin.invoke.start`
- `plugin.invoke.end`
- `plugin.invoke.failed`
- `mcp.tool.call.executed`
- `cttl.capability.catalog.built`
- `mcp.capability.catalog.built`
- `mcp.tool.catalog.built`

### Ask / Long-Horizon Loop

- `memory.ask.recorded`
- `memory.ask.answered`
- `memory.ask.chain.capped`
- `memory.ask.mutex.violation`
- `cttl.loop.guard.blocked`
- `cttl.long_horizon_loop.paused`
- `cttl.long_horizon_loop.resumed`

### Memory / Reflection

- `memory.episode.written`
- `memory.behavior.snapshot.recorded`
- `memory.task_plan.written`
- `memory.context_fork.written`
- `memory.scene_record.written`
- `memory.reflection.failed`

## R10 Long-Horizon Loop 事件契约

R10 之后，Executive tool loop 的超长线暂停/恢复通过两类事件暴露：

### `cttl.long_horizon_loop.paused`

触发时机：

- 工具预算耗尽
- loop guard 阻断了当前 step 的全部工具调用

payload 约定：

```json
{
  "askId": "ask-1",
  "loopGuardReason": "unknown-tool-repeat",
  "stepCount": 2,
  "toolBudgetExhausted": false
}
```

### `cttl.long_horizon_loop.resumed`

触发时机：

- 用户回答上一轮 pending ask，runtime 把它记为 `ask-answer-pair`

payload 约定：

```json
{
  "askId": "ask-1"
}
```

说明：

- 这两个事件只表达 loop 生命周期，不重复携带 reply 文本。
- 具体恢复策略仍以本轮新的 `gateway.message.send` 输入为准。
- 恢复是“显式继续”，不是后台自动续跑。

## 与 WS 协议的关系

- 事件流：`event.publish.payload.event`
- ask/todo/data：走 `turn.final.reply.metadata`
- long-horizon loop snapshot：走 `turn.final.reply.metadata.executiveToolLoop`

也就是说：

- 想做时间线或审计面板，看事件流。
- 想做当前轮 UI 状态恢复，看 `turn.final.reply.metadata.executiveToolLoop`。

## Rust 侧最小读取建议

1. 订阅 `event.publish`。
2. 对 `RuntimeEvent.type` 做固定映射，不看用户文本。
3. 对 R10 关注：
   - `cttl.long_horizon_loop.paused`
   - `cttl.long_horizon_loop.resumed`
   - `cttl.loop.guard.blocked`
4. 如果当前轮 `turn.final.reply.metadata.executiveToolLoop` 存在，就把它当成当前 pending loop snapshot。
