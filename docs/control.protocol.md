# Control Protocol

## 一句话定位

`src/protocol/control` 是 Flyflor 主线唯一保留的 WS/control 血管协议层。

- Gateway 只负责 WebSocket 生命周期、鉴权、收发和事件扇出。
- 协议语义冻结在 `src/protocol/control/*`。
- Rust CLI / Gateway / TUI 和 DIY client 未来都应直接对接这层协议，不再依赖 Bun runtime 内部结构。

## 相关代码

- `src/protocol/control/envelope.ts`
- `src/protocol/control/component.ts`
- `src/protocol/contracts/enums.ts`
- `src/agent/gateway/control.ts`

## 设计边界

- 只使用 JSON envelope，不引入私有二进制 framing。
- 只保留通用 WebSocket 流交互，不固化第一方 CLI/TUI/channel adapter 细节。
- `RuntimeEvent` 是 event 血管的唯一事实来源。
- `ask`、`todo`、`data` 是稳定语义 lane，不要求每个 lane 现在就有单独 transport message。
- 当前主线约定：`ask`、`todo`、大部分 `data` 会附着在 `turn.final.reply.metadata` 或专用 snapshot message 中传输。

## Protocol Id

WS control envelope:

```json
"protocol": "flyflor.ws.v1"
```

Runtime event envelope:

```json
"protocol": "flyflor.event.v1"
```

## Stable Semantic Lanes

Rust 或其他 thin client 应先看 semantic lane，再决定 UI 或状态机行为。

| lane | 作用 | 当前主要 transport |
| --- | --- | --- |
| `input` | 客户端发起一轮输入 | `gateway.message.send` |
| `stream` | 服务端流式回复 | `turn.delta` `turn.final` `turn.error` |
| `event` | 事件广播与订阅控制 | `event.publish` `event.subscribe` `event.unsubscribe` |
| `ask` | 服务端要求用户补回答案 | 当前附着在 `turn.final.reply.metadata.ask` |
| `todo` | 结构化任务计划与进度 | 当前附着在 `turn.final.reply.metadata.planning.taskPlans` |
| `data` | 只读状态或上下文快照 | `server.hello` `ack` `gateway.status.snapshot` `capability.catalog.snapshot` 以及 `turn.final.reply.metadata.planning` |
| `error` | 机器可读控制面错误 | `error` |
| `ping` | 心跳请求 | `ping` |
| `pong` | 心跳响应 | `pong` |

## Transport Message

当前冻结的 transport message type：

- `ack`
- `capability.catalog.get`
- `capability.catalog.snapshot`
- `client.hello`
- `error`
- `event.publish`
- `event.subscribe`
- `event.unsubscribe`
- `gateway.message.send`
- `gateway.status.get`
- `gateway.status.snapshot`
- `ping`
- `pong`
- `server.hello`
- `turn.delta`
- `turn.error`
- `turn.final`

说明：

- 当前不新增 `ask.publish`、`todo.publish`、`data.publish` 一类 message type。
- Rust 侧不要假设未来一定会新增这些 type；应以 semantic lane 和 payload shape 为稳定契约。

## Envelope

