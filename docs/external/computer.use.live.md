# Computer Use Live Smoke

`smoke:computer-use:live` is an optional real CUA-driver closure check for the high-level `computer.use` sidecar.

The smoke is read-only by default. When `cua-driver` is available on macOS, it drives `computer.use` through the CUA backend and verifies:

- `capture` through `get_window_state`
- `list_apps`
- `wait`

If `cua-driver` is absent, the default command exits successfully with a structured skip:

```sh
bun run smoke:computer-use:live
```

Use `--require-cua` when a machine is expected to provide the CUA driver:

```sh
bun run scripts/computer.use.live.smoke.ts --require-cua
```

The smoke does not expose `computer.use` to ordinary model turns. The default external manifest still registers the sidecar with `tools: []`, so desktop control remains opt-in and must pass Executive visibility, ASK/approval, quota, and audit boundaries before a model can use it.

Set `FLYFLOR_CUA_COMMAND` to force a specific driver binary:

```sh
FLYFLOR_CUA_COMMAND=/opt/homebrew/bin/cua-driver bun run smoke:computer-use:live
```
