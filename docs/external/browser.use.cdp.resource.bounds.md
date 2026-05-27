# Browser Use CDP Resource Bounds

`browser.use` has two execution backends:

- `delegate`, which spawns a configured process-json command.
- `cdp`, which talks to a Chrome DevTools Protocol HTTP/WebSocket endpoint.

Both backends now parse the same sidecar resource fields before execution:

- `config.timeoutMs`: integer, `1..120000`, default `8000`.
- `config.maxOutputBytes`: integer, `1..2097152`, default `524288`.

For the CDP backend, `timeoutMs` is applied to `/json/*` HTTP calls, WebSocket opening, and CDP command responses. `maxOutputBytes` is still validated even though CDP does not stream subprocess stdout; this keeps manifest/resource validation identical across backends and prevents a CDP configuration from silently widening a sidecar resource window.

This remains a sidecar-only boundary. The Bun kernel still owns descriptors, visibility, approval, quota, audit, gateway events, and dispatch; it does not import browser runtime code.
