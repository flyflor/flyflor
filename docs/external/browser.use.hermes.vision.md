# Browser Use Hermes Vision

This note records the Hermes-aligned `vision` action on the opt-in `browser.use` sidecar.

## Boundary

`browser.use` remains an external process-json capability. The kernel owns only descriptor metadata, visibility, approval, quota, event/audit flow, and child-process dispatch. It does not import browser, screenshot, OCR, vision-model, or desktop automation runtimes.

The CDP backend may capture the current page screenshot with `Page.captureScreenshot`, but visual analysis is delegated to a separate process-json command configured as `visionDelegateCommand`. Missing delegate configuration returns structured `unavailable`.

## Action

`input.action: "vision"` requires:

- `question`: the visual question to ask about the current page.

It also accepts:

- `annotate`: boolean hint for delegates that can overlay numbered labels on interactive elements.
- `format`: screenshot format, defaulting to `png`.

The delegate receives a process-json payload with the original input, `question`, `annotate`, and `screenshot: { data, format }`. The sidecar response returns screenshot metadata (`format`, `dataBytes`) plus the delegate response, not the full screenshot bytes.

## Verification

Focused coverage lives in:

- `tests/browser.use.sidecar.test.ts`
- `tests/external.tools.test.ts`
- `scripts/browser.use.live.smoke.ts`

The live smoke uses a fake process-json vision delegate to prove the real CDP screenshot and subprocess handoff without adding a bundled vision provider.
