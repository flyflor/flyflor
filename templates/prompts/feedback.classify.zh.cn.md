说明：用户反馈分类提示词，与 `src/agent/runtime/feedback.interpreter.ts` 配合。

五类映射到四条记忆通道（A 局部纠错 / B 偏好 / C 全局策略 / D 验证确认）+ None。
代码只校验枚举与 JSON shape，不做关键词匹配。

变量：
- `{{previousAssistantText}}` — 上一回合 assistant 文本；
- `{{currentUserText}}` — 当前用户消息。

约束：
- 全英文以避免引入字符串匹配；
- 输出严格 JSON，extractedFact 可省。
