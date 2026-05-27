# Computer Use Action Aliases

This note records model-facing action aliases accepted by the `computer.use` sidecar.

The model-visible schema continues to advertise Hermes-style canonical action names such as `double_click`, `set_value`, `list_apps`, and `focus_app`. At the sidecar boundary, Flyflor now also accepts common camelCase, hyphenated, and backend-shaped variants including `doubleClick`, `double-click`, `type-text`, `press_key`, `setValue`, `listApps`, `focusApp`, and `screenshot`.

Aliases normalize only the top-level dispatched action. The original `input.action` remains unchanged inside the process-json payload so delegate backends and audit logs can see exactly what the model sent.

This does not expose `computer.use` by default, does not import desktop runtimes into the kernel, and does not change ASK, plan, yolo, dynamic budget, sandbox approval, quota, audit, or delegate process boundaries.
