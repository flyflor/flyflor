# Browser Use Hermes Actions

`browser.use` now exposes two additional Hermes-style high-level actions:

- `scroll` with `direction` (`up`, `down`, `left`, `right`) and optional integer `amount` (`1..1000`).
- `press` with `key` or `keys`.

The CDP backend implements these through `Runtime.evaluate` for page scroll and `Input.dispatchKeyEvent` for key down/up. Delegate backends receive the same process-json invocation. The actions remain opt-in high-privilege browser control and still pass through Executive visibility, approval, quota, and audit events.
