# WebSocket API

## 一句话定位

本文是 Flyflor 当前主线 `/ws` 血管协议的详细 API 文档。

它只描述真实已实现的 WebSocket surface：

- 连接地址
- envelope 结构
- message type
- 请求/响应顺序
- 错误码
- 当前 `turn.final` 中 ask/todo/data 的读取方式
- 对应源码与单元测试位置

如果你在调 Rust CLI / TUI / socket shell，这份文档应该比 `control.protocol.md` 更像直接可用的接口手册。

## 相关代码

核心实现：

- `src/socket/module.ts`
- `src/socket/control.ts`
- `src/protocol/control/envelope.ts`
- `src/protocol/control/component.ts`
- `src/protocol/contracts/enums.ts`

关键测试：

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.module.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`

## HTTP Surface

Socket 当前只暴露两个 HTTP 路径：

| Path | Method | 作用 | 代码 | 测试 |
| --- | --- | --- | --- | --- |
| `/ws` | `GET` | WebSocket upgrade | `src/socket/module.ts` | `tests/gateway.module.test.ts` |
| `/health` | `GET` | 健康检查 | `src/socket/module.ts` | `tests/gateway.module.test.ts` |

### `GET /health`

响应：

```json
{
  "ok": true
}
```

参考：

- `tests/gateway.module.test.ts` `GET /health returns ok without runtime involvement`

### `GET /ws`

行为：

- 若 SocketControlHub 未准备好，返回 `503`
- 若准备好，执行 WebSocket upgrade

未就绪响应：

```json
{
  "error": "gateway_control_not_ready"
}
```

参考：

- `tests/gateway.module.test.ts` `GET /ws returns 503 before SocketControlHub is started`

## Protocol Id

当前稳定 protocol id 只有两个：

### 控制面 envelope

```json
"protocol": "flyflor.ws.v1"
```

### 事件广播 envelope

```json
"protocol": "flyflor.event.v1"
```

代码：

- `src/protocol/contracts/enums.ts`
- `src/protocol/control/envelope.ts`

测试：

- `tests/protocol.control.test.ts` `roundtrips a typed ws envelope`
- `tests/protocol.control.test.ts` `rejects unknown control protocol versions`

## Message Types

当前稳定 transport message type：

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
- `ask.detail.get`
- `ask.list`
- `ask.snapshot`
- `blackboard.detail.get`
- `blackboard.list`
- `blackboard.snapshot`
- `crystal.list`
- `crystal.snapshot`
- `fork.create`
- `fork.detail.get`
- `fork.list`
- `fork.snapshot`
- `history.detail.get`
- `history.list`
- `history.snapshot`
- `replay.detail.get`
- `replay.list`
- `replay.snapshot`
- `scope.detail.get`
- `scope.list`
- `scope.snapshot`
- `ping`
- `pong`
- `server.hello`
- `task.detail.get`
- `task.list`
- `task.snapshot`
- `thought.detail.get`
- `thought.snapshot`
- `turn.delta`
- `turn.error`
- `turn.final`

代码：

- `src/protocol/contracts/enums.ts`

## 历史对话列表获取

`/ws` 现在已经正式提供只读历史查询：

- `history.list`
- `history.snapshot`

这条接口的职责非常薄：

- socket 接收分页参数
- socket 直接调用 `src/socket/query` 只读 DB/read-model 层
- socket 返回稳定 JSON 快照

`clientCount` 是 live peer count，只描述当前 WS hub 的实时连接压力，不是静态 channel 数，也不应和 `connectedCount` 混成一回事。

它不是新的思考逻辑，也不是新的会话层。
它只是血管层把已存在的持久化历史暴露出来。

### 当前读法

当前历史对话读取入口：

- `src/socket/query/component.ts` `historyList({ beforeTs?, limit?, scopeId?, contextForkId? })`
- `src/socket/query/brain.reader.ts` `listHistory(...)`

它实际做的是：

1. 从 `brain.db.memory_events` 读取：
   - `type = "event"`
   - `ts <= beforeTs`（如果传了）
   - `ORDER BY ts DESC`
   - `LIMIT ?`
2. 再按 `sourceEventId = event.id` 回查：
   - `task_plans`
   - `replay_records`
   - `context_forks`
3. 最后把结果 reverse 成按时间正序返回

对应代码：

- `src/socket/query/component.ts`
- `src/socket/query/brain.reader.ts`
- `src/socket/query/blackboard.reader.ts`
- `src/socket/query/scope.reader.ts`
- `src/socket/query/crystal.reader.ts`
- `src/entities/memory/brain/event/repo.ts` `list(...)`
- `src/cognitive/hippocampus/memory/history/turn.ts` `historyTurnFromEvent(...)`
- `src/socket/control.ts` `handleHistoryList(...)`
- `src/protocol/control/envelope.ts` `readGatewayControlHistoryListInput(...)`
- `src/protocol/control/envelope.ts` `buildGatewayControlHistorySnapshotPayload(...)`

### 当前返回 shape

内核当前组装后的历史对象 shape：

```ts
interface ChatHistoryTurn {
  assistantText: string;
  eventId: string;
  contextForks?: ContextForkRecord[];
   replays?: ReplayRecord[];
  taskPlans?: TaskPlanRecord[];
  ts: number;
  userText: string;
}
```

关键点：

- `userText` 来自 `memory_events.content.userText`
- `assistantText` 来自 `memory_events.content.assistantText`
- 任一字段缺失会直接抛错
- `taskPlans` / `replays` / `contextForks` 都是按 `sourceEventId = event.id` 补挂上去

### SQL 语义

`memory_events` 当前实际分页语义来自 `BrainEventRepo.list(...)`：

```sql
SELECT e.*
FROM memory_events e
LEFT JOIN memory_state s ON s.event_id = e.id
WHERE (? IS NULL OR e.type = ?)
  AND (? IS NULL OR e.ts <= ?)
