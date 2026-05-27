# Browser Use Install And Opt-In

This note records how to install and opt in to the high-privilege `browser.use` sidecar without changing the default model-facing tool surface.

## Install

Install the project-local external tool registry entry:

```sh
bun run install:xtools:browser-use
```

The installer writes `tools/external.tools.jsonc` and a project-relative runner path under `tools/packages/browser-use/bin/flyflor`. It does not install a browser runtime and does not expose `browser.use` to the model by default.

## CDP Backend

Use the CDP backend when an existing Chrome or Chromium DevTools endpoint is available:

```json
{
  "backend": "cdp",
  "cdpUrl": "http://127.0.0.1:9222"
}
```

Example Chrome launch:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/flyflor-browser-use-profile \
  --no-first-run \
  about:blank
```

The live smoke uses a temporary profile and local page:

```sh
bun run smoke:browser-use:live
```

Use `--require-browser` when Chrome/Chromium must exist on the machine:

```sh
bun run scripts/browser.use.live.smoke.ts --require-browser
```

## Delegate Backend

Use the delegate backend when another process-json browser controller owns the real browser runtime:

```json
{
  "backend": "delegate",
  "delegateCommand": "./tools/packages/my-browser-delegate/bin/controller",
  "delegateArgs": []
}
```

The sidecar validates URLs, action inputs, timeout/output resource bounds, and `captureAfter` semantics before forwarding the request. The delegate receives the original process-json invocation and must return one JSON object on stdout.

## Exposure Boundary

The default manifest keeps `browser.use` registered with `tools: []`. To make the high-level control facade visible, an operator must explicitly add `browser.use` to the sidecar tool list and keep Executive approval, budget, quota, audit, ASK, plan, and yolo policies intact.

`browser.use` remains a child-process sidecar. The kernel owns descriptors, approvals, events, and process-json dispatch; it does not import browser automation libraries or browser runtime packages.
