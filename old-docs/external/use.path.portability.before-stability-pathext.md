# Browser And Computer Use Path Portability

`browser.use` and `computer.use` delegate execution stays inside process-json sidecars. The kernel registers descriptors and executor metadata; it does not import browser or desktop runtimes.

Delegate command lookup supports:

- explicit absolute commands, when a user intentionally configures one;
- app/project relative commands such as `./tools/packages/...`;
- PATH commands;
- PATHEXT-style executable suffixes such as `.cmd`, `.exe`, `.bat`, and `.com`.

This keeps Windows-style delegates usable without forcing manifests to hard-code platform suffixes. It also keeps the default real manifests portable because the installed package commands remain app-relative and `tools: []` until explicit opt-in.

Regression coverage lives in:

- `tests/browser.use.sidecar.test.ts`
- `tests/computer.use.sidecar.test.ts`
