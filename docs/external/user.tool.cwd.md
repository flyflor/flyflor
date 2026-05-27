# User Tool Working Directory Boundary

User manifest tools from `.flyflor/tools.jsonc` and external sidecars from `tools/external.tools.jsonc` share the same process-json runner, but their `cwd` anchors are intentionally distinct.

- User manifest `cwd: "project"` runs from `paths.projectDir`, so project-relative tool scripts behave like workspace-local commands.
- External sidecar `cwd: "project"` remains a compatibility alias for the app-root anchor because `external.tools.jsonc` package entries were sealed with that convention.
- `cwd: "app"`, `cwd: "config"`, and `cwd: "workspace"` keep their explicit anchors.

This keeps project tools ergonomic without changing the sealed external sidecar protocol. Execution still goes through the plugin sandbox gate, approval policy, quota, subprocess JSON bridge, and runtime events.
