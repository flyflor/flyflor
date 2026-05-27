# External Manifest Resource Bounds

`external.tools.jsonc` is the first boundary for process-json sidecar resource budgets.

The manifest loader rejects resource values that would exceed the sidecar runner bounds before the tool catalog is built:

- `timeoutMs` must be a positive integer no greater than `120000`.
- `maxOutputBytes` must be a positive integer no greater than `2097152`.

This keeps invalid external tool packages from becoming model-visible capabilities. The sidecars still enforce the same bounds at execution time, so project-local manifests and direct sidecar invocations fail consistently.

The manifest bound does not grant extra execution budget. Executive approval, ASK, plan, yolo, loop guard, event/audit, and process-json dispatch remain the only runtime authority path.
