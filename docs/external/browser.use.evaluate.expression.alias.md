# Browser Use Evaluate Expression Alias

`browser.use` already exposes both `script` and `expression` in its model-facing
schema. The CDP backend now accepts `expression` as a structured alias for
`script` when `action` is `evaluate`.

This closes a real model-output mismatch: models often choose the field named
`expression` for JavaScript evaluation because the browser console action uses
the same term. The alias does not change authority, default visibility, ASK,
plan, yolo, quota, audit, or the external sidecar process boundary.

Delegate backends continue to receive the original process-json invocation.
Only the built-in CDP backend uses `script ?? expression` when building the
`Runtime.evaluate` command.
