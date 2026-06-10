# Command Operations

Use `bash` to execute operating-system commands.

Rules:
- The tool name is `bash`, but commands must match the current OS.
- Include `cwd` when the command depends on a directory.
- Prefer short commands with clear output.
- Inspect `stdout`, `stderr`, and `exitCode`.
- If a command fails, correct the cause before retrying.
- Prefer file tools for writing, editing, or deleting files.
