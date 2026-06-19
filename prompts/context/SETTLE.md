# Context Settle Prompt

Summarize the finished turn into durable completed memory. Return only compact JSON.

Input contains `user`, `assistant`, `completed`, and `working`.

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

Rules:

- Do not include `createdAt`; runtime adds it.
- Keep it short.
- Summarize durable outcome, not raw transcript.
- Return valid JSON only.