ORDER BY e.ts DESC
LIMIT ?
```

历史对话读取时额外固定：

- `type = "event"`
- `limit = 默认 20`

再回查 planning 元数据：

- `brain.listTaskPlans({ sourceEventId, limit: 8 })`
- `brain.listReplayRecords({ sourceEventId, limit: 16 })`
- `brain.listContextForks({ sourceEventId, limit: 8 })`

### 当前测试覆盖

这条 db 读法当前有明确测试：

- `tests/tui.chat.history.test.ts` `lists chat turns chronologically and pages older turns by timestamp`
- `tests/tui.chat.history.test.ts` `throws when a persisted chat history event is malformed`
- `tests/tui.chat.history.test.ts` `includes persisted planning metadata for history side-panel replay`
- `tests/tui.chat.history.test.ts` `persists deep-think history data for future TUI ask-loop rendering`
- `tests/tui.chat.history.test.ts` `persists blackboard replay data for future TUI discussion rendering`
- `tests/gateway.ws.test.ts` `serves DB-backed query snapshots without dispatching a live turn`

## TUI 只读查询面

除 `gateway.message.send` 之外，TUI 展开区需要的数据都走只读 query 命令。原则：

- 能查 DB 的只查 DB。
- query 命令不调用 RuntimeModule、MemoryModule prompt 装配、模型或工具。
- live 输入输出只有 `gateway.message.send -> turn.delta/turn.final/turn.error` 会进入智能体核心。
- `event.publish` 是血管事件流；历史详情、黑板、深度思考、ASK、fork、scope、task、replay 详情由 query snapshot 补齐。

当前已实现命令：

| 请求 | 响应 | 数据来源 | 用途 |
| --- | --- | --- | --- |
| `history.list` | `history.snapshot` | `brain.db.memory_events` + planning 表 | 对话列表 |
| `history.detail.get` | `history.snapshot` | `brain.db` + blackboard DB | 单轮输入输出详情 |
| `scope.list` / `scope.detail.get` | `scope.snapshot` | `brain.db.scopes` + scope-local `scope.db` | Scope 列表、热区记忆、记忆树、关联词 |
| `fork.list` / `fork.detail.get` | `fork.snapshot` | `brain.db.context_forks` | fork 列表、继承事件、关联 ask/task/replay |
| `ask.list` / `ask.detail.get` | `ask.snapshot` | `brain.db.memory_events` ask/answer-pair/state | ASK 当前状态、幽灵续接、回答记录 |
| `blackboard.list` / `blackboard.detail.get` | `blackboard.snapshot` | blackboard SQLite 表 | 黑板 turn、消息、步骤、决策 |
| `task.list` / `task.detail.get` | `task.snapshot` | `brain.db.task_plans` | TODO/计划展开 |
| `replay.list` / `replay.detail.get` | `replay.snapshot` | `brain.db.replay_records` | 深度思考/黑板/replay 摘要 |
| `thought.detail.get` | `thought.snapshot` | `brain.db` structured event/replay | 深度思考可见摘要，不暴露隐藏 CoT |
| `crystal.list` | `crystal.snapshot` | `crystal.db.crystal_gems` | 晶体记忆浏览 |

所有通用 query snapshot 使用：

```json
{
  "payload": {
    "data": {}
  }
}
```

list 命令的 `data` 是数组；detail 命令的 `data` 是对象或 `null`。

## Detail Query Envelope Matrix

所有 `*.detail.get` 都是只读 query/read-model 命令。请求 `payload` 只携带结构化 id，不进入
Runtime，不触发模型、工具、记忆装配或上下文推断。响应统一使用对应 `*.snapshot` envelope，
并把详情对象放在 `payload.data`；查不到时 `payload.data` 为 `null`。

### `fork.detail.get -> fork.snapshot`

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-fork-detail-1",
  "type": "fork.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-fork-detail-1",
  "payload": {
    "forkId": "fork-1"
  }
}
```

响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-fork-snapshot-1",
  "type": "fork.snapshot",
  "at": "2026-05-22T00:00:05.350Z",
  "requestId": "req-fork-detail-1",
  "correlationId": "env-fork-detail-1",
  "payload": {
    "data": {
      "fork": { "id": "fork-1", "title": "Replay fork" },
      "inheritedEvents": [],
      "asks": [],
      "taskPlans": [],
      "replays": []
    }
  }
}
```

### `ask.detail.get -> ask.snapshot`

请求 `payload.askId`：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-ask-detail-1",
  "type": "ask.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-ask-detail-1",
  "payload": {
    "askId": "ask-1"
  }
}
```

响应 `payload.data` 是 `SocketAskSnapshot`：

```json
{
  "type": "ask.snapshot",
  "requestId": "req-ask-detail-1",
  "correlationId": "env-ask-detail-1",
  "payload": {
    "data": {
      "status": "active",
      "ask": { "reason": "other", "prompt": "Need confirmation?", "freeform": true },
      "event": { "id": "ask-1", "type": "ask" }
    }
  }
}
```

### `blackboard.detail.get -> blackboard.snapshot`

