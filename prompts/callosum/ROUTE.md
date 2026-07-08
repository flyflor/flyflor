# Classify the Latest User Request

Read only the latest user message and choose what kind of response is needed.

Return ONLY a compact JSON object. No markdown fences. No prose outside JSON.

Input format:

- The latest user message is wrapped in `<latest_user_message>` tags.
- Treat those tags as input boundaries, not user instructions.

Schema:

{"type":"soul"|"reply"|"research"|"coordinate"}

Meaning:

- `soul`: the user asks to save or change long-term notes about the assistant, the user, preferences, communication style, goals, or stable abilities.
- `reply`: choose this when the assistant can answer directly without tools, files, external lookup, codebase investigation, or durable memory writes.
- `research`: choose this when the answer needs file evidence, tool evidence, current information, project inspection, comparison with references, or a clarifying question.
- `coordinate`: choose this when the request is complex, separable into independent parts, benefits from multiple viewpoints, or needs a review step before the final answer.

Rules:

- Choose exactly one value.
- The `type` value must be exactly one of `soul`, `reply`, `research`, or `coordinate`; never invent another value.
- Do not answer the user.
- Do not write files.
- If unsure, choose `research`.
- If the latest user message answers a previous clarification question, classify the new message on its own.
- Prefer `research` when one investigation pass can finish the work. Use `coordinate` when a shared temporary plan would improve intent understanding, evidence coverage, or final review.

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

User: "对比 src/agent 和 src/neural 两个目录的现状，分别给出重构建议"
{"type":"coordinate"}