标准 WS envelope：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-1",
  "type": "gateway.message.send",
  "at": "2026-05-20T10:00:00.000Z",
  "requestId": "client-req-1",
  "correlationId": "optional-parent-envelope-id",
  "payload": {}
}
```

字段约定：

- `id`: 当前 envelope 唯一 id。
- `type`: transport message type。
- `at`: ISO 时间。
- `requestId`: 一轮业务请求关联 id。客户端可传，服务端会沿线透传或回填。
- `correlationId`: 当前 envelope 对应的源 envelope id。服务端响应消息通常会回挂到请求 envelope。

## 握手

服务端在连接打开后立即发送 `server.hello`：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-server-1",
  "type": "server.hello",
  "at": "2026-05-20T10:00:00.000Z",
  "payload": {
    "clientId": "client-1",
    "connectedAt": "2026-05-20T10:00:00.000Z",
    "capabilities": {
      "protocol": "flyflor.ws.v1",
      "eventStream": true,
      "commands": [
        "capability.catalog.get",
        "client.hello",
        "event.subscribe",
        "event.unsubscribe",
        "gateway.status.get",
        "gateway.message.send",
        "ping"
      ],
      "semanticTypes": [
        "input",
        "stream",
        "event",
        "ask",
        "todo",
        "data",
        "error",
        "ping",
        "pong"
      ]
    },
    "kits": {
      "schemaVersion": 1,
      "builtAt": "2026-05-20T10:00:00.000Z",
      "kits": []
    },
    "status": {
      "gatewayRunning": true,
      "host": "127.0.0.1",
      "port": 7777,
      "channels": [],
      "connectedCount": 0,
      "degradedCount": 0,
      "streamingCount": 0
    }
  }
}
```

客户端可选发送 `client.hello`。当前服务端只返回 `ack`，不依赖 `client.hello` 驱动会话状态。

`client.hello` 当前稳定约定：

- 作用是让客户端显式表明自己已经收到 `server.hello`，并可附带 name/version/capabilities 这类只读自报字段。
- 服务端返回 `ack`，其中 `payload.received === "client.hello"`。
- 当前服务端不会因为 `client.hello` 改写连接状态机；Rust / DIY client 不应把它当成必须的第二次握手。

`gateway.status.get` 当前稳定约定：

- 客户端可以在任意时刻主动请求一次连接级状态快照。
- 服务端返回 `gateway.status.snapshot`。
- 该 snapshot 与 `server.hello.payload.status` 同 shape，适合 Rust UI 在连接后主动刷新当前血管状态。

## 输入

客户端输入：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-input-1",
  "type": "gateway.message.send",
  "at": "2026-05-20T10:00:01.000Z",
  "requestId": "client-req-1",
  "payload": {
    "id": "message-1",
    "text": "继续推进项目",
    "chatId": "u-1",
    "threadId": "thread-1",
    "user": {
      "id": "u-1",
      "displayName": "User One"
    },
    "context": {
      "contextForkId": "fork-1",
      "skillNames": ["review"],
      "activeProject": {
        "id": "project-1",
        "projectDir": "/workspace/project",
        "projectMemoryDir": "/workspace/project/.flyflor/memory",
        "title": "Project"
      }
    }
  }
}
```

输入约定：

- `payload.text` 必填。
- `context.activeProject` 必须完整传结构化对象，不能只传 id 让 runtime 猜路径。
- `skillNames` 只按显式结构化名称传递，不做自然语言推断。

## 流式回复

增量：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-delta-1",
  "type": "turn.delta",
  "at": "2026-05-20T10:00:02.000Z",
  "requestId": "runtime-req-1",
  "correlationId": "env-input-1",
  "payload": {
    "messageId": "message-1",
    "delta": "hel"
  }
}
```

结束：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-final-1",
  "type": "turn.final",
  "at": "2026-05-20T10:00:03.000Z",
  "requestId": "runtime-req-1",
  "correlationId": "env-input-1",
  "payload": {
    "reply": {
      "messageId": "message-1",
      "route": {
        "channel": "ws",
        "chatId": "u-1",
        "chatType": "direct"
      },
      "text": "Need confirmation?",
      "metadata": {
        "kind": "ask",
        "behaviorSnapshotId": "snapshot-1",
        "ask": {
          "snapshotId": "snapshot-1",
          "reason": "other",
          "prompt": "Need confirmation?",
          "freeform": true,
          "choiceCount": 1,
          "choices": [
            {
              "label": "Continue",
              "description": "Proceed with the current plan"
            }
          ],
          "questionCount": 0,
          "questions": []
        },
        "planning": {
          "taskPlans": [
            {
              "id": "plan-1",
              "title": "Confirmation",
              "summary": "Need one confirmation step",
              "status": "planned",
              "progress": 0,
              "stepCount": 1,
              "completedStepCount": 0,
              "steps": [
                {
                  "id": "step-1",
                  "title": "Confirm direction",
                  "status": "planned",
                  "order": 0
                }
              ]
            }
          ],
          "contextForks": [],
          "scenes": []
        }
      }
    }
  }
}
```

失败：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-turn-error-1",
  "type": "turn.error",
  "at": "2026-05-20T10:00:03.000Z",
  "requestId": "runtime-req-1",
  "correlationId": "env-input-1",
  "payload": {
    "messageId": "message-1",
    "message": "runtime failed"
  }
}
```

