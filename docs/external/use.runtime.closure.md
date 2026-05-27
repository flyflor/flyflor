# External Use Runtime Closure

This note records the opt-in runtime closure for `browser.use` and `computer.use`.

## Boundary

- The external registry owns descriptors in `src/executive/external/tools.ts`.
- The runtime executes them as `user` server process-json tools after Tool Plan visibility filtering.
- The kernel never imports browser or desktop automation runtimes.
- The sidecars run as child processes through `scripts/browser.use.sidecar.ts` and `scripts/computer.use.sidecar.ts`.

## Default Versus Opt-In

The default real manifest keeps high-level control tools out of the model surface. `browser.use` and `computer.use` become callable only when a manifest explicitly lists them in the sidecar `tools` array and the active surface is local, project scoped, and computer-capable.

Remote surfaces still hide these capabilities even when the sidecar command exists. This keeps browser and desktop control tied to explicit local authority instead of package presence.

## Runtime Closure

The focused closure in `tests/external.use.runtime.test.ts` verifies:

- `loadExternalTools` marks opt-in `browser.use` and `computer.use` sidecars available.
- `RuntimeMcpToolPlanComponent` exposes them only on a local computer-capable surface.
- `RuntimeMcpToolExecutor` executes both through the normal `user` process-json path.
- Delegate execution returns structured responses, including follow-up `captureAfter` observation payloads.
- The process path emits plugin invoke start/end events, keeping the socket/event vascular layer observable.

The test uses `scripts/mock.sidecar.ts` as the deterministic delegate. It does not use real browser clicks, keyboard input, mouse movement, or screen control.

## Safety Rule

Opt-in runtime closure proves the pipe is connected; it does not relax the default safety posture. Real high-permission browser or computer delegates must still be explicitly installed, listed in the manifest, and gated by Executive approval, budget, quota, and audit events.
