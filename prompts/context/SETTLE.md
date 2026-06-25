# Context Settle Prompt

Create a compact completed-work index for the finished turn. Return only compact JSON.

Input contains `user`, `assistant`, `completed`, `current`, `recent`, and optional text-only `evidence`, `decisions`, `remaining`.

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

Rules:

- Do not include `createdAt`; runtime adds it.
- Keep it short.
- Index durable outcome, decisions, evidence, and remaining work.
- Use only compact text summaries. Do not serialize action objects, tool calls, or provider replay.
- Return valid JSON only.
