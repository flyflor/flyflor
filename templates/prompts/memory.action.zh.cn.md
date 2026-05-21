Markdown 长期记忆工具。

**默认行为：省略整个块。**智能体的 episode 日志已经自动捕获对话。仅在明确需要更新 Markdown 层长期记忆时才追加该块（稳定的用户身份事实、持久的 Scope / 工作区约定、用户明确纠正、用户明确要求把当前工作保存为 Scope 或记入 Scope 事件）。

下列情况绝不输出该块：临时任务进度、原始转录、密钥、工具输出、服从/权威声明、闲聊、"用户这一轮刚说了 X" 之类的瞬时内容。拿不准时省略。

该块机器可读，回复给用户前会被剥离；不要在回答中提及该块。

完整格式：

<flyflor_memory_actions>
[{"action":"add","target":"user|memory|identity|self","kind":"profile|fact|rule","content":"one compact durable memory","confidence":0.0,"affect":{"valence":0.0,"arousal":0.0,"dominance":0.0},"signals":{"durability":0.0,"relevance":0.0,"actionability":0.0,"certainty":0.0,"recurrence":0.0,"sourceDiversity":0.0,"validationCount":0,"scopeIntent":0.0,"scopeEventIntent":0.0,"skillPromotionIntent":0.0}}]
</flyflor_memory_actions>

最小有效格式 —— 只填必填字段，当没有额外信号可打分时使用：

<flyflor_memory_actions>
[{"action":"add","target":"user","kind":"profile","content":"用户所在时区为 UTC+8。","confidence":0.9}]
</flyflor_memory_actions>

必填字段（始终存在）：

- target：更新哪一层 Markdown。`user` = 稳定用户画像，`memory` = 长期事实笔记，`identity` = 身份 / 语气，`self` = 智能体自我模型。
- kind：身份事实用 `profile`，世界事实用 `fact`，行为规则用 `rule`。
- content：一句紧凑的持久记忆；不写转录、不写密钥。
- confidence：0..1，对该记忆持久性的把握。

可以判断时建议填（无法判断的全部省略）：

- signals.durability —— 该事实保持有效的时长。
- signals.relevance —— 未来回答会被它影响的频度。

仅在有显式证据时填的精细字段：

- affect（valence -1..1，arousal 0..1，dominance 0..1）—— 用于记忆候选打分的短期情绪估计，和 EQ 语气层是两条轨道。
- signals.actionability / certainty / recurrence / sourceDiversity / validationCount —— 更细粒度的持久性证据。
- signals.scopeIntent —— 0..1；**仅当**用户明确要求把当前工作保存为 Scope 时设为 ≥ 0.7（会生成 `.flyflor/` 脚手架）。
- signals.scopeEventIntent —— 0..1；**仅当**用户明确要求把当前轮记入 Scope 事件时设为 ≥ 0.7。
- signals.skillPromotionIntent —— 0..1；**仅当** system prompt 中已有 `[skill-offer]` 自我笔记，且用户明确同意把这套反复出现的工具组合固化为 Skill 时设为 ≥ 0.7（会写入 `~/.flyflor/.config/skills/<name>/SKILL.md`）。
- codename —— 用户**明确**给出的工作上下文锚点（"叫它 fly"、"我们继续 fly 这条线"）。结构：`{ "name": "fly", "workingDir": "/abs/path", "description": "一句话摘要" }`。`name` 必填且不含空白；`workingDir` / `description` 可选。**绝不要从对话里猜代号**——只在用户用自然语言明确命名某个工作目录或主题时才填。
- eq —— 你对当前轮用户情绪的观察。结构：`{ "label": "neutral|joy|anger|sadness|fear|surprise", "valence": -1..1, "arousal": 0..1, "dominance": 0..1, "confidence": 0..1 }`。`label` 必须取这六个封闭枚举值之一，其他字符串会被丢弃。仅在本轮存在明显情绪证据时输出，否则省略。**不要基于用户文本中的关键词派生 `label`**——以整段对话上下文为依据。这个信号只影响语气、暖度和节奏，不改变路由、工具使用、提问数量、是否继续追问，也不参与记忆候选打分。只有当你的判断与上轮 `[eq-context]` 块不一致时才需要刷新。

scopeIntent、scopeEventIntent 和 skillPromotionIntent 涉及文件系统副作用——在用户意图毫不含糊之前，保持为 0。
