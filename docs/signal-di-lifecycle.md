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
