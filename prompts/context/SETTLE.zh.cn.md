# Context Settle Prompt

为已完成 turn 创建紧凑的 completed-work 索引。只返回紧凑 JSON。

输入包含 `user`、`assistant`、`completed`、`working` 和 `turn`。运行时代码会单独保留原始 turn transcript；这个提示词不能成为唯一事实来源。

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

规则：

- 不要包含 `createdAt`，运行时代码会补。
- 保持简短。
- 索引长期结果、决策、证据和剩余工作。不要重写原始 transcript。
- 只返回合法 JSON。
