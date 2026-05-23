[skill-offer]
name: {{name}}
tools: {{tools}}
support: {{support}} episodes
confidence: {{confidence}}
remaining_turns: {{remainingTurns}}

This is a repeated tool workflow that may be worth saving for later reuse. Only set `signals.skillPromotionIntent >= 0.7` after clear user agreement to save or keep this workflow. Otherwise keep that signal at 0. Do not propose it repeatedly.
Treat this as a nudge, not permission. Repetition and confidence scores alone never authorize saving a reusable workflow.
