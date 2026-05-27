# Browser Use Scroll Defaults

`browser.use` now accepts the Hermes-style short scroll call:

```json
{ "action": "scroll" }
```

When the CDP backend executes that call, the sidecar defaults `direction` to
`down` and `amount` to `3`, matching the browser handler behavior in
`reference/hermes-agent`. Invalid `direction` or `amount` values still fail in
the sidecar before any CDP socket or delegate process is invoked.

Delegate backends continue to receive the original process-json input. External
browser packages may apply their own compatible defaults, while the Flyflor
kernel remains limited to descriptor visibility, approval, quota, audit events,
and subprocess dispatch.
