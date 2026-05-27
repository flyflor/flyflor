# Browser Use Capture-After Context

This note records the `browser.use` follow-up capture contract for Hermes-style browser loops.

`captureAfter` and `capture_after` are equivalent structured fields. They only apply after the high-privilege `browser.use` tool is already visible through explicit manifest opt-in, Executive visibility, approval, quota, and audit gates.

When the follow-up capture is a snapshot, the sidecar preserves the caller's observation context:

- `full: true` keeps the Accessibility full-tree path.
- `maxElements` keeps the compact ref snapshot bounded to the requested element cap.

This keeps the common workflow stable:

1. `snapshot` returns compact `@eN` refs.
2. `click` or `type` uses a ref.
3. `captureAfter` returns a snapshot with the same observation budget, instead of silently widening back to the default cap.

Execution still happens through the process-json sidecar. The kernel owns descriptors, visibility, approval, quota, event/audit flow, and dispatch only; it does not store browser refs or import browser runtimes.

Focused coverage lives in `tests/browser.use.sidecar.test.ts` and `tests/external.tools.test.ts`.