## Ask / Todo / Data 当前发送约定

这是 Rust 对接最关键的部分。

最小读取优先级建议：

1. 先按 semantic lane 处理：`input` / `stream` / `event` / `ask` / `todo` / `data` / `error`。
2. `turn.final` 到达后，先读 `reply.metadata`，不要先解析 `reply.text`。
3. ask UI 优先消费 `reply.metadata.ask`；loop 恢复优先消费 `reply.metadata.executiveToolLoop`。
4. todo / scene / fork 面统一消费 `reply.metadata.planning`，不要另建私有投影协议。

### `ask`

当前不单独发 transport message。

读取位置：

- `turn.final.payload.reply.metadata.kind === "ask"`
- `turn.final.payload.reply.metadata.ask`

含义：

- `kind === "ask"` 说明这轮不是普通 reply，而是要求用户补回答案。
- `ask.prompt` 是当前可见问题主体。
- `ask.reason` 是结构化触发原因。
- `ask.choices`、`ask.questions`、`ask.freeform` 控制 UI 交互方式。
- `ask.executiveToolLoop` 是 ask 绑定的长线 loop snapshot；当 ask 来自 Executive 暂停时一定看这里。
- Rust UI 可以直接把 `ask` 当表单模型，不需要解析 reply 文本。

R10 之后额外约定：

- `turn.final.payload.reply.metadata.executiveToolLoop`
- `turn.final.payload.reply.metadata.ask.executiveToolLoop`

这两个字段表达同一个 snapshot。推荐 Rust / DIY client 优先读取顶层 `metadata.executiveToolLoop`，如果只在 ask 表单组件内消费，也可以直接读 `ask.executiveToolLoop`。

稳定读取顺序：

1. 如果 `reply.metadata.kind === "ask"`，把当前轮视为 ask turn。
2. 读取 `reply.metadata.ask` 作为表单快照。
3. 如果存在 `reply.metadata.executiveToolLoop`，把它视为当前 pending loop 的权威 snapshot。
4. 只有在组件局部只拿到了 ask metadata 时，才回退读 `reply.metadata.ask.executiveToolLoop`。

snapshot 字段：

- `askId`: 当前暂停点 id，也是后续 resume 审计锚点。
- `resume.mode`: 当前固定为 `"continue"`，表示等待用户显式继续。
- `stepCount`: 本轮执行到第几步后暂停。
- `loopGuardReason`: 如果是 guard 阻断导致暂停，这里给出结构化原因。
- `toolBudgetExhausted`: 如果是工具预算耗尽，这里为 `true`。
- `message`: 给客户端展示的机器稳定说明，不要求直接展示给终端用户。
- `stop`: 当前固定为 `"ask"`，表示暂停出口统一回到 ask。

### `todo`

当前也不单独发 transport message。

读取位置：

- `turn.final.payload.reply.metadata.planning.taskPlans`

含义：

- 这是当前 turn 输出的结构化任务计划摘要。
- `taskPlans[].steps` 是可直接渲染的轻量步骤列表。
- 这是只读快照，不是客户端回写协议。
- `planning.contextForks` 与 `planning.scenes` 也属于同一份只读 planning snapshot，应和 `taskPlans` 一起消费，而不是拆成多个自定义 lane。

