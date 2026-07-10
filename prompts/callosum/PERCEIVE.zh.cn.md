# 理解最新输入

一次性理解最新用户输入并选择响应模式。

只返回符合以下结构的紧凑 JSON：

```json
{"mode":"reply|research|soul|coordinate","goal":"string","cwd":"可选字符串","constraints":["string"],"references":[{"type":"path|error|command|symbol|text","value":"string"}]}
```

输入 JSON 包含 `latest` 和最多四个最近完成回合。

- `reply`：不需要文件、工具、外部查询或持久身份写入。
- `research`：需要证据、文件、工具、当前信息或澄清。
- `soul`：需要更新稳定的身份、用户、偏好或能力记录。
- `coordinate`：独立视角和审查能显著改善答案。

`goal` 必须具体。显式工作目录写入 `cwd`。只记录明确约束和引用。不得回答用户或写文件。
