# Record a Compact Completion Note

Create a compact note for the completed work. Return only compact JSON.

Input contains `user`, `assistant`, `completed`, `current`, `recent`, and optional text-only `evidence`, `decisions`, `remaining`.

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

Rules:

- Do not include `createdAt`; it is added later.
- Keep it short but preserve enough recovery clues for the next turn.
- Record the result, useful decisions, project/scope anchor, evidence, and remaining work.
- Prefer explicit project names, paths, symbols, commands, and verified outcomes over generic prose.
- If the assistant corrected a wrong project/scope, record that correction as a decision or evidence item.
- Use only compact text summaries. Do not serialize tool requests or raw service messages.
- Never include transcripts, action buffers, provider roles, tool call IDs, or raw tool payloads.
- Return valid JSON only.
