# Computer Use Capture-After Context

`computer.use` follow-up capture now preserves the action context that matters for app-scoped desktop work:

- `app`
- `mode`
- `maxElements`
- `max_elements`

This mirrors the Hermes backend behavior where `capture_after=true` should re-capture the same app or narrowed desktop scope after an action such as `focus_app`, rather than falling back to the frontmost app or whole screen. Execution still goes through the process-json sidecar or CUA delegate; the kernel only owns descriptor, visibility, approval, quota, audit, and dispatch boundaries.
