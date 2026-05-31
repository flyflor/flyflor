# Signal And DI Lifecycle Design

## Goal

`SignalBus` is the vascular layer for runtime coordination. Runtime code should depend on project-owned methods instead of RxJS internals, while still leaving room for richer retry and stream composition later.

The DI container must wire `@Subscribe(signalName)` methods after constructing providers. This keeps subscriptions close to the component that owns the behavior and avoids hidden global event registration.

## Public Signal API

`subscribe(signal, handler)` registers a handler and returns an unsubscribe handle.

`emit(signal, payload)` broadcasts a raw signal and awaits subscribers in registration order.

`ask(signal, payload, options)` is the guard and confirm path. It returns an explicit subscriber boolean when present, otherwise follows auto-approval settings.

`complete(signal, payload)` emits a lifecycle completion event.

`final(signal, payload)` emits a final-value event for stream-like flows.

`fail(signal, error, payload)` emits a structured failure event.

`timeout(signal, payload)` emits a structured timeout event.

## DI Subscription Wiring

The container resolves a provider, applies `@Inject` property values, applies `@Prompt` property values, then reads `@Subscribe` metadata.

When a provider has subscription metadata and `SignalBus` is registered, the container resolves `SignalBus` and subscribes the decorated methods using the provider instance as `this`.

Subscription wiring must be idempotent per provider instance. Resolving the same singleton again must not register duplicate handlers.

## Validation

Scenario coverage must prove:

- `@Subscribe` methods receive emitted signals through the container.
- Re-resolving the same provider does not duplicate subscriptions.
- `complete`, `final`, `fail`, and `timeout` emit named lifecycle events.

## 2026-05-31 Amendment: Eager bootstrap and require-responder asks

`createContainer` only *registered* providers; it never resolved any, so a
provider that is a pure `@Subscribe` listener (e.g. `SandboxGuard`) was never
constructed and its handlers never attached on the `--serve` path. This made
`guard.ask` unattended in production.

Fix:

- `ModuleOptions`/`ModuleMetadata` gain `bootstrap?: readonly Constructor[]`.
- After registering every provider, `createContainer` resolves each module's
  `bootstrap` constructors. Resolution triggers `@Inject`/`@Prompt` wiring,
  `wireSubscriptions`, and any `init()` hook — so eager listeners are live and
  their subscriptions authoritative under the real executable path.
- A bootstrap provider is resolved exactly once (container singleton); listing it
  in `bootstrap` only forces early construction.
- Modules with runtime-critical listeners declare them in `bootstrap`:
  `SandboxModule.bootstrap = [SandboxGuard, GuardCoordinatorComponent]`. Worker,
  Crystal, Scope, and Forgetting listeners are bootstrapped in their own tracks.

`SignalBus.ask` gains require-responder semantics. For any `guard.*` ask (or when
`options.requireResponder` is set), if the bus has zero subscribers for the
signal, `ask` always emits `guard.unattended` (audited) and then resolves per the
`autoApproveGuards` policy: approve in dev, fail-safe deny in strict mode. The
real `--serve` path bootstraps `SandboxGuard`, so a responder is always present
and this fallback never runs in production. When a responder exists but returns
no boolean (a medium-risk escalation), `ask` keeps awaiting the external decision
as before.

Scenario coverage adds:

- `bootstrap` providers are constructed and their `@Subscribe` handlers attached
  by `createContainer` with no explicit `resolve`.
- A `guard.ask` with no responder emits `guard.unattended` (deny in strict mode,
  approve in dev) — never silent.
- With `SandboxGuard` bootstrapped, `guard.ask` is answered by the guard.
