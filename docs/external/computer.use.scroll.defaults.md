# Computer Use Scroll Defaults

This note records the Hermes-compatible default behavior for `computer.use` scroll calls.

Hermes allows `action: "scroll"` without explicit `direction` or `amount`:

- `direction` defaults to `down`.
- `amount` defaults to `3`.

Flyflor now mirrors that behavior in the CUA backend payload while keeping delegate calls process-json and sidecar-owned. Delegate backends still receive the original structured input so external packages can apply their own compatible defaults.

Invalid values remain blocked before any subprocess is spawned:

- `direction` must be `up`, `down`, `left`, or `right` when present.
- `amount` must be an integer between `1` and `1000` when present.

This does not create a new authority path. `computer.use` remains opt-in, computer-control scoped, and gated by Executive visibility, sandbox approval, quota, audit events, ASK, plan, and yolo policy.

Focused coverage lives in `tests/computer.use.sidecar.test.ts`.
