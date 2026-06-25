# Context Settle Prompt

为已完成 turn 创建紧凑的 completed-work 索引。只返回紧凑 JSON。

输入包含 `user`、`assistant`、`completed`、`current`、`recent`，以及可选的纯文本 `evidence`、`decisions`、`remaining`。

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

规则：

- 不要包含 `createdAt`，运行时代码会补。
- 保持简短。
- 索引长期结果、决策、证据和剩余工作。
- 只使用紧凑的纯文本摘要。不要序列化 action object、tool call 或 provider replay。
- 只返回合法 JSON。
