# Runtime Events

## 一句话定位

`src/events` 是 Flyflor 的 RECL / Event Fabric：所有交互、状态变化、副作用、审计和控制面可见事实都通过结构化 RuntimeEvent 发布，再由 gateway、WS、TUI、审计 sink、workflow handler 和未来外部 TUI 仓库订阅。

## 分层位置

Event Fabric 和 `src/agent` 同级，语义上高于 `src/agent/gateway`：

- `src/events` 拥有 bus、component、classifier、sink、hook 注册和 event helper。
- `src/protocol` 只拥有可 JSON 序列化的 contracts、enums、control envelope 和 process envelope。
- `src/agent/gateway` 只是事件参与者：它可以发布 channel / gateway 事件，也可以把订阅到的 RuntimeEvent 转成 control envelope。
- `src/command/tui` 只是当前内置消费端；后续独立 TUI 仓库只依赖 event/control transport，不 import runtime、gateway、memory 私有实现。

```text
src/
  events/
    component.ts
    bus.ts
    classifier.ts
    runtime.event.ts
    sinks.ts
    types.ts
    index.ts
  protocol/
    contracts/
    control/
    processes/
```

## 事件分类

事件分类用于订阅、展示、审计和 workflow control，不用于业务语义判断。

| Class | 用途 |
| --- | --- |
| `read` | 读取、召回、列表、状态快照 |
| `write` | 写入、记录、升格、固化、归档 |
| `ask` | Ask 记录、回答、链路 cap |
| `question` | 需要用户确认或外部选择 |
| `effect` | 工具、shell、插件、MCP、channel 投递等副作用 |
| `control` | gateway、runtime、worker、channel 控制动作 |
| `error` | 显式失败、拒绝、异常边界 |
| `lifecycle` | start/end/enter/awaken 等生命周期 |
| `performance` | 性能指标、耗时、cache 命中 |

## 红线

- Event payload 必须 JSON 可序列化，不能携带 class instance、function、stream、socket 或密钥。
- 事件不能驱动业务语义判断；语义判断只消费模型同轮结构化字段、专用提示词 JSON 输出或数值资源指标。
- Gateway 不拥有事件总线；它只能订阅 Event Fabric，并把事件转成 control/event transport。
- TUI 不依赖 runtime 私有类；内置 TUI 和未来外部 TUI 仓库都应消费 event/control transport。
- 新增事件类型先放协议枚举或本层 registry，再由 `src/events` 分类和 fan-out。

## 验收

- `bun run docs:check`
- `bun run check`
- `bun test tests/event.component.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts`
- 高风险迁移后跑完整 `bun test` 和 `bun run build:binary`
