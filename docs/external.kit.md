# External Kit Protocol

External Kit is the read-only discovery protocol for optional external capabilities. It is not the first-party CLI, TUI, or socket compatibility layer, and it does not execute tools by itself.

## Runtime Ownership

- `~/.flyflor/.config/tools` is the future user-level control surface for tool registry, installed receipts, enablement, policy, and staging manifests.
- `~/.flyflor/tools` is the future user-level payload directory for installed sidecar runners and their versioned files.
- `./tools` at the repository root is only a local development workspace beside `src`. It is git ignored and must not be committed.

The development `./tools` directory may contain Browser CDP, screen, vision, audio, LSP, or other sidecar experiments. Runtime discovery must still happen through explicit manifests and structured capability registration. Do not make the kernel import implementation files from `./tools`.

## Current Mainline Surface

- `src/socket/kit/manifest.ts`
- `src/socket/kit/catalog.ts`
- `src/socket/kit/index.ts`
- `src/executive/external/tools.ts`

These modules only:

- read builtin, global, and workspace-local kit manifests
- summarize MCP, plugin, skill, user tool, and external sidecar capability catalogs
- expose read-only snapshots through `server.hello` and `capability.catalog.snapshot`

External sidecar discovery reads `external.tools.jsonc` from `~/.flyflor/.config/tools` and `./.flyflor/tools`. External Kit catalog manifests still live under the kit directories; the two control planes are intentionally separate.

## Boundaries

- External Kit does not execute tools.
- External Kit does not import Runtime private implementation.
- External Kit does not import CLI/TUI implementation.
- External tools must not duplicate builtin file read/write, patch, git, process, or shell primitives.
- Missing sidecars are reported as unavailable descriptors, not startup failures.

Real execution must enter Executive Tool Runtime, sandbox, approval, quota, and audit events.

## Browser CDP Sidecar

The minimal Browser CDP sidecar is a process-json adapter at `scripts/browser.cdp.sidecar.ts`.
It has no bundled browser runtime and does not install Playwright or Chrome. It connects to an
already-running Chrome/Chromium DevTools Protocol endpoint, defaulting to `http://127.0.0.1:9222`.

Install the manifest from a source checkout:

```bash
bun run install:xtools:browser-cdp
```

Override the endpoint when needed:

```bash
FLYFLOR_BROWSER_CDP_URL=http://127.0.0.1:9333 bun run install:xtools:browser-cdp
```

The installer writes only `external.tools.jsonc` under `~/.flyflor/.config/tools` unless
`FLYFLOR_XTOOLS_TARGET` is set. It registers `browser.open`, `browser.snapshot`,
`browser.screenshot`, `browser.click`, `browser.type`, `browser.navigate`, and
`browser.evaluate` to the `browser.cdp` sidecar. Actual invocation still goes through the
Executive tool runtime, sandbox gate, approval policy, quota, and audit events.

Example Chrome launch:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/flyflor-browser-cdp
```
