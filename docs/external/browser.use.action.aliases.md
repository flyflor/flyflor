# Browser Use Action Aliases

This note records model-facing action aliases accepted by the `browser.use` sidecar.

The model-visible schema continues to advertise the compact Flyflor/Hermes-aligned action names such as `navigate`, `snapshot`, `click`, `type`, `evaluate`, `press`, `get_images`, `vision`, and `console`. At the sidecar boundary, Flyflor now also accepts common Hermes tool-name and model variants including `browser_navigate`, `browser_snapshot`, `browser_type`, `fill`, `evaluate-js`, `browser_get_images`, `press_key`, `observe`, and `browser_vision`.

Aliases normalize only the top-level dispatched action. The original `input.action` remains unchanged inside the process-json payload so delegate backends and audit logs can see exactly what the model sent.

This does not expose `browser.use` by default, does not import browser runtimes into the kernel, and does not change ASK, plan, yolo, dynamic budget, sandbox approval, quota, audit, or delegate process boundaries.
