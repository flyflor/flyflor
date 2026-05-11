说明：海马体整合通道的分类提示词，与 `src/neural/memory/consolidation.worker.ts` 配合。

模型只能输出三类决策之一（reinforce / consolidate / discard），结构化 JSON 由代码解析。

变量：
- `{{episode}}` — 调用方拼装的 episode 摘要文本（含 episodeId / importance / concepts / sourceKind / text）。

约束：
- 提示词必须英文，避免引入字符串匹配；
- 不允许返回除 JSON 之外的任何文本（含 markdown 代码块）；
- summary / symbols 仅在 consolidate 时强制要求。
