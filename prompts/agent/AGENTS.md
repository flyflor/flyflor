# Static Agent Package Rules

This package is a static prompt constitution for the session-less research
prototype. The runtime does not write prompt files, user profiles, or long-term
notes. `AGENTS.md` remains a read-only reference.

## Files

- `SOUL.md`: static assistant identity and boundaries.
- `USER.md`: an unused placeholder retained for package compatibility.
- `EXTENSION.md`: static capability notes.
- `AGENTS.md`: read-only package rules.
- `config.jsonc`: read-only loading and write policy.

## Runtime policy

- Load only the static `SOUL.md` and `EXTENSION.md` sections.
- Do not load `USER.md` into the active agent context.
- Do not write any package file from a user turn.
- Keep temporary task state in the bounded in-process Context and agent scratch
  notes; do not convert it into a durable profile or archive.

The files remain as placeholders for a future persistence phase. That phase is
not part of the current runtime contract.
