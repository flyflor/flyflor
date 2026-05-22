# Flyflor Socket OpenAPI

`flyflor.socket.openapi.json` is the Apifox-importable contract for real socket scenario testing.

Notes:

- The active transport is `/ws` WebSocket. HTTP only keeps `/health` and `/ws` upgrade.
- `gateway.*` names are `flyflor.ws.v1` compatibility wire names, not the architecture subject.
- `history.list` only queries the `brain.db` life ledger for ledger/query/replay/audit. It is not session restore and does not assemble prompt context.
- `clientId`, `conversationKey`, `threadId`, and `user.id` are live peer, routing, audit, dedup, and reply-anchor provenance only. They do not carry cognitive continuity.
- Real context assembly comes from current input, `MemoryComponent`, `CrystalComponent`, explicit `Scope/Fork`, and the Executive visible capability surface.

Apifox flow:

1. Import `docs/openapi/flyflor.socket.openapi.json`.
2. Start the Flyflor socket service.
3. Check `GET /health`.
4. Connect Apifox WebSocket to `ws://127.0.0.1:8788/ws`.
5. Send the examples for `client.hello`, `gateway.status.get`, `capability.catalog.get`, `history.list`, and `gateway.message.send`; observe `server.hello`, `ack`, `history.snapshot`, `turn.delta`, `turn.final`, and `event.publish`.
