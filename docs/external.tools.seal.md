# External Tools Seal Report

## Scope

This report seals the external tool layer delivered through `external.tools.jsonc` and process-json sidecars. The Bun kernel discovers descriptors, forwards opaque sidecar config, and keeps execution behind Executive Tool Runtime, sandbox, approval, quota, and audit events.

No Memory, Scope, ASK, Crystal, fork, brain ledger, or context assembly path was changed for this tool layer.

## Capability Matrix

| Group | Tools | Runtime behavior |
| --- | --- | --- |
| Browser CDP | `browser.open`, `browser.snapshot`, `browser.screenshot`, `browser.click`, `browser.type`, `browser.navigate`, `browser.evaluate` | Connects to an existing Chrome/Chromium CDP endpoint. No browser runtime is bundled. |
| Search/Web | `web.search`, `web.fetch`, `web.extract`, `web.download` | Uses configured providers, fetches/extracts pages, and downloads only under `projectDir`. |
| Media | `vision.analyze`, `vision.ocr`, `audio.transcribe`, `audio.speak` | Delegates to HTTP JSON provider or configured local process-json command. No media SDK/model asset is bundled. |
| Native Computer | `screen.screenshot`, `computer.mouse`, `computer.keyboard`, `computer.window` | Probes platform commands for screen/window; mouse/keyboard require explicit delegates. |
| Utility | `lsp.symbols`, `lsp.diagnostics`, `task.background`, `file.hash`, `archive.create`, `archive.extract`, `data.convert` | LSP/task require delegates; hash/archive/data are lightweight sidecar utilities constrained to `projectDir`. |

## Install Entrypoints

- `bun run install:xtools:browser-cdp`
- `bun run install:xtools:search-web`
- `bun run install:xtools:media`
- `bun run install:xtools:computer-native`
- `bun run install:xtools:utility`

Each installer writes only `~/.flyflor/.config/tools/external.tools.jsonc` unless `FLYFLOR_XTOOLS_TARGET` is provided.

## WebSocket/TUI Contract

The `/ws` protocol exposes the tool capability surface through `server.hello.payload.kits` and `capability.catalog.get`. Missing sidecars remain visible as disabled user-tool capabilities with `sourceId: "external:missing"`, so TUI can display the complete matrix without loading sidecar code.

The full external surface currently contains 26 tools:

`archive.create`, `archive.extract`, `audio.speak`, `audio.transcribe`, `browser.click`, `browser.evaluate`, `browser.navigate`, `browser.open`, `browser.screenshot`, `browser.snapshot`, `browser.type`, `computer.keyboard`, `computer.mouse`, `computer.window`, `data.convert`, `file.hash`, `lsp.diagnostics`, `lsp.symbols`, `screen.screenshot`, `task.background`, `vision.analyze`, `vision.ocr`, `web.download`, `web.extract`, `web.fetch`, `web.search`.

## Validation

- `bun test tests/web.search.sidecar.test.ts tests/media.sidecar.test.ts tests/computer.native.sidecar.test.ts tests/utility.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`
- `bun test tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts`
- `bun run docs:check`
- `bun run check`
- `git diff --check`
