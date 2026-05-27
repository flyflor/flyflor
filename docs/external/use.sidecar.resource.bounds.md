# Use Sidecar Resource Bounds

This note records the process-json resource bounds shared by the high-privilege `browser.use` and `computer.use` sidecars.

Both sidecars keep execution outside the kernel and bound delegate resources before spawning a child process:

- `timeoutMs` defaults to the sidecar default and must be an integer from `1` to `120000`.
- `maxOutputBytes` defaults to `512 KiB` and must be an integer from `1` to `2097152`.
- Invalid resource config fails as structured `failed` before command resolution or delegate spawn.

The bound is intentionally local to the sidecar runner. It does not change Executive approval, ASK, yolo, plan mode, or dynamic tool budgets; it prevents a configured external delegate from silently widening a single child-process execution window.
