# External Tools Seal Report

## Scope

This report seals the external tool layer delivered through `external.tools.jsonc` and process-json sidecars. The Bun kernel discovers descriptors, forwards opaque sidecar config, and keeps execution behind Executive Tool Runtime, sandbox, approval, quota, and audit events.

No Memory, Scope, ASK, Crystal, fork, brain ledger, or context assembly path was changed for this tool layer.

## Layering Contract

External tools seal the middle layer of a three-layer tool model:

1. Builtin coding tools are first-party Executive capabilities for workspace files, patch, git, process, and shell. They remain compiled into the Bun kernel and are not reimplemented by sidecars.
2. Atomic sidecars are process-json capabilities governed by `external.tools.jsonc`. They provide narrow browser, web, media, native computer, LSP, task, hash, archive, and data-conversion tools.
3. `computer.use` is a future high-level controller over visible atomic computer/screen/browser tools. It does not bypass Executive Tool Runtime and does not replace builtin coding tools.

The sealed surface documents layer 2 and the discovery contract that lets `/ws` and TUI clients decide whether layer 3 can be shown. It does not implement a business sidecar or change the cognitive main chain.

## Capability Matrix

| Group | Tools | Runtime behavior | Missing dependency behavior |
| --- | --- | --- | --- |
| Builtin coding tools | workspace, patch, git, process, shell | First-party Executive primitives compiled into the kernel. | Not governed by `external.tools.jsonc`; sandbox/approval failures are normal Executive failures. |
| Browser CDP | `browser.open`, `browser.snapshot`, `browser.screenshot`, `browser.click`, `browser.type`, `browser.navigate`, `browser.evaluate` | Connects to an existing Chrome/Chromium CDP endpoint. No browser runtime is bundled. | Missing endpoint or connection failure returns structured `failed`/`unavailable`; kernel startup continues. |
| Search/Web | `web.search`, `web.fetch`, `web.extract`, `web.download` | Uses configured providers, fetches/extracts pages, and downloads only under `projectDir`. | Missing search provider returns `unavailable`; rejected paths or provider errors return `failed`. |
| Media | `vision.analyze`, `vision.ocr`, `audio.transcribe`, `audio.speak` | Delegates to HTTP JSON provider or configured local process-json command. No media SDK/model asset is bundled. | Missing `providerUrl` and missing matching local command return `unavailable`. |
| Native Computer | `screen.screenshot`, `computer.mouse`, `computer.keyboard`, `computer.window` | Probes platform commands for screen/window; mouse/keyboard require explicit delegates and computer approval. | Missing platform command or mouse/keyboard delegate returns `unavailable`; no hidden fallback controls the machine. |
| Utility | `lsp.symbols`, `lsp.diagnostics`, `task.background`, `file.hash`, `archive.create`, `archive.extract`, `data.convert` | LSP/task require delegates; hash/archive/data are lightweight sidecar utilities constrained to `projectDir`. | Missing LSP/task delegate returns `unavailable`; file/archive/path errors return `failed`. |
| High-level computer use | `computer.use` | Future facade over visible atomic computer/screen/browser tools. | Must surface dependency failures from the atomic tool that blocked execution. |

## Install Entrypoints

- `bun run install:xtools:browser-cdp`
- `bun run install:xtools:search-web`
- `bun run install:xtools:media`
- `bun run install:xtools:computer-native`
- `bun run install:xtools:utility`

Each installer writes only `~/.flyflor/.config/tools/external.tools.jsonc` unless `FLYFLOR_XTOOLS_TARGET` is provided.

## Runtime Governance

`~/.flyflor/.config/tools` is the runtime governance directory for external tool registry state, install receipts, enablement, policy, staged manifests, provider/delegate config, and disabled capability reasons. `~/.flyflor/tools` is the payload directory for installed runner files. Repository-local `./tools` remains a git-ignored development workspace and is never a runtime import surface.

`external.tools.jsonc` entries must stay JSONC-compatible and must be treated as descriptor/config data. The Bun kernel may discover descriptors and pass opaque sidecar config, but it must not load sidecar implementation files from the config directory or from `./tools`.

## Failure Semantics

Provider and delegate failures are visible protocol outcomes:

- `unavailable` means the required sidecar, provider, platform command, or delegate is absent.
- `failed` means the dependency exists but this invocation failed.
- Failure payloads must preserve machine-readable context such as tool name, rejected path, provider status, process exit code, stderr summary, or file error reason.
- Missing optional sidecars must not fail kernel startup. They remain visible as disabled descriptors, including `sourceId: "external:missing"` where applicable.

This keeps TUI and socket clients able to explain why a tool is not runnable without guessing from log text.

## WebSocket/TUI Contract

The `/ws` protocol exposes the tool capability surface through `server.hello.payload.kits` and `capability.catalog.get`. Missing sidecars remain visible as disabled user-tool capabilities with `sourceId: "external:missing"`, so TUI can display the complete matrix without loading sidecar code.

TUI and WS consumers must treat discovery as read-only data. They may render install/configuration state, approval state, quota state, lifecycle events, and audit evidence. They must not invoke sidecar scripts directly, import sidecar code, or infer high-level tool availability from tool-name strings. `computer.use` should be shown only when the catalog exposes the required atomic dependencies and approval profile.

The full external surface currently contains 26 tools:

`archive.create`, `archive.extract`, `audio.speak`, `audio.transcribe`, `browser.click`, `browser.evaluate`, `browser.navigate`, `browser.open`, `browser.screenshot`, `browser.snapshot`, `browser.type`, `computer.keyboard`, `computer.mouse`, `computer.window`, `data.convert`, `file.hash`, `lsp.diagnostics`, `lsp.symbols`, `screen.screenshot`, `task.background`, `vision.analyze`, `vision.ocr`, `web.download`, `web.extract`, `web.fetch`, `web.search`.

## Validation

- `bun test tests/web.search.sidecar.test.ts tests/media.sidecar.test.ts tests/computer.native.sidecar.test.ts tests/utility.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`
- `bun test tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts`
- `bun run docs:check`
- `bun run check`
- `git diff --check`

Seal checklist:

- Builtin coding tools, atomic sidecars, and `computer.use` are documented as separate layers.
- Provider/delegate failures are documented as `unavailable` or `failed`, not silent fallback.
- `~/.flyflor/.config/tools` is documented as governance and `~/.flyflor/tools` as payload.
- WS/TUI consumption stays on `server.hello.payload.kits`, `capability.catalog.get`, and events.
- No source code, sidecar implementation, package metadata, or OpenAPI contract is required for this documentation seal.
