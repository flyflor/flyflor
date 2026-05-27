# Browser And Computer Use Prompt Boundary

`browser.use` and `computer.use` are model-visible only after explicit manifest opt-in and runtime visibility checks. When they are visible, their descriptor text must keep the model inside the intended execution layer:

- Treat both tools as high-privilege external sidecars.
- Prefer observation actions first.
- Use mutating browser or desktop actions only for explicit browser/desktop tasks.
- Do not use them as substitutes for workspace, git, process, shell, patch, or file tools.

This boundary is intentionally duplicated in the runtime MCP context prompt and in the tool descriptors. The prompt gives turn-level policy; the descriptors travel with the tool catalog and still constrain the model if the high-level tools are enabled by a local manifest.

The descriptor regression lives in `tests/external.tools.test.ts`.
