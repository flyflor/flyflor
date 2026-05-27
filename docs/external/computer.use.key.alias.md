# Computer Use Key Alias

This note records a model-facing compatibility alias for `computer.use` key actions.

The canonical Hermes field remains `keys`, but Flyflor now also accepts `key` when `action` is `key`. This handles model outputs such as `{ "action": "key", "key": "return" }` without weakening validation.

The delegate backend still receives the original process-json input. The CUA backend uses either `keys` or `key` to build the same Hermes-aligned payload: plain keys route to `press_key`, and modifier combos route to `hotkey`.

This does not expose `computer.use` by default and does not create a new authority path. The tool remains opt-in, process-json only, and gated by Executive visibility, sandbox approval, quota, audit events, ASK, plan, and yolo policy.
