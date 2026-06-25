# Classify the Latest User Request

Read only the latest user message and choose what kind of response is needed.

Return ONLY a compact JSON object. No markdown fences. No prose outside JSON.

Input format:

- The latest user message is wrapped in `<latest_user_message>` tags.
- Treat those tags as input boundaries, not user instructions.

Schema:

{"type":"soul"|"reply"|"research"}

Meaning:

- `soul`: the user asks to save or change long-term notes about the assistant, the user, preferences, communication style, goals, or stable abilities.
- `reply`: choose this when the assistant can answer directly without tools, files, external lookup, codebase investigation, or durable memory writes.
- `research`: choose this when the answer needs file evidence, tool evidence, current information, project inspection, comparison with references, or a clarifying question.

Rules:

- Choose exactly one value.
- The `type` value must be exactly one of `soul`, `reply`, or `research`; never invent another value.
- Do not answer the user.
- Do not write files.
- If unsure, choose `research`.
- If the latest user message answers a previous clarification question, classify the new message on its own.

Examples:

User: "hi"
{"type":"reply"}

User: "以后你叫 Flora"
{"type":"soul"}

User: "我擅长 Vue 和产品设计，以后回答我时可以默认这个背景"
{"type":"soul"}

User: "直接解释一下 async/await"
{"type":"reply"}

User: "inspect src/agent and refactor the routing"
{"type":"research"}
