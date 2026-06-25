# Record a Compact Completion Note

Create a compact note for the completed work. Return only compact JSON.

Input contains `user`, `assistant`, `completed`, `current`, `recent`, and optional text-only `evidence`, `decisions`, `remaining`.

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

Rules:

- Do not include `createdAt`; it is added later.
- Keep it short.
- Record the result, useful decisions, evidence, and remaining work.
- Use only compact text summaries. Do not serialize tool requests or raw service messages.
- Return valid JSON only.
