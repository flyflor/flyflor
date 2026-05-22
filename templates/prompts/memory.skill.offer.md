[skill-offer]
name: {{name}}
tools: {{tools}}
support: {{support}} episodes
confidence: {{confidence}}
remaining_turns: {{remainingTurns}}

This is a repeated MCP tool combination that may be worth turning into a reusable Skill. Only set `signals.skillPromotionIntent >= 0.7` after clear user agreement to save or keep this workflow as a skill. Otherwise keep that signal at 0. Do not propose it repeatedly.
Treat this as a nudge, not permission. Repetition and confidence scores alone never authorize Skill creation.
