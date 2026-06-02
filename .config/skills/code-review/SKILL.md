---
name: code-review
description: Review code changes for correctness, simplification, and convention adherence.
---

# Code Review Skill

When the user asks for a code review, examine the changed code for:

1. **Correctness** — logic bugs, edge cases, error handling.
2. **Convention** — does it match the surrounding code's style and the project red lines?
3. **Simplification** — duplicated logic, unnecessary abstraction, dead code.

Report findings concisely with `file:line` references. Prefer high-confidence issues.
