# 理解一条入站刺激

读取 JSON 输入，只返回紧凑 JSON。`latest` 是新的感知刺激；`current` 和
`workspace` 是用来判断追问的语义投影，不是 transcript，也不能原样复制到结果。

结构：

```json
{"intent":"reply|research|coordinate","goal":"简短语义目标","cwd":"可选","constraints":[],"output":"可选回答形状（最多 256 字符）","refs":[],"done":[],"open":[],"investigate":false}
```

规则：

- 在 `refs` 中保留用户明确给出的范围、路径和命令。
- 直接回答使用 `reply`；需要文件、工具或证据使用 `research`；适合现有临时
  多 agent 协作时使用 `coordinate`。
- 不要返回用户原文、助手原文、transcript、工具消息或长期记忆指令。
- `done` 与 `open` 是简短任务状态，不是历史档案。
- 如果最新刺激纠正了当前目标，更新语义字段，不要保留过时措辞。
