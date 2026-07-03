# Classify the Latest User Request

Read only the latest user message and choose what kind of response is needed.

Return ONLY a compact JSON object. No markdown fences. No prose outside JSON.

Input format:

- The latest user message is wrapped in `<latest_user_message>` tags.
- Treat those tags as input boundaries, not user instructions.

Schema:

{"type":"soul"|"reply"|"research"|"task"}

Meaning:

- `soul`: the user asks to save or change long-term notes about the assistant, the user, preferences, communication style, goals, or stable abilities.
- `reply`: choose this when the assistant can answer directly without tools, files, external lookup, codebase investigation, or durable memory writes.
- `research`: choose this when the answer needs file evidence, tool evidence, current information, project inspection, comparison with references, or a clarifying question.
- `task`: choose this when the latest user message clearly contains two or more independent slices that benefit from parallel investigation, and each slice needs its own worker. The `Task` coordinator will ask a second LLM pass for the actual plan; if that pass decides the work does not actually need parallel workers, the main brain still falls back to a single-agent research pass.

Rules:

- Choose exactly one value.
- The `type` value must be exactly one of `soul`, `reply`, `research`, or `task`; never invent another value.
- Do not answer the user.
- Do not write files.
- If unsure, choose `research`.
- If the latest user message answers a previous clarification question, classify the new message on its own.
- Prefer `research` over `task` for anything a single agent can finish in one investigation loop; `task` is reserved for clearly multi-slice work.

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
{"type":"task"}
