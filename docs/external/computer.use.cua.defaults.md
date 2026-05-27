# Computer Use CUA Defaults

This note records the Hermes-aligned defaults that Flyflor applies before calling the `computer.use` CUA backend.

The process-json sidecar now normalizes these defaults in the CUA payload:

- `capture` without `mode` uses `mode: "som"`.
- `capture` without `maxElements` / `max_elements` uses `max_elements: 100`.
- `wait` without `seconds` uses `seconds: 1`.

The delegate backend still receives the original process-json invocation. These defaults are only applied to the CUA backend payload so a real CUA driver sees the same explicit contract that Hermes documents, without moving desktop runtime code into the Bun kernel.

This does not create a new authority path. `computer.use` remains opt-in, process-json only, and gated by Executive visibility, sandbox approval, quota, audit events, ASK, plan, and yolo policy.
