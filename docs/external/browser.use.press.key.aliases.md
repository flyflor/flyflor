# Browser Use Press Key Aliases

This note records the Hermes-aligned key aliases that Flyflor applies before calling the `browser.use` CDP backend.

The process-json sidecar keeps delegate calls unchanged, but CDP `press` calls normalize common model-facing key names before `Input.dispatchKeyEvent`:

- `enter` and `return` become `Enter`.
- `esc` and `escape` become `Escape`.
- `arrow-down`, `down`, and `ArrowDown` become `ArrowDown` (same for up, left, and right).
- `page-up`, `page-down`, `space`, `delete`, `backspace`, `home`, `end`, and `f1` through `f24` use CDP-compatible key names.

The kernel still owns only the descriptor, visibility, approval, quota, audit, gateway events, and sidecar dispatch. Browser runtime code stays in the external process boundary, and ASK, plan, yolo, dynamic budget, sandbox approval, and process-json execution remain unchanged.
