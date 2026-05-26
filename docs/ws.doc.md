# WebSocket Manual

## Endpoint

Run the socket kernel:

```bash
bun run socket
```

The server exposes:

- `GET /health`
- `GET /ws`

Default local smoke examples use `ws://127.0.0.1:8788/ws`.

`/channels` is not part of the active HTTP surface.

## Envelope

All WebSocket frames are JSON envelopes using `flyflor.ws.v1` for control messages and `flyflor.event.v1` for event publications.

Typical client frame:

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

`gateway.*` is the wire-v1 compatibility vocabulary. The owner is `src/socket`, not a gateway architecture layer.

## Message Types

The socket contract includes:

- `ack`
- `server.hello`
- `client.hello`
- `ping`
- `pong`
- `error`
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
- `crystal.list`
- `crystal.snapshot`
- `fork.create`
- `fork.list`
- `fork.detail.get`
- `fork.snapshot`
- `replay.list`
- `replay.detail.get`
- `replay.snapshot`
- `scope.list`
- `scope.detail.get`
- `scope.snapshot`
- `task.list`
- `task.detail.get`
- `task.snapshot`
- `task.plan.decide`
- `thought.detail.get`
- `thought.snapshot`
- `execution.job.list`
- `execution.job.detail.get`
- `execution.job.snapshot`
- `fork.memory.get`
- `fork.memory.snapshot`

Error examples include `invalid-envelope` and `gateway.message.send payload requires text`.

Apifox scenario names include `ServerHello`, `ClientHello`, `GatewayStatusGet`, `CapabilityCatalogGet`, `HistoryList`, `GatewayMessageSend`, `TurnDelta`, `TurnFinal`, `TurnFinalWithAsk`, `TurnFinalWithPlanning`, `TurnFinalWithExecutiveLoopPause`, and `InvalidPayloadError`.

`gateway.status.snapshot` includes `clientCount` as live WebSocket peer pressure. It is not a static channel count. The socket control hub also maintains `controlState` for active subscriptions and current control-plane state.

Transport actor labels such as `ws-actor` are audit/routing metadata only. They do not select Scope, Memory, Crystal recall, or prompt continuity.

## Event Subscription

Subscribe with stable RuntimeEvent types. When classes are used, they must match the runtime classifier; executive loop pause/resume events are ASK-class events:

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

Use `"classes": ["ask"]` for ASK/executive-loop pause events, or omit `classes` and subscribe by exact `types`. Do not use the old gateway event class.

## Detail Query Envelope Matrix

Read-model queries are served from `src/socket/query`. They inspect ledger/detail state and do not call `RuntimeModule`, assemble prompts, run models, or execute tools.

| Request | Response style | Source |
| --- | --- | --- |
| `history.list` | `history.snapshot` historical turn list | `brain.db.memory_events` + planning tables |
| `history.detail.get` | `history.snapshot` detail payload | `brain.db` + blackboard DB |
| `ask.list` / `ask.detail.get` | `ask.snapshot` | `brain.db.memory_events` ask/answer-pair/state |
| `blackboard.list` / `blackboard.detail.get` | `blackboard.snapshot` | blackboard SQLite tables |
| `crystal.list` | `crystal.snapshot` | `crystal.db.crystal_gems` |
| `fork.list` / `fork.detail.get` | `fork.snapshot` | `brain.db.context_forks` |
| `fork.memory.get` | `fork.memory.snapshot` | recent `brain.db.context_forks` panel projection |
| `replay.list` / `replay.detail.get` | `replay.snapshot` | `brain.db.replay_records` |
| `scope.list` / `scope.detail.get` | `scope.snapshot` | `brain.db.scopes` + scope-local material |
| `task.list` / `task.detail.get` | `task.snapshot` | `brain.db.task_plans` |
| `thought.detail.get` | `thought.snapshot` | safe structured event/replay summary |
| `execution.job.list` / `execution.job.detail.get` | `execution.job.snapshot` | `brain.db.memory_events type=execution-job` |

Detail payloads use `payload.data`. List commands return arrays; detail commands return an object or `null`.

`task.plan.decide` is not a read-model query. It is an explicit control write command for confirming, revising, or abandoning a pending task plan.

## 历史对话列表获取

Use `history.list` to read the global `brain.db` ledger as a paged history list. The socket layer receives pagination input, calls the read-only `src/socket/query` read model, and returns `history.snapshot`.

