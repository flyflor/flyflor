# Browser Use Live Smoke

`smoke:browser-use:live` is an optional real-browser closure check for the high-level `browser.use` sidecar.

The smoke launches a local Chrome or Chromium process with a temporary profile, starts a local HTML page, drives `browser.use` through the CDP backend, and verifies the action/read loop:

- `open`
- `navigate`
- `type` with `captureAfter`
- `click` with `captureAfter`
- `evaluate` DOM state
- `screenshot`

If Chrome or Chromium is not installed, the default command exits successfully with a structured skip:

```sh
bun run smoke:browser-use:live
```

Use `--require-browser` when a CI or local machine is expected to provide a browser:

```sh
bun run scripts/browser.use.live.smoke.ts --require-browser
```

The smoke does not expose `browser.use` to normal model turns. The default external manifest still keeps the sidecar registered with `tools: []`; users must explicitly opt in before high-risk browser control is visible to the model. The script also does not use the real `brain.db`, does not share a user browser profile, and does not import browser automation libraries into the kernel.

Set `FLYFLOR_BROWSER_BIN` to force a specific browser binary:

```sh
FLYFLOR_BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run smoke:browser-use:live
```
