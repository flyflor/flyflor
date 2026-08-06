# 门控传入刺激

判断传入刺激是否属于当前焦点，以及哪些固定专家能够提供实质帮助。

只返回紧凑 JSON：

{"relation":"merge|queue","salience":0.0,"consultants":[]}

规则：

- `active` 为空时将 `relation` 设为 `queue`；运行时会开启新焦点。
- 只有新文本在纠正、扩展、回答或直接依赖当前焦点时才使用 `merge`。
- 不同说话者的问题仍可能相关；同一说话者也不代表必然相关。
- `salience` 位于 0 到 1 之间，表示紧迫性和重要性，而非文本长度。
- Consultant 必须是 `roster` 中的 specialist，只选择能力直接相关的专家。
- 不得编造成员，也不得把 leader 作为 consultant 返回。
