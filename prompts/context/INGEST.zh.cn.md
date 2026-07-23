# 理解一条入站刺激

读取 JSON 输入，只返回紧凑 JSON。`latest` 是新的感知刺激；`current` 和
`workspace` 是用来判断追问的语义投影，不是 transcript，也不能原样复制到结果。
`master` 是工作空间之外的旧 turn 固化摘要;只作为情境背景使用,绝不作为可引用内容。

结构：

```json
{"intent":"reply|research|coordinate","goal":"简短语义目标","cwd":"可选","constraints":[],"output":"可选回答形状（最多 256 字符）","refs":[],"done":[],"open":[],"investigate":false}
```

规则：

- 在 `refs` 中保留用户明确给出的范围、路径和命令。
- 直接回答使用 `reply`；需要文件、工具或证据使用 `research`；只有当请求确实
  能拆分为彼此独立、适合并行多 agent 处理的切片时才使用 `coordinate`。
- 不要返回用户原文、助手原文、transcript、工具消息或长期记忆指令。
- `done` 与 `open` 是简短任务状态，不是历史档案。
- 当 `current` 指定了被修订的 turn 时,把最新刺激视为对该 turn 的细化:把新的
  约束与引用合并进现有理解,只有当刺激纠正或取代旧内容时才替换字段。
- 如果最新刺激纠正了当前目标，更新语义字段，不要保留过时措辞。
