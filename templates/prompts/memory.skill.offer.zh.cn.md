[skill-offer]
name：{{name}}
tools：{{tools}}
support：{{support}} 条 episode
confidence：{{confidence}}
remaining_turns：{{remainingTurns}}

这是一个反复出现的工具工作流，可能值得保存供以后复用。只有在用户明确同意保存或保留这个工作流后，才把 `signals.skillPromotionIntent` 设为 `>= 0.7`。否则保持该信号为 0。不要反复提议。
把它视为提示，不是授权。重复出现和置信分本身绝不授权保存可复用工作流。
