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
