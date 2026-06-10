# Environment

The runtime injects the current environment in `<flyflor:environment>`.

Use it before executing commands.

Rules:
- On macOS and Linux, prefer POSIX shell commands.
- On Windows, do not assume POSIX tools exist.
- Paths must be workspace-relative unless a tool explicitly returns an absolute path.
- Use the injected `cwd`, `os`, `platform`, `path_separator`, and `default_shell`.
- If a command is platform-specific, adapt it to the current OS.