请求 `payload.blackboardTurnId`，响应 `payload.data` 包含 `turn`、`asks`、`forks`、`replays`
和 `taskPlans`。

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-blackboard-detail-1",
  "type": "blackboard.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-blackboard-detail-1",
  "payload": {
    "blackboardTurnId": "bb-1"
  }
}
```

```json
{
  "type": "blackboard.snapshot",
  "requestId": "req-blackboard-detail-1",
  "correlationId": "env-blackboard-detail-1",
  "payload": {
    "data": {
      "turn": { "id": "bb-1", "status": "converged" },
      "asks": [],
      "forks": [],
      "replays": [],
      "taskPlans": []
    }
  }
}
```

### `thought.detail.get -> thought.snapshot`

请求 `payload.eventId`。响应只暴露安全摘要，`summary.hiddenChainOfThought` 固定为 `false`，
不暴露隐藏推理正文。

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-thought-detail-1",
  "type": "thought.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-thought-detail-1",
  "payload": {
    "eventId": "event-1"
  }
}
```

```json
{
  "type": "thought.snapshot",
  "requestId": "req-thought-detail-1",
  "correlationId": "env-thought-detail-1",
  "payload": {
    "data": {
      "event": { "id": "event-1", "type": "event" },
      "summary": {
        "hiddenChainOfThought": false,
        "content": { "summary": "Safe thought summary for TUI expansion." }
      },
      "forks": [],
      "replays": [],
      "taskPlans": []
    }
  }
}
```

### `replay.detail.get -> replay.snapshot`

请求 `payload.replayId`，响应 `payload.data` 包含 `replay`、可选 `sourceEvent`、可选
`taskPlan`、`asks` 和 `forks`。

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-replay-detail-1",
  "type": "replay.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-replay-detail-1",
  "payload": {
    "replayId": "replay-1"
  }
}
```

```json
{
  "type": "replay.snapshot",
  "requestId": "req-replay-detail-1",
  "correlationId": "env-replay-detail-1",
  "payload": {
    "data": {
      "replay": { "id": "replay-1", "kind": "blackboard", "title": "Replay" },
      "sourceEvent": { "id": "event-1", "type": "event" },
      "asks": [],
      "forks": []
    }
  }
}
```

### `task.detail.get -> task.snapshot`

请求 `payload.taskPlanId`，响应 `payload.data` 包含 `taskPlan`、`asks`、`forks`、`replays`
和可选 `sourceEvent`。

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-task-detail-1",
  "type": "task.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-task-detail-1",
  "payload": {
    "taskPlanId": "task-plan-1"
  }
}
```

```json
{
  "type": "task.snapshot",
  "requestId": "req-task-detail-1",
  "correlationId": "env-task-detail-1",
  "payload": {
    "data": {
      "taskPlan": { "id": "task-plan-1", "title": "Socket closure", "status": "in-progress" },
      "asks": [],
      "forks": [],
      "replays": []
    }
  }
}
```

### `history.detail.get -> history.snapshot`

请求 `payload.eventId`。实际响应类型是 `history.snapshot`，但 detail 响应走通用 query
shape：`payload.data` 是详情对象，不是 `history.list` 使用的 `payload.history` 数组。

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-history-detail-1",
  "type": "history.detail.get",
  "at": "2026-05-22T00:00:05.300Z",
  "requestId": "req-history-detail-1",
  "payload": {
    "eventId": "event-1"
  }
}
```

```json
{
  "type": "history.snapshot",
  "requestId": "req-history-detail-1",
  "correlationId": "env-history-detail-1",
  "payload": {
    "data": {
      "turn": {
        "eventId": "event-1",
        "userText": "继续推进 socket 血管层",
        "assistantText": "我会按 Scope 和当前上下文继续推进。"
      },
      "event": { "id": "event-1", "type": "event" },
      "asks": [],
      "taskPlans": [],
      "replays": [],
      "thoughtAvailable": true
    }
  }
}
```

## `fork.create`

`fork.create` 是状态变更 control command，不是只读 query。它只在 `src/socket/control.ts`
处理 wire 校验、owner key 归属和 `controlState.activeFork` 更新，然后通过注入回调调用
`RuntimeModule.createContextFork(...)` 完成持久化。它不会把 TUI 专用逻辑塞进
`RuntimeModule.handleMessage`，也不会从 `conversationKey`、`threadId`、`user.id` 或
`clientId` 推断认知 owner。

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-fork-create-1",
  "type": "fork.create",
  "at": "2026-05-22T00:00:05.320Z",
  "requestId": "req-fork-create-1",
  "payload": {
    "title": "TUI fork title",
    "summary": "summary from selected turn",
    "continuitySummary": "summary for future context",
    "parentId": "current-fork-id-if-any",
    "scopeId": "scope-1",
    "maxContextTokens": 12000,
    "inheritedEventIds": ["source-event-id"],
    "sourceEventId": "source-event-id",
    "sourceAskId": "source-ask-id",
    "sourceBlackboardTurnId": "blackboard-turn-id",
    "context": {
      "contextForkId": "current-active-fork-id",
      "activeScope": {
        "id": "scope-1",
        "projectDir": "/workspace/project",
        "projectMemoryDir": "/workspace/project/.flyflor/memory",
        "title": "Socket Contract Scope"
      }
    }
  }
}
```

owner key 规则：

- 有 `scopeId` 或 `context.activeScope.id` 时，使用 `scope:<scopeId>`。
- 否则有 `parentId` 或 `context.contextForkId` 时，使用 `fork:<id>`。
- 否则使用 `turn:<requestId>`；没有 `requestId` 时由内核生成 turn-local id。

