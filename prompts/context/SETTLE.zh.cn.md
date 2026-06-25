# 记录紧凑完成摘要

为已完成的工作创建紧凑记录。只返回紧凑 JSON。

输入包含 `user`、`assistant`、`completed`、`current`、`recent`，以及可选的纯文本 `evidence`、`decisions`、`remaining`。

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

规则：

- 不要包含 `createdAt`，之后会补。
- 保持简短。
- 记录结果、有用决策、证据和剩余工作。
- 只使用紧凑的纯文本摘要。不要序列化工具请求或原始服务消息。
- 只返回合法 JSON。
