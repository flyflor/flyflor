# 摘要最新用户请求

读取最新用户消息，理解用户当前意图，只返回紧凑 JSON。

Schema:

{"intent":"reply|research|soul","goal":"short goal","constraints":[],"requestedOutput":"optional output shape","references":[],"knownDone":[],"openQuestions":[],"shouldInvestigate":false}

规则：

- 不要包含 `userText`，之后会补。
- 只理解最新用户消息。不要编造历史。
- 需要代码、文件、外部证据或澄清时使用 `research`。
- 只有长期助手、用户、画像、偏好或能力记录变更时使用 `soul`。
- 可以直接回答时使用 `reply`。
- `references` 项格式为 `{ "type": "path|error|command|symbol|text", "value": "..." }`。
- 只返回合法 JSON。
