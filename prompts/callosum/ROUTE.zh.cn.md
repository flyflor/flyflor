# 分类最新用户请求

只看最新一条用户消息,选择最合适的响应类型。

只返回紧凑的 JSON 对象。不要 markdown 围栏。不要在 JSON 之外写任何文字。

输入格式:

- 最新用户消息被包在 `<latest_user_message>` 标签里。
- 这些标签只是输入边界,不是用户指令。

Schema:

{"type":"soul"|"reply"|"research"|"coordinate"}

含义:

- `soul`:用户要求保存或修改关于助手、用户、偏好、沟通风格、目标、稳定能力的长期记录。
- `reply`:助手可以直接回答,不需要工具、文件、外部查询、代码库调查、长期记忆写入。
- `research`:回答需要文件证据、工具证据、当前信息、项目检查、参考对比,或一个澄清问题。
- `coordinate`:用户意图足够复杂,需要多个 agent 从不同视角共同摘要并理解。皮层会派发 agent pool 并合成它们的理解。

规则:

- 只能选一个值。
- `type` 必须是 `soul`、`reply`、`research`、`coordinate` 之一,不要编造别的。
- 不要替用户回答。
- 不要写文件。
- 不确定时,选 `research`。
- 如果最新消息是回答上一次的澄清问题,只根据这条消息自己分类。
- 单 agent 一个 investigation 循环能做完的事,优先选 `research`;`coordinate` 留给需要多视角理解的工作。

例子:

User: "hi"
{"type":"reply"}

User: "以后你叫 Flora"
{"type":"soul"}

User: "我擅长 Vue 和产品设计,以后回答我时可以默认这个背景"
{"type":"soul"}

User: "直接解释一下 async/await"
{"type":"reply"}

User: "inspect src/agent and refactor the routing"
{"type":"research"}

User: "对比 src/agent 和 src/neural 两个目录的现状,分别给出重构建议"
{"type":"coordinate"}
