# Browser Use Live Action Alias Coverage

`smoke:browser-use:live` now exercises selected `browser.use` action aliases against a real Chrome/Chromium CDP backend.

The live smoke sends alias inputs such as `browser_navigate`, `observe`, `fill`, `evaluate-js`, `browser_get_images`, `go-back`, and `browser_vision`, then asserts that the sidecar returns the canonical dispatched actions: `navigate`, `snapshot`, `type`, `evaluate`, `get_images`, `back`, and `vision`.

This keeps alias coverage on the same real-browser path as the ordinary action/read loop. It does not expose `browser.use` by default, does not share a user browser profile, does not use the real `brain.db`, and does not import browser runtimes into the kernel.
