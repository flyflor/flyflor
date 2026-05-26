# External Kit Protocol

External Kit is the read-only discovery protocol for optional external capabilities. It is not the first-party CLI, TUI, or socket compatibility layer, and it does not execute tools by itself.

## Three-Layer Tool Model

Flyflor exposes tools in three layers. The layers are additive, but they do not share ownership:

| Layer | Examples | Owner | Execution contract |
| --- | --- | --- | --- |
| Builtin coding tools | workspace read/write, patch, git, process, shell | Bun kernel / Executive | First-party coding primitives. They are compiled into the kernel and remain behind sandbox, approval, quota, and audit gates. |
| Atomic sidecars | `browser.*`, `web.*`, `vision.*`, `audio.*`, `screen.*`, `computer.mouse`, `computer.keyboard`, `lsp.*`, `task.background`, `file.hash`, `archive.*`, `data.convert` | External process-json runners | Small delegated capabilities discovered from `external.tools.jsonc`. Each tool has one narrow capability descriptor and returns structured success, `failed`, or `unavailable`. |
| High-level computer use | `computer.use` | Future high-level controller | A planning/execution facade over visible atomic computer/screen/browser tools. It is not a replacement for builtin coding tools and must still execute through Executive Tool Runtime. |

`computer.use` is intentionally a high-level capability. It may decide to call atomic sidecars such as screenshot, mouse, keyboard, window, or browser control, but it does not gain a private execution channel. If required delegates or providers are missing, the high-level call must surface the same structured failure semantics as the atomic tool that blocked it.

## Compatibility Matrix

| Capability family | Builtin coding tools | Atomic sidecar | `computer.use` dependency | Notes |
| --- | --- | --- | --- | --- |
| Workspace files, patch, git | Yes | No | No | External sidecars must not duplicate first-party coding primitives. |
| Process and shell escape | Yes | No | No | Shell remains a high-risk builtin escape hatch, not a sidecar abstraction. |
| Browser CDP | No | Yes | Optional | Requires an existing Chrome/Chromium CDP endpoint. |
| Search and web fetch | No | Yes | Optional | Search requires configured providers; fetch/extract/download are constrained by sidecar policy and `projectDir`. |
| Vision and audio | No | Yes | Optional | Requires HTTP provider or per-tool local process-json delegate. No SDK or model asset is bundled. |
| Screen observation | No | Yes | Yes | Platform commands may provide screenshot/window observation. Missing commands report `unavailable`. |
| Mouse and keyboard control | No | Yes | Yes | Requires explicit delegate commands and computer approval. No hidden fallback performs control actions. |
| LSP and background tasks | No | Yes | Optional | Requires explicit delegate commands. |
| Hash/archive/data conversion | No | Yes | Optional | Lightweight utilities constrained to `projectDir`; they do not replace workspace primitives. |

## Provider And Delegate Failures

External tool failures are part of the protocol, not log-only diagnostics:

- `unavailable`: the sidecar, provider, platform command, or delegate is absent. This is used for missing search providers, missing media providers, missing mouse/keyboard delegates, missing LSP/task delegates, and missing platform screen/window commands.
- `failed`: the capability was available, but the invocation failed. The result must include the tool name and enough structured detail for audit, such as exit code, stderr summary, provider status, file error, or rejected path.
- Startup discovery must not fail the Bun kernel just because an optional sidecar is missing. Missing sidecars remain visible as disabled descriptors so clients can explain what is installable or misconfigured.

The sidecar may receive opaque config from `external.tools.jsonc`, but semantic decisions still belong to the model/output protocol or Executive resource metrics. Sidecars must not infer user intent from natural-language text.

## Relative Paths And Stability Snapshot

`external.tools.jsonc` v2 keeps package commands portable:

```jsonc
{
  "schemaVersion": 2,
  "sidecars": {
    "web.search": {
      "command": "./tools/packages/search-web/bin/flyflor",
      "cwd": "app",
      "tools": ["web.search", "web.fetch", "web.extract", "web.download"]
    }
  }
}
```

