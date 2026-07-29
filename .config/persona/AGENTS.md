# Static Agent Package Rules

This active profile is a static constitution for the session-less research
prototype. The runtime never writes package files, user profiles, or long-term
notes. This file is read-only and is not loaded into ordinary agent messages.

## Files

- `SOUL.md`: static assistant identity and boundaries.
- `USER.md`: an unused compatibility placeholder.
- `EXTENSION.md`: static capability notes.
- `AGENTS.md`: read-only package rules.
- `config.jsonc`: read-only loading and write policy.

## Runtime policy

- Load only `SOUL.md` and `EXTENSION.md`.
- Keep `USER.md` out of the active context.
- Reject all runtime package writes.
- Keep temporary task state in the bounded in-process Workspace and per-thread
  Scratchpad; do not create a durable user profile or conversation archive.

The unused `USER.md` file remains only for package compatibility. Persistence is
outside the current runtime contract.
