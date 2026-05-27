# Browser Use Hermes Refs

This note records the CDP-side `browser.use` ref loop that mirrors the Hermes browser workflow.

## Contract

`snapshot` defaults to a compact interactive-element snapshot. The sidecar evaluates the current page, finds visible interactive elements, assigns stable page-local refs such as `@e1`, and stores them on DOM nodes as `data-flyflor-ref`.

`click` and `type` then accept:

- `ref`: `@eN` from the latest compact snapshot.
- `target`: either a CSS selector or `@eN`.
- `selector`: a CSS selector alias.

`snapshot` with `full: true` keeps the previous Accessibility full-tree path. Compact snapshots accept `maxElements` with the same `1..1000` bound used by the descriptor.

## Boundary

Refs are page-local hints owned by the browser sidecar. The kernel does not store ref maps, parse DOM, import browser runtime packages, or infer targets from text. Execution still goes through the external process-json sidecar after normal manifest opt-in, visibility, approval, quota, and audit gates.

Delegate backends continue to receive the original process-json input unchanged, so external browser-use packages may keep their own ref semantics.

## Verification

Focused coverage lives in:

- `tests/browser.use.sidecar.test.ts`
- `tests/external.tools.test.ts`
- `scripts/browser.use.live.smoke.ts`

The live browser smoke now verifies `snapshot-refs`, `type-ref-captureAfter`, and `click-ref-captureAfter` against a real Chrome/Chromium CDP endpoint.