Persistent config and manifests must store relative commands or PATH commands only. `cwd: "app"` resolves against `paths.appRoot`; `cwd: "project"` remains a compatibility alias for the same app-root anchor. `cwd: "config"` and `cwd: "workspace"` are explicit alternate anchors. Runtime may resolve absolute paths for IO, but it must not write those absolute paths back into config or manifest files.

Discovery attaches a structured stability snapshot to every external tool descriptor:

- `discovery`: `configured | missing | disabled`
- `manifest`: `valid | invalid`
- `path`: `resolved | unresolved | outside-root-denied`, plus mode/base/portable/rootSafe details
- `version`: `compatible | incompatible | unknown`
- `probe`: `healthy | degraded | unavailable | skipped`
- `runtime`: `ready | failed | timed-out | schema-error`
- `sandbox`: `allowed | approval-required | denied | quota-limited`
- `upgrade`: `idle | staged | applying | rollback-required | failed`
- `effective`: `available | degraded | unavailable | disabled`

Tool Plan registers descriptors for diagnostics, but only `effective=available` or allowed `degraded` tools are visible to the model. Unavailable, disabled, incompatible, or upgrading tools remain hidden with `availability` diagnostics for TUI/socket rendering.

## Upgrade Transaction

External package upgrades are owned by `ExternalToolPackageManagerComponent`. The manager stages package metadata under `tools/packages/.staging/<id>@<version>`, writes `tools/external.tools.jsonc.next`, and applies by moving staged packages into `tools/packages/<id>` while preserving the previous package under `tools/packages/.previous`.

Rules:

- Package metadata and generated next manifests use relative commands only.
- The kernel never imports package payload implementation files.
- Upgrade states are reflected in the stability snapshot.
- `upgrade=applying`, `rollback-required`, or `failed` hides the tool from the model.
- High-risk repair, reinstall, or rollback decisions should enter ASK rather than being inferred from error text.

## Runtime Ownership

- `tools/external.tools.jsonc` is the project-local external tool registry loaded by the kernel.
- `tools/packages` is the isolated local payload directory for optional packages and delegates.
- `tools/init.sh`, `tools/init.ps1`, and `tools/init.ts` initialize the registry without making the kernel import package implementation files.

The `tools/` directory may contain Browser CDP, screen, vision, audio, LSP, or other sidecar packages under `tools/packages`. Runtime discovery still happens only through `tools/external.tools.jsonc` and structured capability registration. Do not make the kernel import implementation files from `tools/packages`.

## Current Mainline Surface

- `src/socket/kit/manifest.ts`
- `src/socket/kit/catalog.ts`
- `src/socket/kit/index.ts`
- `src/executive/external/tools.ts`

These modules only:

- read builtin, global, and workspace-local kit manifests
- summarize MCP, plugin, skill, user tool, and external sidecar capability catalogs
- expose read-only snapshots through `server.hello` and `capability.catalog.snapshot`

External sidecar discovery reads `tools/external.tools.jsonc` from the project root. External Kit catalog manifests still live under the kit directories; the two control planes are intentionally separate.

## Boundaries

- External Kit does not execute tools.
- External Kit does not import Runtime private implementation.
- External Kit does not import CLI/TUI implementation.
- External tools must not duplicate builtin file read/write, patch, git, process, or shell primitives.
- Missing sidecars are reported as unavailable descriptors, not startup failures.

Real execution must enter Executive Tool Runtime, sandbox, approval, quota, and audit events.

## WebSocket And TUI Consumption

`/ws` clients and TUI shells consume the tool surface as data:

- `server.hello.payload.kits` and `capability.catalog.get` expose read-only kit and capability snapshots.
- Disabled or missing sidecars remain visible with structured reasons, so clients can render installation/configuration states without importing sidecar code.
- Tool invocation still happens through the normal Executive tool runtime. A TUI must not call sidecar scripts directly or treat kit discovery as an execution API.
- Runtime event subscriptions may display tool lifecycle, approval, quota, and audit state, but they do not own tool scheduling or provider fallback.
- `computer.use` consumers should render it as a high-level capability only when its required atomic dependencies and approval profile are visible.

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

