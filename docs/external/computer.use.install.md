# Computer Use Install Alignment

`computer.use` now follows the same install convention as `browser.use`: the real external tool manifest registers a process-json sidecar entry, but leaves `tools: []` so the model cannot call desktop control by default.

## Installed But Not Exposed

The default real registry contains:

- `command`: `./tools/packages/computer-use/bin/flyflor`
- `args`: `["xtool-sidecar", "computer.use"]`
- `cwd`: `app`
- `config.backend`: `delegate`
- empty delegate command and args
- `cuaCommand`: `cua-driver`
- `tools`: `[]`

This means the package, runner path, and config shape are present for diagnostics and opt-in editing, while the active capability catalog still hides `computer.use` until a user or project explicitly lists it in the sidecar `tools` array.

## Safety Boundary

`computer.use` remains a computer-control capability. Registering the sidecar entry does not grant mouse, keyboard, window, or desktop action authority. Tool Plan visibility, sandbox approval, Executive budget, quota, and audit events still decide whether a turn can execute it.

## Verification

The installer regression in `tests/install.script.test.ts` checks that the computer-use package exists, the manifest has the sidecar entry, and `tools` stays empty. Runtime execution is covered by `tests/external.use.runtime.test.ts`, which uses an explicit opt-in manifest and a deterministic delegate.
