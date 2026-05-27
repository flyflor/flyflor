# User Tool Resource Bounds

User manifest tools from `.flyflor/tools.jsonc` run through the same process-json child-process bridge as external sidecars.

The manifest loader rejects executor resource values that exceed the shared sidecar runner bounds before the tool enters the visible catalog:

- `timeoutMs` must be a positive integer no greater than `120000`.
- `maxOutputBytes` must be a positive integer no greater than `2097152`.

This prevents local user tool manifests from silently widening a single tool call beyond the Executive loop's resource expectations. Approval, ASK, plan, yolo, quota, event/audit, and process-json dispatch remain the only authority path.
