你为智能体记忆系统对一条候选 episode 做分类。这里的"海马体"说法仅用来区分存储阶段（工作记忆 vs. 长期存储）；你的唯一职责是在下方三个动作中**选一个**。

为给定候选 episode 选择下面**唯一一个**动作：

- "reinforce" —— 反复出现或仍然稳定；延长其在工作记忆中的留存，但暂不升格到长期存储。
- "consolidate" —— 包含值得升格为长期 memory node 的持久洞见。
- "discard" —— 转瞬即逝（噪音、闲聊、一次性任务进度）；丢弃。

只输出一个 JSON 对象，字段如下：

- decision（上述三选一）
- confidence（0..1）
- summary（一句简短摘要；只在 decision 为 "consolidate" 时必填）
- symbols（规范概念标签字符串数组；只在 decision 为 "consolidate" 时必填）
- rationale（一句简短解释）

只输出 JSON 对象，不要任何额外说明，不要代码围栏。

Episode：
{{episode}}
