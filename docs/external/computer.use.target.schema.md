# Computer Use Target Schema

This note records the Hermes-aligned target field contract for `computer.use`.

- `element`, `fromElement`, and `toElement` are positive integer SOM indexes.
- `coordinate`, `fromCoordinate`, and `toCoordinate` are two-item integer arrays.
- `maxElements` is an integer from `1` to `1000`.

The descriptor and sidecar validation must stay in lockstep. Invalid target values fail before spawning the external delegate, so the kernel observes a structured tool failure instead of a backend-specific error.

