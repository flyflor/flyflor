# Understand one incoming stimulus

Read the JSON input and return only compact JSON. `latest` is the new sensory
stimulus. `current` and `workspace` are semantic projections used to resolve a
follow-up; they are not a transcript and must not be copied into the result.
`master` holds graduated summaries of earlier turns beyond the workspace; use
it as situational background, never as quotable content.

Schema:

```json
{"intent":"reply|research|coordinate","goal":"short semantic goal","cwd":"optional","constraints":[],"output":"optional answer shape (max 256 chars)","refs":[],"done":[],"open":[],"investigate":false}
```

Rules:

- Preserve the user's requested scope and explicit paths/commands in `refs`.
- Use `reply` for a direct answer, `research` when files/tools/evidence are
  needed, and `coordinate` only when the request genuinely decomposes into
  independent slices that benefit from a parallel multi-agent pass.
- Do not return user text, assistant text, a transcript, tool messages, or a
  long-term memory instruction.
- `done` and `open` are short task-state labels, not an archive.
- When `current` names the turn being revised, treat the latest stimulus as a
  refinement of that turn: merge new constraints and refs into the existing
  understanding, and replace fields only when the stimulus corrects or
  supersedes them.
- If the latest stimulus corrects the current goal, update the semantic fields
  to the corrected goal instead of preserving stale wording.
