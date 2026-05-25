# Flyflor Socket OpenAPI

`flyflor.socket.openapi.json` is the Apifox-importable contract for real socket scenario testing. Use the component examples as raw WebSocket JSON bodies after connecting to `/ws`.

Notes:

- The active transport is `/ws` WebSocket. HTTP only keeps `/health` and `/ws` upgrade.
- `gateway.*` names are `flyflor.ws.v1` v1 compatibility wire names, not the architecture subject.
- `history.list` only queries the `brain.db` life ledger for ledger/query/replay/audit. It is not session restore, a prompt container, or context assembly.
- Query commands such as `scope.list`, `fork.detail.get`, `ask.list`, `blackboard.detail.get`, `task.list`, `replay.list`, `thought.detail.get`, `crystal.list`, and `execution.job.list` are DB/read-model only. They do not invoke RuntimeModule, model calls, tools, or prompt/context assembly.
- `clientId`, `conversationKey`, `threadId`, and `user.id` are live peer, routing, audit, dedup, and reply-anchor provenance only. They do not carry or create cognitive continuity.
- Real context assembly comes from current input, `MemoryComponent`, `CrystalComponent`, explicit `Scope/Fork`, and the Executive visible capability surface.

## Apifox Flow

1. Import `docs/openapi/flyflor.socket.openapi.json`.
2. Start the Flyflor socket service.
3. Send `GET /health` and expect `HealthOk`.
4. Connect Apifox WebSocket to `ws://127.0.0.1:8788/ws`.
5. Observe `ServerHello` immediately after upgrade.
6. Send `ClientHello` and expect `Ack`.
7. Send `GatewayStatusGet` and expect `GatewayStatusSnapshot`.
8. Send `CapabilityCatalogGet` and expect `CapabilityCatalogSnapshot`.
9. Send `HistoryList` and expect `HistorySnapshot`.
10. Send `ScopeList`, `AskList`, or `ForkDetailGet` and expect the matching `*.snapshot.payload.data` read-model response.
11. Send `GatewayMessageSend`; observe one or more `TurnDelta` frames and a final `TurnFinal`.

Apifox import note: the OpenAPI file documents `/ws` as an upgrade endpoint, but the scenario messages live under `components.examples`. For WebSocket tests, paste each example `value` as the outgoing JSON body and keep the `protocol`, `type`, and request ids intact.

## Metadata Scenarios

Use the example set as reusable Apifox WebSocket messages:

- `TurnFinalWithAsk` shows `turn.final.reply.metadata.ask`.
- `TurnFinalWithPlanning` shows `turn.final.reply.metadata.planning` with task plan, fork, and replay snapshots.
- `TurnFinalWithExecutiveLoopPause` shows both `reply.metadata.executiveToolLoop` and `reply.metadata.ask.executiveToolLoop`.
- `ExecutionJobList`, `ExecutionJobDetailGet`, and `ExecutionJobSnapshot` show Durable Job read-model queries backed by `brain.db` execution-job ledger events.
- ASK examples use `questions[]`, `recommendedChoiceId`, and fixed `other` options; root `choices` remains a legacy compatibility surface.
- `GatewayStatusSnapshot.payload.status.controlState` shows the current socket-visible ASK, Scope, Fork, and Executive loop snapshot, populated from real turn metadata and runtime events.
- `EventSubscribe`, `ExecutiveLoopPausedEvent`, and `ExecutiveLoopResumedEvent` show the lifecycle event timeline. The current turn authority remains `turn.final.reply.metadata`.
- `InvalidGatewayMessageSend` followed by `InvalidPayloadError` covers the structured `invalid-payload` response for missing `payload.text`.

## Boundary Checks

- The default `GatewayMessageSend` example intentionally has no `payload.context`, so a frontend can send the first conversation message without creating local Scope directories.
- `GatewayMessageSend.payload.context.activeScope` and `contextForkId` are the only explicit working-domain inputs in the socket message when the client already has a real Scope/Fork.
- `GatewayMessageSend.payload.context.toolApprovals` is an explicit one-turn local approval bridge for trusted TUI/WS clients. It can approve MCP-compatible or user-manifest tool calls for the current turn only; it does not change sandbox policy, catalog visibility, or future turns.
- When sending `activeScope`, `projectDir` and `projectMemoryDir` must be real writable paths returned by Scope creation/list/detail, not copied placeholder paths.
- `activeProject` is only a compatibility alias for `activeScope`; prefer `activeScope` in new Apifox examples.
- `HistorySnapshot` may include reply metadata, task plans, replays, and context fork snapshots as ledger replay data. Do not feed it back as prompt context.
- `*.snapshot.payload.data` from read-model query commands is inspectable TUI state only. Do not feed it back as prompt context.
- `execution.job.snapshot.payload.data` is long-task progress/audit data only. It is not a prompt container and must not be used as cognitive continuity.
- Only `GatewayMessageSend` enters live turn execution; query commands must stay detachable DB reads.
- `GatewayStatusSnapshot.payload.status.controlState` is a read model for clients; it is not a new context owner, session restore surface, or prompt assembly source.
- `conversationKey`, `threadId`, and `user.id` are useful for Apifox correlation and routing assertions, but they are not memory owners.

## Drift Guards

The OpenAPI contract is documentation of `src/protocol/control`; it does not create runtime truth. Keep changes aligned with:

- `tests/docs.references.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.ws.test.ts`

Do not add wire v2, do not rename `gateway.*` compatibility strings, and do not restore `/channels`.
