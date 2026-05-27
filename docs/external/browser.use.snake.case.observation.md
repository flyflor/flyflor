# Browser Use Snake Case Observation Fields

`browser.use` accepts snake_case aliases for observation budget fields:

- `capture_mode` is equivalent to `captureMode`.
- `max_elements` is equivalent to `maxElements`.
- `max_images` is equivalent to `maxImages`.

These aliases are structure-only compatibility for real model output. They do
not widen authority, expose `browser.use` by default, or create a new execution
path. Browser execution still happens through the process-json sidecar after
manifest opt-in, Executive visibility, approval, quota, and audit gates.

Delegate backends continue to receive the original process-json invocation, so
external browser packages may keep their own naming semantics. The CDP backend
uses the aliases only when choosing snapshot caps, image caps, and follow-up
capture mode.
