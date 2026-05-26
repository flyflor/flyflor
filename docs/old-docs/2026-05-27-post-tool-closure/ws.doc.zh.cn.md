# WebSocket 手册

## Endpoint

启动 socket kernel：

```bash
bun run socket
```

服务器暴露：

- `GET /health`
- `GET /ws`

默认本地 smoke 示例使用 `ws://127.0.0.1:8788/ws`。

`/channels` 不属于活跃 HTTP surface。

## Envelope

所有 WebSocket frame 都是 JSON envelope。Control messages 使用 `flyflor.ws.v1`，event publications 使用 `flyflor.event.v1`。

典型 client frame：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "client-message-1",
  "type": "gateway.message.send",
  "payload": {
    "text": "Summarize the current scope.",
    "context": {
      "activeScope": {
        "id": "scope-123",
        "title": "Example",
        "projectDir": "/workspace/example",
        "projectMemoryDir": "/workspace/example/.flyflor/memory"
      },
      "toolApprovals": {
        "mcpToolCalls": true,
        "userToolCalls": true
      }
    }
  }
}
```

`gateway.*` 是 wire-v1 compatibility vocabulary。Owner 是 `src/socket`，不是 gateway 架构层。

## Message Types

Socket contract 包含：

- `ack`
- `server.hello`
- `client.hello`
- `gateway.status.get`
- `gateway.status.snapshot`
- `capability.catalog.get`
- `capability.catalog.snapshot`
- `gateway.message.send`
- `gateway.message.interrupt`
- `turn.delta`
- `turn.final`
- `turn.error`
- `event.subscribe`
- `event.unsubscribe`
- `event.publish`
- `history.list`
- `history.detail.get`
- `history.snapshot`
- `ask.list`
- `ask.detail.get`
- `ask.snapshot`
- `blackboard.list`
- `blackboard.detail.get`
- `blackboard.snapshot`
- `fork.memory.get`
- `fork.memory.snapshot`
- `execution.job.list`
- `execution.job.detail.get`
- `execution.job.snapshot`

Error 示例包括 `invalid-envelope` 和 `gateway.message.send payload requires text`。

`gateway.status.snapshot` 包含 `clientCount`，表示 live WebSocket peer pressure，不是静态 channel count。

## Event Subscription

订阅 stable RuntimeEvent types。使用 classes 时必须匹配 runtime classifier；executive loop pause/resume events 属于 ASK-class events：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "subscribe-1",
  "type": "event.subscribe",
  "payload": {
    "classes": ["ask"],
    "types": ["executive.loop.paused", "executive.loop.resumed"]
  }
}
```

ASK/executive-loop pause events 使用 `"classes": ["ask"]`，或省略 `classes` 只按 exact `types` 订阅。不要使用旧 gateway event class。

## Detail Query Envelope Matrix

Read-model queries 由 `src/socket/query` 服务。它们检查 ledger/detail state，不调用 `RuntimeModule`，不装配 prompt，不运行模型，也不执行工具。

| Request | Response style |
| --- | --- |
| `history.list` | `history.snapshot` historical turn list |
| `history.detail.get -> history.snapshot` | detail query mapped into snapshot payload |
| `ask.list` / `ask.detail.get` | ASK records and pending snapshots |
| `blackboard.list` / `blackboard.detail.get` | Blackboard detail and worker output |
| `fork.list` / `fork.detail.get` | ContextFork records |
| `fork.memory.get` | `fork.memory.snapshot` recent ContextFork panel projection |
| `replay.list` / `replay.detail.get` | Replay records |
| `scope.list` / `scope.detail.get` | Scope records |
| `task.list` / `task.detail.get` | Task plans |
| `thought.detail.get` | Thought/detail projection |
| `execution.job.list` / `execution.job.detail.get` | Execution job snapshots |

Detail payloads 使用 `payload.data`。List commands 返回数组；detail commands 返回 object 或 `null`。

## 历史对话列表获取

使用 `history.list` 将全局 `brain.db` ledger 读取为分页 history list。Socket 层接收 pagination input，调用 read-only `src/socket/query` read model，并返回 `history.snapshot`。

这不是 session restore path、context owner 或 prompt assembly path。`clientCount` 只表示 live peer pressure。

当 `history.list.payload.contextForkId` 存在时，read model 将 ledger replay 缩小到该显式 context fork。它仍然不会从 transport identity 推断 continuity。

## ASK Metadata

`ask` 不是 live turn 的独立 transport message。它挂在：

- `turn.final.payload.reply.metadata.kind === "ask"`
- `turn.final.payload.reply.metadata.ask`

新 client 应优先使用 `questions[]`。Root `choices` 保留给旧 client。

每个 question 携带 1-3 个 owner/model choices 和一个 `recommendedChoiceId`。Runtime 总是添加固定 freeform `other` choice。`other` text 会作为 user evidence 存储，不会被 runtime 用 keyword 或 regex 语义解析。

High-authority ASK 可以携带 `crystalCandidates`。这些 candidates 可以进入 reflection evidence，但 Gem promotion 仍由 Crystal quality checks gate。

## Tool Approval Context

`gateway.message.send.payload.context` 可以携带：

- `toolApprovals`
- `mcpToolCalls`
- `userToolCalls`

这些 context 是 kernel Executive loop 的输入，不是 CLI-local execution instruction。Client 应展示 approval state 并提交结构化用户决策；kernel 仍是 executor 和 ledger owner。

## CLI Closure Status

`flyflor-cli` 当前会渲染 Run timeline events，例如：

- `executive.loop.paused`
- `executive.loop.resumed`
- `mcp.tool.call.executed`
- `tool.started`
- `tool.succeeded`
- `tool.failed`

当前 CLI bootstrap 会请求 `capability.catalog.get`；`/approve` 会为下一次非 YOLO 发送标记 `toolApprovals.mcpToolCalls=true` 和 `toolApprovals.userToolCalls=true`。YOLO 也会发送这些 approvals，但额外携带高权限 metadata。

## Tests

相关覆盖：

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`
