# Computer Use Live Delegate Coverage

`smoke:computer-use:live` now always runs a deterministic external process-json delegate before probing the optional CUA backend.

The delegate path covers `computer.use` without requiring `cua-driver`: action aliases such as `screenshot`, `press_key`, `setValue`, and `doubleClick`, canonical dispatched actions, read-only classification, and mutating-action `captureAfter`.

If `cua-driver` is unavailable, the smoke still returns a structured CUA skip, but the `checks` array records the delegate closure that actually ran. Passing `--require-cua` keeps the previous stricter behavior: the delegate closure runs first, then missing CUA makes the command fail.

This does not create a new authority path. The delegate is a temporary child process created inside an isolated temp directory, and the kernel still owns only descriptors, visibility, approval, quota, events, audit, and dispatch metadata.
