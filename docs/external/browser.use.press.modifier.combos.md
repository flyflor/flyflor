# Browser Use Press Modifier Combos

This note records the Hermes-aligned modifier combo behavior for `browser.use press`.

The process-json sidecar keeps delegate calls unchanged, but the CDP backend now parses common model-facing shortcut strings before `Input.dispatchKeyEvent`:

- `cmd`, `command`, `meta`, `super`, and `win` become CDP `Meta`.
- `ctrl` and `control` become CDP `Control`.
- `alt`, `option`, and `opt` become CDP `Alt`.
- `shift` becomes CDP `Shift`.
- Combo strings such as `cmd+k`, `cmd+shift+k`, and `ctrl+alt+t` dispatch modifier keyDown events, the normalized main key keyDown/keyUp pair, then modifier keyUp events in reverse order.

This only changes the opt-in CDP backend for `browser.use`. It does not expose browser control by default, does not import browser runtimes into the kernel, and does not change ASK, plan, yolo, dynamic budget, sandbox approval, quota, audit, or delegate process-json behavior.
