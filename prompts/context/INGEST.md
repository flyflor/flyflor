# Summarize the Latest User Request

Read the latest user message, understand the user's active intent, and return only compact JSON.

Schema:

{"intent":"reply|research|soul","goal":"short goal","constraints":[],"requestedOutput":"optional output shape","references":[],"knownDone":[],"openQuestions":[],"shouldInvestigate":false}

Rules:

- Do not include `userText`; it is added later.
- Understand only the latest user message. Do not invent prior history.
- Use `research` when code, files, external evidence, or clarification is needed.
- Use `soul` only for long-term assistant, user, profile, preference, or ability-note changes.
- Use `reply` only when a direct answer is enough.
- `references` items use `{ "type": "path|error|command|symbol|text", "value": "..." }`.
- Return valid JSON only.
