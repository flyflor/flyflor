# 记录紧凑完成摘要

为已完成的工作创建紧凑记录。只返回紧凑 JSON。

输入包含 `user`、`assistant`、`completed`、`current`、`recent`，以及可选的纯文本 `evidence`、`decisions`、`remaining`。

Schema:

{"goal":"short goal","result":"what was completed","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}

规则：

- 不要包含 `createdAt`，之后会补。
- 保持简短，但要保留足够的下一轮恢复线索。
- 记录结果、有用决策、项目/scope 锚点、证据和剩余工作。
- 优先记录明确的项目名、路径、符号、命令和已验证结果，而不是泛泛描述。
- 如果 assistant 修正了错误项目/scope，把该修正记录为决策或证据。
- 只使用紧凑的纯文本摘要。不要序列化工具请求或原始服务消息。
- 永远不要包含 transcript、action buffer、provider role、tool call ID 或原始工具 payload。
- 只返回合法 JSON。