### `data`

当前分两类：

专用 snapshot message：

- `server.hello.payload.status`
- `gateway.status.snapshot.payload.status`
- `capability.catalog.snapshot.payload.catalog`
- `capability.catalog.snapshot.payload.kits`
- `ack.payload`

附着在 `turn.final` 的轻量数据：

- `turn.final.payload.reply.metadata.planning.contextForks`
- `turn.final.payload.reply.metadata.planning.scenes`
- `turn.final.payload.reply.metadata.planning.taskPlans`

额外约束：

- `server.hello` / `gateway.status.snapshot` / `capability.catalog.snapshot` 是连接级只读 snapshot。
- `turn.final.reply.metadata.planning` 是当前 turn 级只读 snapshot。
- Rust / DIY client 不应假设当前阶段会额外出现 `data.publish` 一类新 transport type。

## Event

订阅：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-sub-1",
  "type": "event.subscribe",
  "at": "2026-05-20T10:00:00.000Z",
  "payload": {
    "requestId": "runtime-req-1",
    "types": ["gateway.message.received"],
    "classes": ["gateway"]
  }
}
```

广播：

```json
{
  "protocol": "flyflor.event.v1",
  "id": "event-1",
  "type": "event.publish",
  "at": "2026-05-20T10:00:04.000Z",
  "requestId": "runtime-req-1",
  "payload": {
    "event": {
      "type": "gateway.message.received",
      "at": "2026-05-20T10:00:04.000Z",
      "requestId": "runtime-req-1",
      "payload": {
        "channel": "ws"
      }
    }
  }
}
```

约定：

- `event.publish` 的 `payload.event` 直接就是 `RuntimeEvent`。
- 订阅过滤只看结构化 `requestId`、`types`、`classes`。
- 事件流用于时间线、审计和观察；当前轮 ask/todo/loop 恢复仍以 `turn.final.reply.metadata` 为准。

`event.subscribe` / `event.unsubscribe` 当前稳定约定：

- 成功订阅后服务端返回 `ack`，`payload.subscriptions` 是当前连接生效中的订阅列表快照。
- 成功取消订阅后服务端同样返回 `ack`，并回传更新后的 `payload.subscriptions`。
- 过滤只使用 `requestId`、`types`、`classes` 这三个结构化字段；客户端不应使用文本或 message label 做事件筛选。

## Snapshot Matrix

Rust / DIY client 应把当前协议面拆成三层读取，不要混用：

| 层级 | 主要来源 | 读取位置 | 性质 | 用途 |
| --- | --- | --- | --- | --- |
| 连接级 snapshot | `server.hello` `gateway.status.snapshot` `capability.catalog.snapshot` `ack` | `payload.status` `payload.capabilities` `payload.kits` `payload.catalog` `payload.subscriptions` | 只读连接态 | 握手、连接状态、kit/capability 目录、订阅状态 |
| turn 级 snapshot | `turn.final` | `reply.metadata.ask` `reply.metadata.planning` `reply.metadata.executiveToolLoop` | 只读当前轮结果 | ask UI、todo/fork/scene 展示、long-horizon loop 恢复 |
| 事件流 | `event.publish` | `payload.event` | 只读时间线 | 审计、观察、恢复提示、进度广播 |

硬约束：

- 连接级 snapshot 不能替代 `turn.final.reply.metadata`。
- 事件流不能替代 ask/todo/loop 的权威恢复入口。
- 客户端不回写任何 snapshot；新的用户动作一律通过 `gateway.message.send` 进入下一轮。

## Error

控制面错误统一走 `error` transport message，当前稳定错误码：

- `internal`
- `invalid-envelope`
- `invalid-payload`
- `unauthorized`
- `unsupported-message`

读取约定：

- 客户端应先读 `payload.code` 做机器分支。
- `payload.message` 只作为展示或日志信息，不应用于业务判断。
- `payload.details` 是调试辅助字段，可选。
- `turn.error` 属于 `stream` lane，表示一轮生成失败；`error` 属于 `control` 面错误，表示协议、鉴权或控制命令失败。

## Rust 最小接线清单

Rust CLI / Gateway / TUI 的最小主循环建议固定为：

1. 连接 `/ws`，接收 `server.hello`。
2. 把 `server.hello.payload.status`、`server.hello.payload.capabilities`、`server.hello.payload.kits` 缓存成连接级 data snapshot。
3. 发送 `gateway.message.send` 时附带结构化 `requestId`。
4. 消费 `turn.delta` 渲染流式文本。
5. 消费 `turn.final.reply.metadata.ask`、`turn.final.reply.metadata.planning`、`turn.final.reply.metadata.executiveToolLoop` 做 UI 状态恢复。
6. 订阅 `event.publish`，用 `RuntimeEvent.type` 做时间线、审计和恢复提示。
7. 消费 `error.payload.code` 做机器分支，不读 reply 文本猜测失败类型。
8. 不做关键词、文本片段、消息正文匹配。

R10 事件补充：

- `cttl.long_horizon_loop.paused`: Executive 工具回路被预算上限或 loop guard 暂停。
- `cttl.long_horizon_loop.resumed`: 用户回答 pending ask，runtime 记录恢复锚点。
- `cttl.loop.guard.blocked`: 单次工具调用被 loop guard 阻断。

## Ping / Pong

客户端可发送：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-ping-1",
  "type": "ping",
  "at": "2026-05-20T10:00:00.000Z"
}
```