This is not a session restore path, a context owner, or a prompt assembly path. `clientCount` remains live peer pressure only.

When `history.list.payload.contextForkId` is present, the read model narrows the ledger replay to that explicit context fork. It still does not infer continuity from transport identity.

`history.detail.get -> history.snapshot` uses the same snapshot envelope family, but places the detail object in `payload.data`.

## ASK Metadata

`ask` is not a standalone transport message for live turns. It is attached to:

- `turn.final.payload.reply.metadata.kind === "ask"`
- `turn.final.payload.reply.metadata.ask`

New clients should prefer `questions[]`. Root `choices` remain for older clients.

```json
{
  "kind": "ask",
  "ask": {
    "snapshotId": "ask-1",
    "reason": "tool-loop-limit",
    "source": "executive-tool-loop",
    "authority": "high",
    "prompt": "Need one more decision before continuing.",
    "questionCount": 2,
    "questions": [
      {
        "id": "execution-strategy",
        "prompt": "What should the runtime do next?",
        "recommendedChoiceId": "continue-tools",
        "choices": [
          {
            "id": "continue-tools",
            "label": "Continue tools",
            "description": "Resume with a higher budget for this turn.",
            "recommended": true
          }
        ],
        "other": { "id": "other", "label": "Other", "freeform": true },
        "allowOther": true
      }
    ],
    "executiveToolLoop": {
      "askId": "ask-1",
      "stepCount": 2,
      "toolBudgetExhausted": true,
      "stop": "ask"
    }
  }
}
```

Each question carries 1-3 owner/model choices and one `recommendedChoiceId`. Runtime always adds the fixed freeform `other` choice. `other` text is stored as user evidence and is not parsed by runtime with keyword or regex semantics.

High-authority ASK may carry `crystalCandidates`. Those candidates can enter reflection evidence, but Gem promotion remains gated by Crystal quality checks.

## Execution Job Query

`subagent.batch` creates durable execution-job ledger rows when a parent job starts, pauses, completes, or fails. The socket query surface exposes those rows without invoking runtime logic.

Request:

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "execution-job-list-1",
  "type": "execution.job.list",
  "payload": {
    "limit": 20,
    "status": "all"
  }
}
```

Response:

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "execution-job-snapshot-1",
  "type": "execution.job.snapshot",
  "correlationId": "execution-job-list-1",
  "payload": {
    "data": [
      {
        "jobId": "job-1",
        "requestId": "req-1",
        "status": "needs-user",
        "stage": "paused",
        "progress": {
          "childTotal": 2,
          "childCompleted": 1,
          "childFailed": 0,
          "childNeedsUser": 1,
          "toolCalls": 3
        },
        "children": [
          {
            "childId": "blocked",
            "id": "blocked",
            "childJobId": "child-2",
            "task": { "goal": "Resolve blocked migration" },
            "status": "needs-user",
            "toolCalls": 1,
            "limited": true,
            "limitReason": "tool-budget-exhausted"
          }
        ],
        "toolExecutions": [
          {
            "childJobId": "child-1",
            "server": "workspace",
            "tool": "read",
            "key": "workspace.read",
            "ok": true,
            "status": "ok",
            "inputPreview": { "path": "README.md" },
            "outputPreview": { "text": "short bounded preview" },
            "durationMs": 12,
            "limited": false
          }
        ]
      }
    ],
    "cache": { "hit": false, "key": "execution-job:list", "ttlMs": 500 }
  }
}
```

`execution.job.detail.get` uses `payload.jobId` and returns the same `execution.job.snapshot` type with one object or `null`.

## Tool Approval Context

`gateway.message.send.payload.context` may carry:

- `toolApprovals`
- `mcpToolCalls`
- `userToolCalls`

This context is input to the kernel Executive loop. It is not a CLI-local execution instruction. A client should show approval state and submit structured user decisions; the kernel remains the executor and ledger owner.

## CLI Closure Status

`flyflor-cli` currently renders Run timeline events such as:

- `executive.loop.paused`
- `executive.loop.resumed`
- `mcp.tool.call.executed`
- `tool.started`
- `tool.succeeded`
- `tool.failed`

The current CLI bootstrap requests `capability.catalog.get`; `/approve` marks the next non-YOLO send with `toolApprovals.mcpToolCalls=true` and `toolApprovals.userToolCalls=true`. YOLO also sends these approvals, but carries separate high-privilege metadata.

## Tests

Relevant coverage:

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`