响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-fork-snapshot-1",
  "type": "fork.snapshot",
  "at": "2026-05-22T00:00:05.420Z",
  "requestId": "req-fork-create-1",
  "correlationId": "env-fork-create-1",
  "payload": {
    "data": {
      "fork": {
        "id": "fork-created",
        "ownerKey": "scope:scope-1",
        "scopeId": "scope-1",
        "parentId": "current-fork-id-if-any",
        "title": "TUI fork title",
        "summary": "summary from selected turn",
        "continuitySummary": "summary for future context",
        "maxContextTokens": 12000,
        "inheritedEventIds": ["source-event-id"],
        "sourceEventId": "source-event-id",
        "sourceAskId": "source-ask-id",
        "sourceBlackboardTurnId": "blackboard-turn-id",
        "createdAt": "2026-05-22T00:00:05.400Z",
        "updatedAt": "2026-05-22T00:00:05.400Z"
      }
    }
  }
}
```

成功后 `gateway.status.get` 返回的 `gateway.status.snapshot.payload.controlState.activeFork`
会反映最新 active fork。TUI 需要展开详情时继续使用 `fork.detail.get`，该查询仍只读
DB/read-model。

## `history.list`

用途：

- 读取 brain.db 全局 ledger 历史回放
- 按时间戳向更早历史翻页
- 给 Rust TUI / shell / 调试器提供黑板、深度思考、task plan 回放面

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "history-list-1",
  "type": "history.list",
  "at": "2026-05-21T00:00:00.000Z",
  "requestId": "req-history-1",
  "payload": {
    "limit": 20,
    "beforeTs": 1747785600000
  }
}
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `limit` | 否 | 返回条数；不传走内核默认值 |
| `beforeTs` | 否 | 只取 `ts <= beforeTs` 的更早历史 |

错误：

- payload 缺失时返回 `error`，`code=invalid-payload`
- 不存在 `sourceKey` / handshake / scope 参数；历史就是当前 brain ledger 的全局流水账

测试：

- `tests/protocol.control.test.ts` `roundtrips history control messages`
- `tests/protocol.control.test.ts` `rejects invalid message payloads with structured protocol errors`
- `tests/gateway.control.smoke.test.ts` `runs the ws thin-client lifecycle including loop pause-resume and history replay`

## `history.snapshot`

响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "history-snapshot-1",
  "type": "history.snapshot",
  "at": "2026-05-21T00:00:00.100Z",
  "requestId": "req-history-1",
  "correlationId": "history-list-1",
  "payload": {
    "cache": {
      "hit": false,
      "key": "history.list:{\"limit\":20}",
      "ttlMs": 1500
    },
    "nextBeforeTs": 1747785599999,
    "history": [
      {
        "eventId": "event-1",
        "ts": 1747785600000,
        "userText": "hello",
        "assistantText": "hi",
        "taskPlans": [],
        "replays": [],
        "contextForks": [],
        "metadata": {
          "planning": {
            "taskPlans": [],
            "replays": [],
            "contextForks": []
          }
        }
      }
    ]
  }
}
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `history` | 是 | 历史 turn 列表，按时间正序 |
| `nextBeforeTs` | 否 | 下一页建议游标；当前实现为首条记录 `ts - 1` |

当前返回 shape：

```ts
interface HistoryTurnSnapshot {
  assistantText: string;
  eventId: string;
  contextForks?: ContextForkRecord[];
  replays?: ReplayRecord[];
  taskPlans?: TaskPlanRecord[];
  metadata?: {
    planning?: {
      contextForks: GatewayControlContextForkSnapshot[];
      replays: GatewayControlReplaySnapshot[];
      taskPlans: GatewayControlTodoTaskSnapshot[];
    };
  };
  ts: number;
  userText: string;
}
```

`metadata.planning` mirrors the compact `turn.final.reply.metadata.planning` shape for persisted
history turns. It is assembled from stored structured plan/fork/replay records and does not make
`history.list` a session restore or prompt assembly path.

测试：

- `tests/gateway.ws.test.ts` `returns persisted history snapshots through history.list without routing through turn logic`
- `tests/tui.chat.history.test.ts` 全部历史相关测试继续作为数据 shape 守护
- `tests/gateway.control.smoke.test.ts` `runs the ws thin-client lifecycle including loop pause-resume and history replay`

## Semantic Lanes

客户端应该先按 lane 分流，再按具体 message type 细分。

| Lane | 主要 message |
| --- | --- |
| `input` | `gateway.message.send` `fork.create` |
| `stream` | `turn.delta` `turn.final` `turn.error` |
| `event` | `event.publish` `event.subscribe` `event.unsubscribe` |
| `ask` | 当前附着在 `turn.final.reply.metadata.ask` |
| `todo` | 当前附着在 `turn.final.reply.metadata.planning.taskPlans` |
| `data` | `server.hello` `ack` `gateway.status.snapshot` `capability.catalog.snapshot` `history.list` `history.snapshot` `fork.snapshot` |
| `error` | `error` |
| `ping` | `ping` |
| `pong` | `pong` |

代码：

- `src/protocol/control/envelope.ts` `classifyGatewayControlSemanticType(...)`

测试：

- `tests/protocol.control.test.ts` `maps transport messages onto stable semantic lanes for Rust clients`

## Envelope

### 控制面 envelope

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-1",
  "type": "gateway.message.send",
  "at": "2026-05-21T00:00:00.000Z",
  "requestId": "client-req-1",
  "correlationId": "optional-parent-envelope-id",
  "payload": {}
}
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `protocol` | 是 | 必须是 `flyflor.ws.v1` |
| `id` | 是 | 当前 envelope 唯一 id |
| `type` | 是 | transport message type |
| `at` | 是 | ISO 时间 |
| `requestId` | 否 | 客户端业务请求关联 id |
| `correlationId` | 否 | 响应所对应的源 envelope id |
| `payload` | 否 | message 对应负载 |

### 事件 envelope

```json
{
  "protocol": "flyflor.event.v1",
  "id": "event-1",
  "type": "event.publish",
  "at": "2026-05-21T00:00:00.000Z",
  "requestId": "runtime-req-1",
  "payload": {
    "event": {}
  }
}
```

代码：

- `src/protocol/control/envelope.ts`

测试：

- `tests/protocol.control.test.ts` `roundtrips a typed ws envelope`
- `tests/protocol.control.test.ts` `filters event envelopes by explicit subscription`

## 握手流程

当前连接握手顺序：

1. 客户端连接 `ws://host:port/ws`
2. 服务端立即发送 `server.hello`
3. 客户端可选发送 `client.hello`
4. 服务端返回 `ack`
5. 客户端可继续发送 `gateway.status.get`、`capability.catalog.get`、`history.list`、`gateway.message.send`

