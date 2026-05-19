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

## 外部协议主干

外部客户端只依赖 Gateway Control / Event Transport，不 import runtime、gateway 或 memory 内部类。协议入口是 `/ws`，Envelope 来自 `src/protocol/control/envelope.ts`。当前内置 CLI/TUI 的本地运行态访问只允许集中在 `src/command/runtime.adapter.ts` 与 `src/command/state.adapter.ts`；若后续替换成 control/ws client，只能替换这两个 adapter。

外部协议只需要记住五类主干消息：

| 主干 | 方向 | 用途 |
| --- | --- | --- |
| `gateway.message.send` | client → server | 发起一轮用户输入；payload 归一成 `GatewayMessage` |
| `turn.delta` / `turn.final` / `turn.error` | server → client | 当前轮的可见输出流、最终回复和失败 |
| `event.subscribe` / `event.publish` | 双向 | 订阅并推送结构化 `RuntimeEvent` |
| `gateway.status.get` / `gateway.status.snapshot` | 双向 | 读取 channel / gateway 状态 |
| `capability.catalog.get` / `capability.catalog.snapshot` | 双向 | 读取最近一次 Executive 能力目录快照 |

其他 `client.hello`、`server.hello`、`ack`、`error`、`ping`、`pong` 只是控制面握手和健康检查。

### Envelope

所有控制消息都使用同一个 envelope：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-1",
  "type": "event.subscribe",
  "at": "2026-05-18T00:00:00.000Z",
  "requestId": "req-1",
  "correlationId": "env-0",
  "payload": {}
}
```

字段约定：

| 字段 | 约定 |
| --- | --- |
| `protocol` | 控制面固定为 `flyflor.ws.v1`；事件推送 envelope 固定为 `flyflor.event.v1` |
| `id` | envelope id，由发送方生成 |
| `type` | `GatewayControlMessageType` 中的字符串 |
| `at` | ISO 时间 |
| `requestId` | 可选，一轮 turn 的关联 id |
| `correlationId` | 可选，响应或 ack 指向的请求 envelope id |
| `payload` | JSON object；不能携带二进制、函数、stream 或密钥 |

### 发送消息

客户端发起一轮：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-send-1",
  "type": "gateway.message.send",
  "at": "2026-05-18T00:00:00.000Z",
  "payload": {
    "text": "阅读当前项目并总结风险",
    "chatId": "local",
    "user": { "id": "yi" },
    "context": {
      "activeProject": {
        "id": "flyflor",
        "projectDir": "/workspace/flyflor",
        "projectMemoryDir": "/workspace/flyflor/.flyflor/memory"
      },
      "contextForkId": "fork-1",
      "skillNames": ["code-review"]
    }
  }
}
```

`context` 只接受结构化 project/fork/skill scope。`activeProject` 必须携带 `id`、`projectDir` 和 `projectMemoryDir`；只传 project id 不会让 core 从 cwd、历史 UI 状态或自然语言隐式猜测项目。

### 订阅事件

推荐外部客户端先按 `requestId` 订阅当前 turn，再按少量核心事件 type 订阅全局状态：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-sub-1",
  "type": "event.subscribe",
  "at": "2026-05-18T00:00:00.000Z",
  "payload": {
    "requestId": "req-1",
    "types": [
      "mcp.tool.catalog.built",
      "mcp.tool.call.executed",
      "cttl.loop.guard.blocked",
      "sandbox.tool.approval.requested",
      "sandbox.tool.approval.denied",
      "agent.turn.end"
    ]
  }
}
```

服务端推送事件：

```json
{
  "protocol": "flyflor.event.v1",
  "id": "event-env-1",
  "type": "event.publish",
  "at": "2026-05-18T00:00:00.000Z",
  "requestId": "req-1",
  "payload": {
    "event": {
      "type": "cttl.loop.guard.blocked",
      "at": "2026-05-18T00:00:01.000Z",
      "requestId": "req-1",
      "payload": {
        "server": "workspace",
        "tool": "read",
        "reason": "failed-call-repeat",
        "message": "Executive loop stopped repeated failed call workspace.read."
      }
    }
  }
}
```

## 核心 RuntimeEvent

内部事件可以很多，但外部客户端第一阶段只需要关心少量主事件：

| Event type | Class | 何时出现 |
| --- | --- | --- |
| `agent.turn.start` / `agent.turn.end` | lifecycle | 一轮开始 / 结束 |
| `cttl.capability.catalog.built` | read | 本轮通用 capability plan 已生成 |
| `mcp.capability.catalog.built` | read | 本轮 MCP tools/resources/prompts capability plan 已生成 |
| `mcp.tool.catalog.built` | read | 本轮可见工具列表与 hidden diagnostics 已生成 |
| `mcp.tool.call.executed` | effect | MCP/workspace/git/shell/user/plugin 工具执行完成或失败 |
| `cttl.loop.guard.blocked` | effect | Executive 阻断重复、unknown 或超预算工具调用 |
| `sandbox.tool.approval.requested` / `sandbox.tool.approval.denied` | question / error | 高风险能力需要审批或被拒绝 |
| `memory.ask.recorded` / `blackboard.decision.requested` | ask / question | 需要用户补充信息或黑板需要决策 |
| `gateway.message.received` / `channel.error` | control / error | channel 入站与 channel 错误 |
| `perf.*` | performance | 延迟、prompt 构建、route 等性能指标 |

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

`cttl.loop.guard.blocked` 属于 `effect`：它表示工具回路被 Executive 阻断，payload 包含 `server`、`tool`、`reason`、`message`。事件消费者可以展示或审计它，但不能把它当成业务意图判断输入。事件名暂保留 `cttl.*` 前缀，直到 P1 目录迁移统一重命名。

`cttl.capability.catalog.built` 是通用外骨架发现事件。payload 是最近一次 Executive 能力目录快照：只包含已过滤后的 descriptor 摘要、hidden diagnostics、失败/stale source 与 totals；resources/prompts 的正文、user tool executor 命令、plugin 执行参数、密钥和 runtime 私有对象不会出现在该事件中。WS 客户端也可以发送 `capability.catalog.get`，由 control hub 返回最近一次 `capability.catalog.snapshot`；尚未发生 turn 时 catalog 为 `null`。事件名暂保留 `cttl.*` 前缀，直到 P1 目录迁移统一重命名。

`mcp.capability.catalog.built` 是兼容事件，保留 MCP tools/resources/prompts 名称、hidden diagnostics、失败/stale server 与来源统计。外部 TUI、WS 客户端和 channel adapter 可以用它展示 MCP 细节，但具体读取 resource 或获取 prompt 必须再走显式受控 API。

MCP resource/prompt 读取不是 prompt 自动注入，也不是 Runtime 私有直连。当前受控入口由 `RuntimeMcpCapabilityReader` 承担：先用本轮 capability catalog 重新计算可见 plan，再走 sandbox/approval gate，最后才调用 MCP transport。读取失败、不可见或未获批必须抛出或通过事件暴露，不能静默降级成空正文。

`sandbox.tool.approval.denied` 同时覆盖普通拒绝与审批回调异常。普通拒绝 payload 使用 `reason: "approval-denied"`；审批函数抛错或 rejected promise 时使用 `reason: "approval-error"`，并附 `approvalError` 字段。调用方收到的 gate reason 会保留失败信息，例如 `mcp-tool approval failed: <message>`，方便 TUI/审计区分“用户拒绝”和“审批链路坏了”。

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