服务端返回：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-pong-1",
  "type": "pong",
  "at": "2026-05-20T10:00:00.100Z",
  "correlationId": "env-ping-1",
  "payload": {
    "now": "2026-05-20T10:00:00.100Z"
  }
}
```

## Rust 客户端最小处理流程

建议 Rust 侧按下面顺序处理：

1. 先解析 envelope。
2. 检查 `protocol` 是否为 `flyflor.ws.v1` 或 `flyflor.event.v1`。
3. 对 `type` 运行 `classifyGatewayControlSemanticType(...)` 的同等逻辑。
4. 先按 semantic lane 路由：
   - `stream` 进回复流状态机
   - `event` 进事件订阅总线
   - `error` 进控制面错误处理
   - `ask` 从 `turn.final.reply.metadata.ask` 取结构化表单
   - `todo` 从 `turn.final.reply.metadata.planning.taskPlans` 取计划快照
   - `data` 从 hello/status/catalog/ack 或 `planning` 取只读快照
5. 只有当 lane 内需要更细分行为时，再看具体 transport message。

## 为什么继续使用 WebSocket

当前判断是：够用，而且更合适。

- 全双工流交互简单直接，天然适合 `input` + `turn.delta` + `turn.final`。
- 浏览器、桌面端、服务端、Rust 生态都通用。
- DIY client 接入门槛低，不需要额外 broker 或二进制协议栈。
- `event`、`ask`、`todo`、`data` 都能在同一连接上复用 envelope。

当前主线没有证据表明需要换成其他协议。只有在以下情况才值得评估别的方案：

- 需要跨数据中心高扇出广播总线
- 需要严格 backpressure / multiplexing / binary frame 优化
- 需要和现有 gRPC-only 基础设施强集成

在现阶段，WebSocket 的性能和复杂度比最合适。

## 红线

- 不把 Bun `ServerWebSocket`、HTTP handler 或 runtime 细节塞进 protocol 层。
- 不把第一方 CLI/TUI/channel adapter 行为重新写回主线协议。
- 不在协议层做字符匹配或关键词语义判断。
- 新增 payload 时，先改 `src/protocol/control/*`、测试、文档，再改 transport owner。
