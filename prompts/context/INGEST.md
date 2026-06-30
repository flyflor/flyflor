# Summarize the Latest User Request

Read the JSON input, understand the user's active intent from `latest`, and return only compact JSON.

Input shape:

- `latest`: the newest user message and the only source for new requested work.
- `current`: the previous active understanding, if any.
- `recent`: compact Context-owned turn records with user text, assistant text, status, summary, and pause.

Schema:

{"intent":"reply|research|soul","goal":"short goal","workingDirectory":"optional working directory for latest","constraints":[],"requestedOutput":"optional output shape","references":[],"knownDone":[],"openQuestions":[],"shouldInvestigate":false}

Rules:

- Do not include `userText`; it is added later.
- Understand only `latest` as the new user request. Do not invent prior history.
- Use `recent` only to keep continuity, resolve pronouns, and avoid mixing similar projects.
- If `latest` contradicts `recent`, trust `latest`.
- Set `workingDirectory` when `latest` explicitly names the directory or project path to work in.
- Also set `workingDirectory` when `latest` itself refers to one previously named project or directory, such as "this project", "that project", "here", or "continue", and `current` or `recent` can resolve that reference to exactly one working directory.
- Use `current` and `recent` only as semantic evidence for resolving the latest message. Do not treat them as a default source of `workingDirectory`.
- If `latest` has no project/directory reference, or more than one working directory could match, leave `workingDirectory` empty.
- Use `research` when code, files, external evidence, or clarification is needed.
- Use `soul` only for long-term assistant, user, profile, preference, or ability-note changes.
- Use `reply` only when a direct answer is enough.
- `references` items use `{ "type": "path|error|command|symbol|text", "value": "..." }`.
- Put explicit project names, roots, paths, commands, symbols, and error text from `latest` into `references`.
- Return valid JSON only.