The installer writes `tools/external.tools.jsonc` by default unless `FLYFLOR_XTOOLS_TARGET` is set. It registers `browser.open`, `browser.snapshot`,
`browser.screenshot`, `browser.click`, `browser.type`, `browser.navigate`, and
`browser.evaluate` to the `browser.cdp` sidecar. Actual invocation still goes through the
Executive tool runtime, sandbox gate, approval policy, quota, and audit events.

Example Chrome launch:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/flyflor-browser-cdp
```

## Search/Web Sidecar

`scripts/web.search.sidecar.ts` is the lightweight process-json adapter for `web.search`,
`web.fetch`, `web.extract`, and `web.download`. It uses configured providers only; if no
provider is configured, `web.search` fails explicitly instead of returning placeholder data.

```bash
bun run install:xtools:search-web
```

The installer writes `external.tools.jsonc` with an empty `providers` list. Add provider
entries under `sidecars.web.search.config.providers` in `tools/external.tools.jsonc`.
Generic providers must return an array of objects with `title`, `url`, and `snippet` fields.

## Media Sidecar

`scripts/media.sidecar.ts` is the lightweight bridge for `vision.analyze`, `vision.ocr`,
`audio.transcribe`, and `audio.speak`.

```bash
bun run install:xtools:media
```

The installer only registers the process-json sidecar. It does not install OCR, Whisper,
TTS, vision SDKs, local model assets, native addons, or postinstall hooks. Runtime work is
delegated through `sidecars.media.local.config`:

- `providerUrl`: HTTP JSON provider endpoint.
- `providerHeaders`: optional HTTP headers.
- `localCommands`: optional per-tool process-json delegate map.

If neither `providerUrl` nor a matching local command is configured, the sidecar exits nonzero
with an explicit `unavailable` response.

## Native Computer Sidecar

`scripts/computer.native.sidecar.ts` bridges `screen.screenshot`, `computer.mouse`,
`computer.keyboard`, and `computer.window`.

```bash
bun run install:xtools:computer-native
```

Screenshots and window observation use platform commands when available:

- macOS: `screencapture`, `osascript`
- Windows: `powershell`
- Linux: `grim`, `gnome-screenshot`, `spectacle`, `xdotool`, or `wmctrl`

Mouse and keyboard actions require explicit delegate commands in
`sidecars.computer.native.config.mouseCommand` and `keyboardCommand`. Missing delegates fail
with `unavailable`; no hidden fallback performs control actions. Screenshot output paths must
stay under `projectDir`.

## Utility Sidecar

`scripts/utility.sidecar.ts` covers LSP delegates, background task delegates, file hashing,
archive create/extract, and small structured data conversion.

```bash
bun run install:xtools:utility
```

It registers:

- `lsp.symbols`
- `lsp.diagnostics`
- `task.background`
- `file.hash`
- `archive.create`
- `archive.extract`
- `data.convert`

`file.hash`, `archive.*`, and `data.convert` are lightweight sidecar utilities. They do not
replace builtin workspace/git/process/shell primitives. LSP and background task execution require
explicit `lspCommand` and `taskCommand` delegates in `external.tools.jsonc`. File and archive paths
must stay under `projectDir`.

## Validation Checklist

Before sealing external tool documentation or installers:

- `external.tools.jsonc` examples keep builtin coding tools, atomic sidecars, and `computer.use` separated.
- Every provider/delegate-dependent tool documents its `unavailable` behavior.
- Missing sidecars remain discoverable as disabled descriptors instead of failing kernel startup.
- Paths that write or download files stay under `projectDir`.
- WS/TUI docs consume `server.hello.payload.kits`, `capability.catalog.get`, and events only; they do not call sidecar scripts directly.
- `bun run docs:check`
- `bun test tests/docs.references.test.ts`
- `git diff --check`
