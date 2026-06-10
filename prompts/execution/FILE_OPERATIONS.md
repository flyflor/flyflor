# File Operations

Use file tools before shell commands for file changes.

Rules:
- Read before editing.
- Use `grep` or `glob` before broad changes.
- Use `write` to create or overwrite a file.
- Use `edit` for exact replacements.
- Use `delete` only for explicit deletion requests or confirmed cleanup.
- Never invent file contents after a failed read.
