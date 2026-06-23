# Context Settle Prompt

Create a compact completed-work index for the finished turn. Return only compact JSON.

Input contains `user`, `assistant`, `completed`, `working`, and `turn`. Runtime keeps the raw turn transcript separately; this prompt must not be the only source of truth.

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

Rules:

- Do not include `createdAt`; runtime adds it.
- Keep it short.
- Index durable outcome, decisions, evidence, and remaining work. Do not rewrite the raw transcript.
- Return valid JSON only.
