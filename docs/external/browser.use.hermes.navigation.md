# Browser Use Hermes Navigation

`browser.use` now includes two more Hermes-style high-level actions:

- `back` navigates to the previous browser history entry through CDP `Page.getNavigationHistory` and `Page.navigateToHistoryEntry`.
- `get_images` reads visible page image metadata with `Runtime.evaluate` and returns `src`, `alt`, `width`, and `height` entries. `maxImages` is an optional integer cap from `1..1000`.

These remain opt-in browser-control actions. The kernel only exposes the descriptor and dispatch metadata; execution still happens through the process-json sidecar, with Executive visibility, approval, quota, audit events, ASK, plan, and yolo boundaries unchanged.