### 1. `server.hello`

连接一打开，服务端立即发送：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-server-1",
  "type": "server.hello",
  "at": "2026-05-21T00:00:00.000Z",
  "payload": {
    "clientId": "client-1",
    "connectedAt": "2026-05-21T00:00:00.000Z",
    "capabilities": {
      "protocol": "flyflor.ws.v1",
      "eventStream": true,
      "commands": [
        "capability.catalog.get",
        "client.hello",
        "event.subscribe",
        "event.unsubscribe",
        "gateway.status.get",
        "history.list",
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
      "builtAt": "2026-05-21T00:00:00.000Z",
      "kits": [],
      "capabilities": []
    },
    "status": {
      "gatewayRunning": true,
      "host": "127.0.0.1",
      "port": 8788,
      "channels": [],
      "connectedCount": 1,
      "degradedCount": 0,
      "streamingCount": 1
    }
  }
}
```

代码：

- `src/socket/control.ts` `sendServerHello(...)`
- `src/protocol/control/component.ts`

测试：

- `tests/gateway.ws.test.ts` `announces server capabilities on open`
- `tests/protocol.control.test.ts` `keeps server hello as the connection-level bootstrap snapshot`

### 2. `client.hello`

客户端可选发送：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-client-hello-1",
  "type": "client.hello",
  "at": "2026-05-21T00:00:01.000Z",
  "requestId": "probe-hello",
  "payload": {
    "client": {
      "name": "rust-tui",
      "version": "0.1.0"
    }
  }
}
```

注意：

- 当前服务端不会消费 `payload.client` 做状态机修改
- 它只是返回 `ack`

### 3. `ack`

对 `client.hello` 的响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-ack-1",
  "type": "ack",
  "at": "2026-05-21T00:00:01.010Z",
  "requestId": "probe-hello",
  "correlationId": "env-client-hello-1",
  "payload": {
    "clientId": "client-1",
    "received": "client.hello"
  }
}
```

代码：

- `src/socket/control.ts` `handleClientHello(...)`

测试：

- `tests/gateway.ws.test.ts` `client.hello -> ack`

## 状态与 Catalog

### `gateway.status.get`

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-status-1",
  "type": "gateway.status.get",
  "at": "2026-05-21T00:00:02.000Z",
  "requestId": "probe-status",
  "payload": {}
}
```

响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-status-snapshot-1",
  "type": "gateway.status.snapshot",
  "at": "2026-05-21T00:00:02.010Z",
  "requestId": "probe-status",
  "correlationId": "env-status-1",
  "payload": {
    "cache": {
      "hit": false,
      "key": "gateway.status.get:{}",
      "ttlMs": 1500
    },
    "status": {
      "gatewayRunning": true,
      "host": "127.0.0.1",
      "port": 8788,
      "url": "http://127.0.0.1:8788/",
      "startedAt": "2026-05-21T00:00:00.000Z",
      "uptimeMs": 1234,
      "clientCount": 1,
      "connectedCount": 1,
      "degradedCount": 0,
      "streamingCount": 1,
      "cache": {
        "entries": 0,
        "hits": 0,
        "invalidations": 0,
        "misses": 1,
        "ttlMs": 1500
      },
      "context": {
        "hotContextTokens": null,
        "contextWindowPercent": null,
        "compressionThresholdTokens": null,
        "remainingContextTokens": null
      },
      "model": {
        "providerId": "openai",
        "model": "gpt-5.5",
        "maxOutputTokens": 4096,
        "contextWindowTokens": 400000
      },
      "channels": [
        {
          "name": "ws",
          "adapter": "SocketControlHub",
          "transport": "websocket",
          "connected": true,
          "configured": true,
          "implemented": true,
          "streaming": true,
          "state": "connected",
          "capabilities": {
            "finalReply": true,
            "typing": true,
            "replyReference": true,
            "thread": true,
            "messageUpdate": false,
            "cardUpdate": false,
            "reactions": false,
            "topicCreate": false
          }
        }
      ]
    }
  }
}
```

`status.model` 是 TUI Context Window 的只读权威出口：

- `providerId`：当前配置的模型 provider。
- `model`：当前模型名。
- `maxOutputTokens`：配置里的生成输出上限，即 `model.maxTokens`；这不是上下文窗口。
- `contextWindowTokens`：模型最大上下文窗口。来源优先级是显式配置、provider/model 已知映射、`null`。不要把 `maxOutputTokens` 当成上下文窗口。

`status.context` 是 TUI Context Window 的只读遥测出口：

- `hotContextTokens`：当前热区 token 估算。没有真实运行态来源时返回 `null`。
- `contextWindowPercent`：`hotContextTokens / contextWindowTokens`，任一值未知时返回 `null`。
- `compressionThresholdTokens`：压缩阈值。没有真实配置或运行态来源时返回 `null`。
- `remainingContextTokens`：剩余上下文窗口 token，任一值未知时返回 `null`。

只读查询缓存元信息：

- `payload.cache.hit` 表示本次 `gateway.status.get` / DB read-model query 是否命中 socket 只读缓存。
- `payload.cache.key` 由 `type + payload` 生成，只用于调试与 TUI 缓存命中显示。
- `payload.cache.ttlMs` 当前默认是短 TTL 1500ms。
- `status.cache` 是 socket read-cache 统计；`gateway.message.send`、`fork.create` 等写操作不缓存，写事件会失效缓存。

代码：

- `src/socket/control.ts` `handleGatewayStatusGet(...)`

测试：

- `tests/gateway.ws.test.ts` `gateway.status.get -> snapshot`

### `capability.catalog.get`

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-catalog-1",
  "type": "capability.catalog.get",
  "at": "2026-05-21T00:00:03.000Z",
  "requestId": "probe-catalog",
  "payload": {}
}
```

