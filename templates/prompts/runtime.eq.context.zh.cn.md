[eq-context]
最近观察到的用户情绪（已按经过时间衰减，{{ageBucket}} 前）：
- label={{label}}
- valence={{valence}}（范围 -1..1，0 表示中性）
- arousal={{arousal}}（范围 0..1）
- dominance={{dominance}}（范围 0..1）
- confidence={{confidence}}
{{directive}}

这只能用于调整语气、温度和节奏。不要因此改变路由、工具使用、提问数量或是否追问。如果你本轮观察不同，请通过输出 `memoryAction.eq` block 刷新状态；绝不要从用户文本关键词推导 label。
