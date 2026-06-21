# Context Ingest Prompt

Read the latest user message and return only compact JSON.

Schema:

{"intent":"reply|research|soul","goal":"short goal","constraints":[],"requestedOutput":"optional output shape","references":[],"knownDone":[],"openQuestions":[],"shouldInvestigate":false}

Rules:

- Do not include `userText`; runtime adds it.
- Use `research` when code, files, external evidence, or clarification is needed.
- Use `soul` only for durable agent/user/profile/capability memory changes.
- Use `reply` only when a direct answer is enough.
- `references` items use `{ "type": "path|error|command|symbol|text", "value": "..." }`.
- Return valid JSON only.