响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-catalog-snapshot-1",
  "type": "capability.catalog.snapshot",
  "at": "2026-05-21T00:00:03.010Z",
  "requestId": "probe-catalog",
  "correlationId": "env-catalog-1",
  "payload": {
    "catalog": null,
    "kits": {
      "schemaVersion": 1,
      "builtAt": "2026-05-21T00:00:03.010Z",
      "kits": [
        { "id": "builtin.cli", "kind": "cli", "source": "builtin" },
        { "id": "builtin.tui", "kind": "tui", "source": "builtin" },
        { "id": "builtin.gateway", "kind": "gateway", "source": "builtin" },
        { "id": "builtin.capabilities", "kind": "capability", "source": "builtin" }
      ],
      "capabilities": []
    }
  }
}
```

说明：

- `catalog` 当前允许为 `null`
- `kits` 是只读 external kit snapshot

代码：

- `src/socket/control.ts` `handleCapabilityCatalogGet(...)`
- `src/socket/kit/*`

测试：

- `tests/gateway.ws.test.ts` `roundtrips capability catalog control messages`
- `tests/gateway.ws.test.ts` `exposes a stable built-in external kit catalog snapshot`

## 输入与流式回复

### `gateway.message.send`

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-input-1",
  "type": "gateway.message.send",
  "at": "2026-05-21T00:00:10.000Z",
  "requestId": "client-req-1",
  "payload": {
    "id": "message-1",
    "text": "继续推进这个 Scope",
    "conversationKey": "u-1",
    "threadId": "thread-1",
    "user": {
      "id": "u-1",
      "displayName": "User One"
    },
    "context": {
      "contextForkId": "fork-1",
      "skillNames": ["review"],
      "toolApprovals": {
        "mcpToolCalls": false,
        "userToolCalls": false
      },
      "activeScope": {
        "id": "scope-1",
        "projectDir": "/workspace/project",
        "projectMemoryDir": "/workspace/project/.flyflor/memory",
        "title": "Scope"
      },
      "activeProject": {
        "id": "scope-1",
        "projectDir": "/workspace/project",
        "projectMemoryDir": "/workspace/project/.flyflor/memory",
        "title": "Scope"
      }
    }
  }
}
```

最小必填：

- `payload.text`

当前解析规则：

- `text` 为空或缺失会报 `invalid-payload`
- envelope 顶层 `requestId` 会直接透传给 runtime，成为同一轮 `turn.*` 与 `event.publish` 的关联键
- `context.activeScope` 是 canonical 字段，只有在 `id + projectDir + projectMemoryDir` 都齐全时才会被接收
- `context.activeProject` 是兼容别名；若同时传入，以 `activeScope` 为准
- `context.toolApprovals` 是本轮显式工具审批桥，只对当前 `gateway.message.send` 生效
- `toolApprovals.mcpToolCalls=true` 时，WS 会为本轮 MCP-compatible 工具调用安装 approve callback；catalog、schema、Executive 调度和 sandbox gate 仍然照常执行
- `toolApprovals.userToolCalls=true` 时，WS 会为本轮 user manifest tool 调用安装 approve callback；它不会修改全局 sandbox 配置，也不会影响下一轮
- 未传或为 `false` 时，缺少审批会作为明确工具错误返回，不做静默兜底
- `chatType` 缺失时默认 `direct`
- `platform actor id` 缺失时默认 `ws-actor`
- `conversationKey` / `threadId` 只属于 socket route，不会参与认知连续性

TUI/本地调试端只有在用户已经确认本轮允许执行工具时才应传 `toolApprovals=true`。只读 query 命令不需要这个字段。

代码：

- `src/protocol/control/envelope.ts` `readGatewayControlMessageInput(...)`
- `src/protocol/control/envelope.ts` `normalizeGatewayControlMessage(...)`
- `src/socket/control.ts` `handleGatewayMessageSend(...)`

测试：

- `tests/protocol.control.test.ts` `normalizes gateway.message.send payload into a ws GatewayMessage`
- `tests/protocol.control.test.ts` `prefers explicit activeScope and keeps activeProject as compatibility input`
- `tests/gateway.ws.test.ts` `dispatches ws messages with explicit runtime context and emits turn deltas/final`
- `tests/gateway.ws.test.ts` `reuses envelope requestId as the runtime request correlation key`

### `turn.delta`

流式增量响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-delta-1",
  "type": "turn.delta",
  "at": "2026-05-21T00:00:11.000Z",
  "requestId": "runtime-req-1",
  "correlationId": "env-input-1",
  "payload": {
    "messageId": "message-1",
    "delta": "hel"
  }
}
```

### `turn.final`

结束响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-final-1",
  "type": "turn.final",
  "at": "2026-05-21T00:00:12.000Z",
  "requestId": "runtime-req-1",
  "correlationId": "env-input-1",
  "payload": {
    "reply": {
      "messageId": "message-1",
      "route": {
        "channel": "ws",
        "conversationKey": "u-1",
        "chatType": "direct"
      },
      "text": "Need confirmation?",
      "metadata": {}
    }
  }
}
```

### `turn.error`

单轮执行失败：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-turn-error-1",
  "type": "turn.error",
  "at": "2026-05-21T00:00:12.000Z",
  "requestId": "runtime-req-1",
  "correlationId": "env-input-1",
  "payload": {
    "messageId": "message-1",
    "message": "runtime failed"
  }
}
```

代码：

- `src/socket/control.ts` `handleGatewayMessageSend(...)`
- `src/protocol/control/envelope.ts` `buildGatewayControlTurnDeltaPayload(...)`
- `src/protocol/control/envelope.ts` `buildGatewayControlTurnFinalPayload(...)`
- `src/protocol/control/envelope.ts` `buildGatewayControlTurnErrorPayload(...)`

测试：

- `tests/gateway.ws.test.ts` `dispatches ws messages with explicit runtime context and emits turn deltas/final`
- `tests/gateway.ws.test.ts` `reports runtime failures as turn.error envelopes`

## `turn.final` 中的 ask / todo / data

当前协议最重要的事实：

- `ask` 不单独发 transport message
- `todo` 不单独发 transport message
- 大部分当前轮结构化数据都附着在 `turn.final.payload.reply.metadata`

### Ask 读取位置

读取：

- `reply.metadata.kind === "ask"`
- `reply.metadata.ask`

结构：

```json
{
  "kind": "ask",
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
    "questions": [],
    "executiveToolLoop": {
      "askId": "ask-1",
      "message": "Need one more step",
      "loopGuardSnapshot": {
        "callRepeatCounts": {},
        "failedCallRepeatCounts": {},
        "totalCalls": 2,
        "unknownToolCounts": {}
      },
      "resume": {
        "mode": "continue"
      },
      "stepCount": 2,
      "stop": "ask",
      "toolBudgetExhausted": true
    }
  }
}
```

### Todo / Planning 读取位置

读取：

- `reply.metadata.planning.taskPlans`
- `reply.metadata.planning.contextForks`
- `reply.metadata.planning.replays`

结构：

```json
{
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
    "replays": []
  }
}
```

### Long-horizon loop 读取位置

当前稳定双表面：

- `reply.metadata.executiveToolLoop`
- `reply.metadata.ask.executiveToolLoop`

两者表达同一个 snapshot。

代码：

- `src/protocol/control/envelope.ts`

测试：

- `tests/gateway.ws.test.ts` `carries ask and todo snapshots through turn.final reply metadata`
- `tests/protocol.control.test.ts` `keeps long-horizon loop snapshot stable on both top-level and ask metadata surfaces`
- `tests/gateway.control.smoke.test.ts` `runs the ws thin-client lifecycle including loop pause-resume and history replay`

### Long-horizon loop event closure

当 `turn.final.reply.metadata.executiveToolLoop` 存在时，当前轮已经显式进入暂停态。thin client 如果想把这条闭环完整跑通，当前真实 `/ws` 行为是：

1. 先通过 `event.subscribe` 订阅
   - `executive.loop.paused`
   - `executive.loop.resumed`
2. 发起会触发 ask 的 `gateway.message.send`
3. 从 `turn.final.reply.metadata.executiveToolLoop` 读取当前 pending loop snapshot
4. 等到 `event.publish.payload.event.type = executive.loop.paused`
5. 用新的 `gateway.message.send` 显式提交用户回答
6. 等到 `event.publish.payload.event.type = executive.loop.resumed`

这条事件链只负责生命周期提示；当前轮权威状态仍回到：

- `turn.final.reply.metadata.kind`
- `turn.final.reply.metadata.ask`
- `turn.final.reply.metadata.executiveToolLoop`

测试：

- `tests/gateway.control.smoke.test.ts` `runs the ws thin-client lifecycle including loop pause-resume and history replay`

## 事件订阅

### `event.subscribe`

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-sub-1",
  "type": "event.subscribe",
  "at": "2026-05-21T00:00:20.000Z",
  "payload": {
    "requestId": "runtime-req-1",
    "types": ["gateway.message.received"],
    "classes": ["control"]
  }
}
```

`classes` 和 `types` 是封闭协议选择器：`classes` 必须来自 RuntimeEventClass，`types` 必须来自 RuntimeEventType。未知值会返回 `invalid-payload`，不会写入当前 socket peer 的订阅状态。

### `event.unsubscribe`

请求结构与 subscribe 相同。

### `ack` 响应

成功订阅或取消订阅后，服务端都返回：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-ack-sub-1",
  "type": "ack",
  "at": "2026-05-21T00:00:20.010Z",
  "correlationId": "env-sub-1",
  "payload": {
    "subscriptions": [
      {
        "requestId": "runtime-req-1",
        "types": ["gateway.message.received"],
        "classes": ["control"]
      }
    ]
  }
}
```

### `event.publish`

广播结构：

```json
{
  "protocol": "flyflor.event.v1",
  "id": "event-1",
  "type": "event.publish",
  "at": "2026-05-21T00:00:21.000Z",
  "requestId": "runtime-req-1",
  "payload": {
    "event": {
      "type": "gateway.message.received",
      "at": "2026-05-21T00:00:21.000Z",
      "requestId": "runtime-req-1",
      "payload": {
        "channel": "ws"
      }
    }
  }
}
```

过滤规则：

- `requestId`
- `types`
- `classes`

不会按文本或 label 做筛选。

代码：

- `src/socket/control.ts` `handleEventSubscribe(...)`
- `src/socket/control.ts` `handleEventUnsubscribe(...)`
- `src/protocol/control/envelope.ts` `shouldDeliverGatewayControlEvent(...)`

测试：

- `tests/gateway.ws.test.ts` `client.hello -> ack`
- `tests/gateway.ws.test.ts` `event.subscribe/unsubscribe -> ack + filter`
- `tests/gateway.ws.test.ts` `subscribes to runtime events and publishes matching envelopes`
- `tests/protocol.control.test.ts` `filters event envelopes by explicit subscription`

## Ping / Pong

### `ping`

请求：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-ping-1",
  "type": "ping",
  "at": "2026-05-21T00:00:30.000Z"
}
```

### `pong`

响应：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-pong-1",
  "type": "pong",
  "at": "2026-05-21T00:00:30.010Z",
  "correlationId": "env-ping-1",
  "payload": {
    "now": "2026-05-21T00:00:30.010Z"
  }
}
```

代码：

- `src/socket/control.ts` `handlePing(...)`

测试：

- `tests/protocol.control.test.ts` `builds typed control payload snapshots for thin clients and Rust transports`

## 鉴权与 Upgrade

规则：

- 若 `gateway.control.token` 已配置：
  - 允许 `Authorization: Bearer <token>`
  - 或 `?token=<token>`
- 若未配置 token：
  - 只允许本地地址：
    - `127.0.0.1`
    - `localhost`
    - `::1`

拒绝响应：

```json
{
  "error": "gateway_control_unauthorized"
}
```

HTTP status：

- `401`

代码：

- `src/socket/control.ts` `authorize(...)`

测试：

- `tests/gateway.ws.test.ts` `requires control token for non-local upgrade requests`
- `tests/gateway.ws.test.ts` `allows localhost upgrade without token and rejects non-localhost without token`

## 错误码

当前稳定控制面错误码：

- `internal`
- `invalid-envelope`
- `invalid-payload`
- `unauthorized`
- `unsupported-message`

错误 envelope：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "env-error-1",
  "type": "error",
  "at": "2026-05-21T00:00:40.000Z",
  "correlationId": "env-input-1",
  "payload": {
    "code": "invalid-payload",
    "message": "gateway.message.send payload requires text"
  }
}
```

典型触发：

| code | 触发 |
| --- | --- |
| `invalid-envelope` | `protocol` 错误、envelope 缺少 `id/type/at` |
| `invalid-payload` | `gateway.message.send` 缺少 `payload` 或 `text` |
| `unsupported-message` | `type` 未注册 |
| `unauthorized` | upgrade 未通过鉴权 |
| `internal` | handler 内部异常 |

代码：

- `src/protocol/control/envelope.ts`
- `src/socket/control.ts` `sendError(...)`

测试：

- `tests/gateway.ws.test.ts` `emits structured invalid-envelope and invalid-payload control errors`
- `tests/protocol.control.test.ts` `rejects unknown control protocol versions`
- `tests/protocol.control.test.ts` `rejects invalid message payloads with structured protocol errors`

## 当前推荐的客户端最小流程

1. 连接 `/ws`
2. 收 `server.hello`
3. 可选发 `client.hello`
4. 需要时主动发 `gateway.status.get`
5. 需要时主动发 `capability.catalog.get`
6. 需要历史回放时主动发 `history.list`
7. 发 `gateway.message.send`
8. 收 `turn.delta`
9. 收 `turn.final` 或 `turn.error`
10. 如果要时间线，再发 `event.subscribe`

最小解析优先级：

1. 先看 `protocol`
2. 再看 `type`
3. 再做 lane 分流
4. `turn.final` 到达后优先读 `reply.metadata`

## 调试建议

调 `/ws` 时，先确认这几件事：

1. protocol 必须发 `flyflor.ws.v1`
2. 路径必须是 `ws://host:port/ws`
3. `gateway.message.send` 必须有 `payload.text`
4. 需要显式 scope 时必须传完整：
   - `id`
   - `projectDir`
   - `projectMemoryDir`
   - canonical 字段优先用 `activeScope`
   - `activeProject` 只作兼容输入
5. 如果你只看到 `server.hello` 后所有请求都报 `invalid-envelope`，先检查是不是把 protocol 发成了别的值

## 相关主文档

- `docs/control.protocol.md`
- `docs/runtime.events.md`
- `docs/old-docs/rust.integration.md`
- `docs/old-docs/rust.connection.core.md`
