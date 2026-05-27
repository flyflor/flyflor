# Browser CDP External Tool

`browser.cdp` is the atomic browser sidecar for `browser.open`, `browser.snapshot`, `browser.screenshot`, `browser.click`, `browser.type`, `browser.navigate`, and `browser.evaluate`.

It is lower level than `browser.use`: it executes one browser action per process-json request and does not plan or chain actions. The kernel still owns descriptors, visibility, approval, quota, and audit; the CDP adapter remains a child process.

## Runtime Boundary

- Sidecar owner: `scripts/browser.cdp.sidecar.ts`.
- Descriptor owner: `src/executive/external/tools.ts`.
- Installer owner: `scripts/install.xtools.browser.cdp.sh` and `tools/init.*`.

The sidecar connects to an existing Chrome/Chromium DevTools Protocol endpoint. It does not install Chrome, Playwright, or browser automation libraries.

## Safety Semantics

- `browser.open` and `browser.navigate` reject `javascript:`, `data:`, and `vbscript:` URLs before making CDP calls.
- `browser.click` and `browser.type` use `Runtime.evaluate` with a DOM action expression.
- Missing DOM targets return a structured failed process-json result instead of being hidden as a successful CDP response.
- User-authored `browser.evaluate` remains an explicit code execution action and must stay behind the normal Executive approval, quota, and audit gates.

## Relationship To Browser Use

`browser.use` may provide a higher-level capture/action/verify loop. `browser.cdp` remains the atomic adapter and should stay small: one request, one CDP action, one structured result.
