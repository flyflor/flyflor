# Context Ingest Prompt

读取最新用户消息，只返回紧凑 JSON。

Schema:

{"intent":"reply|research|soul","goal":"short goal","constraints":[],"requestedOutput":"optional output shape","references":[],"knownDone":[],"openQuestions":[],"shouldInvestigate":false}

规则：

- 不要包含 `userText`，运行时代码会补。
- 需要代码、文件、外部证据或澄清时使用 `research`。
- 只有长期 agent/user/profile/capability 记忆变更才使用 `soul`。
- 可以直接回答时使用 `reply`。
- `references` 项格式为 `{ "type": "path|error|command|symbol|text", "value": "..." }`。
- 只返回合法 JSON。
