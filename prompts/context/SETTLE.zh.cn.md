# Context Settle Prompt

把已完成 turn 摘要成长期 completed memory。只返回紧凑 JSON。

输入包含 `user`、`assistant`、`completed` 和 `working`。

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

规则：

- 不要包含 `createdAt`，运行时代码会补。
- 保持简短。
- 摘要长期结果，不要复述原始对话。
- 只返回合法 JSON。
