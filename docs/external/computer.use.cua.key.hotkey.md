# Computer Use CUA Key Hotkey

This note records the Hermes-aligned key mapping that Flyflor applies before calling the `computer.use` CUA backend.

The process-json sidecar keeps delegate calls unchanged, but CUA key calls are normalized into the native driver shape:

- `key` without modifiers uses backend tool `press_key`.
- `key` with modifiers uses backend tool `hotkey`.
- modifier aliases are normalized before the CUA call, so `command+shift+s` becomes `keys: ["cmd", "shift", "s"]`.
- plain keys are sent as `key`, while hotkeys are sent as `keys`.

The kernel still owns only the descriptor, visibility, approval, quota, audit, gateway events, and sidecar dispatch. Browser or desktop runtime code is not imported into the Bun kernel, and the normal ASK, plan, yolo, dynamic budget, sandbox approval, and process-json boundaries remain unchanged.
