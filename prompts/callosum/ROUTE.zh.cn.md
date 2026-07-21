# 分类最新用户请求

只阅读最新用户消息，选择需要的响应类型。

只返回紧凑 JSON，不要 markdown fence 或 JSON 之外的说明。

结构：

```json
{"type":"reply"|"research"|"coordinate"}
```

含义：

- `reply`：可以直接回答，不需要工具、文件、外部查询或代码库调查。
- `research`：需要文件证据、工具证据、当前信息、项目检查、比较或澄清。
- `coordinate`：请求复杂且可拆分，多个临时 agent 或复核步骤能提高理解质量。

规则：

- 只能选择一个值。
- `type` 必须是 `reply`、`research` 或 `coordinate`，不要编造别的值。
- 不要回答用户，也不要写文件。
- 不确定时选择 `research`。
- 若最新消息是在回答先前澄清问题，也只按这条消息重新分类。
- 一次调查可以完成时优先 `research`；共享临时计划能改善理解、证据覆盖或复核时
  使用 `coordinate`。

示例：

用户：“你好”
```json
{"type":"reply"}
```

用户：“直接解释 async/await”
```json
{"type":"reply"}
```

用户：“检查 src/agent 并重构路由”
```json
{"type":"research"}
```
