# Browser Use Hermes Console

`browser.use` now includes a Hermes-style `console` action.

The CDP backend evaluates a small page-local console buffer through `Runtime.evaluate`:

- `expression` optionally runs JavaScript in the page context, like DevTools console evaluation.
- `clear` optionally clears the captured page-local buffer after reading.
- The result returns captured `log/info/warn/error/debug` messages, uncaught errors after the hook is installed, and the serialized expression result.

The action remains inside the opt-in high-privilege `browser.use` surface. The kernel only exposes descriptor and dispatch metadata; browser execution still happens through the process-json sidecar and stays behind Executive visibility, approval, quota, audit events, ASK, plan, and yolo boundaries.
