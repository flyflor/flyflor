Use this tool for single-command execution and local environment checks.

Rules:

- `command` must be an executable name or absolute path.
- `args` is the argument list passed to that executable.
- Do not put pipes, redirects, `&&`, `||`, subshells, or other shell syntax into `command`.
- Use `execute` for scripts, queues, batch work, or multi-step command flows.
- The runtime description is fixed and does not carry turn-specific working-directory semantics.
