# Browser And Computer Use Path Portability

`browser.use` and `computer.use` delegate execution stays inside process-json sidecars. The kernel registers descriptors and executor metadata; it does not import browser or desktop runtimes.

Command lookup supports the same portability floor in two places:

- manifest stability preflight, before a sidecar becomes model-visible;
- sidecar delegate execution, before a nested process-json backend is spawned.

Both layers accept:

- explicit absolute delegate commands, when a user intentionally configures one inside sidecar config;
- app/project relative manifest commands such as `./tools/packages/...`;
- PATH commands;
- PATHEXT-style executable suffixes such as `.cmd`, `.exe`, `.bat`, and `.com`.

This keeps Windows-style package entries usable without forcing manifests to hard-code platform suffixes. It also keeps the default real manifests portable because the installed package commands remain app-relative and `tools: []` until explicit opt-in.

Regression coverage lives in:

- `tests/external.tools.test.ts`
- `tests/browser.use.sidecar.test.ts`
- `tests/computer.use.sidecar.test.ts`
