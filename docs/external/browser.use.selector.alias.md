# Browser Use Selector Alias

This note records a small model-facing compatibility alias for opt-in `browser.use`.

`click` and `type` now accept either:

- `target`: the existing selector field.
- `selector`: an explicit CSS selector alias.

The alias only affects the high-privilege `browser.use` sidecar after it is already visible through the normal manifest, approval, quota, and local computer-control gates. It does not expose browser control by default and does not add any kernel browser runtime import.

For the CDP backend, `selector` is resolved exactly like `target` and is used with `document.querySelector`. For delegate backends, the original process-json input is forwarded unchanged, so external browser-use packages can keep their own selector/ref semantics.

Focused coverage lives in `tests/browser.use.sidecar.test.ts`, `tests/external.tools.test.ts`, and the real `smoke:browser-use:live` flow.
