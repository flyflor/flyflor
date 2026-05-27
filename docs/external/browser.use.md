# Browser Use External Tool

`browser.use` is the high-level browser-control facade for the external tool layer. It is a process-json sidecar capability, not a kernel import and not a replacement for workspace, git, process, shell, patch, or file tools.

## Owner Boundary

- Descriptor owner: `src/executive/external/tools.ts`.
- Bundled sidecar runner owner: `src/executive/sidecar/runner.ts`.
- Process-json sidecar owner: `scripts/browser.use.sidecar.ts`.
- Installer and registry owners: `tools/init.ts`, `tools/init.sh`, `tools/init.ps1`, `scripts/install.xtools.browser.use.sh`, and `tools/external.tools.jsonc`.
- Prompt usage guidance: `templates/prompts/mcp.context.md` and `templates/prompts/mcp.context.zh.cn.md`.

The kernel owns capability descriptors, approval metadata, event/audit flow, and process-json dispatch. The browser-use payload remains outside the kernel and runs as a child process.

## Execution Contract

`browser.use` accepts an `action` discriminator:

- Observation: `snapshot`, `screenshot`, `wait`.
- Navigation: `open`, `navigate`.
- Mutation or code execution: `click`, `type`, `evaluate`.

The tool supports two backends:

- `delegate`: forwards the validated process-json payload to a configured external command.
- `cdp`: talks to an existing Chrome/Chromium DevTools Protocol endpoint.

Unsafe navigation protocols are blocked before any backend runs: `javascript:`, `data:`, and `vbscript:`.

## Default Exposure

The real external tool manifest registers a `browser.use` sidecar with `tools: []`. This means the package path and config shape are discoverable, but the model does not receive the high-level control tool by default.

Mock manifests may expose `browser.use` so tests can verify catalog, socket, and runtime wiring.

## ASK And Permission Boundary

`browser.use` is tagged as a computer-control capability and must remain behind the Executive approval, quota, and audit gates. It should be used only when:

- The tool appears in the active model-facing catalog.
- The user requested a browser/desktop action loop, or a high-privilege mode explicitly grants it.
- Observation-first actions are insufficient for the task.

If budget, approval, or sidecar configuration blocks execution, the runtime should surface structured `unavailable`, `blocked`, or `failed` results and keep the ASK loop explicit.

## Verification

Focused verification lives in:

- `tests/browser.use.sidecar.test.ts`
- `tests/external.tools.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/install.script.test.ts`

The live closure smoke keeps `browser.use` unavailable by default so high-permission control does not leak into ordinary model turns.
