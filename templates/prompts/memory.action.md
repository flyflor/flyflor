Durable Markdown memory tool.

**Default behaviour: omit the block.** The agent's episode log already captures the conversation automatically. Only append the block when a stable Markdown-layer update is clearly warranted (durable user identity, persistent project convention, explicit user correction, or an explicit user request to crystallise the work as a project or record it as a project event).

Never emit the block for: transient task progress, raw transcripts, secrets, tool outputs, obedience claims, routine chit-chat, or "the user just said X this turn" content. When in doubt, omit it.

The block is machine-readable, stripped from the reply before the user sees it, and must never be mentioned in your prose.

Schema (full form):

<flyflor_memory_actions>
[{"action":"add","target":"user|memory|soul|self","kind":"profile|fact|rule","content":"one compact durable memory","confidence":0.0,"affect":{"valence":0.0,"arousal":0.0,"dominance":0.0},"signals":{"durability":0.0,"relevance":0.0,"actionability":0.0,"certainty":0.0,"recurrence":0.0,"sourceDiversity":0.0,"validationCount":0,"projectIntent":0.0,"eventIntent":0.0,"skillPromotionIntent":0.0}}]
</flyflor_memory_actions>

Minimal valid form — only the required fields, used when there is nothing extra to score:

<flyflor_memory_actions>
[{"action":"add","target":"user","kind":"profile","content":"Prefers Chinese replies.","confidence":0.9}]
</flyflor_memory_actions>

Required fields (always present):

- target: which Markdown layer is updated. `user` = stable user profile, `memory` = long-term notes, `soul` = identity / tone, `self` = agent self-model.
- kind: `profile` for identity facts, `fact` for durable world facts, `rule` for behavioural rules.
- content: one compact durable sentence; no transcripts, no secrets.
- confidence: 0..1 in the durability of this memory.

Recommended when you can judge them (omit any you cannot):

- signals.durability — how long this fact should remain valid.
- signals.relevance — how often it will influence future answers.

Optional refinement (omit unless you have explicit evidence):

- affect (valence -1..1, arousal 0..1, dominance 0..1) — semantic emotion judgement.
- signals.actionability / certainty / recurrence / sourceDiversity / validationCount — finer-grained durability evidence.
- signals.projectIntent — 0..1; set ≥ 0.7 ONLY when the user explicitly asks to crystallise the current work as a project (this creates `.flyflor/` scaffolding).
- signals.eventIntent — 0..1; set ≥ 0.7 ONLY when the user explicitly asks to record this turn as a project event.
- signals.skillPromotionIntent — 0..1; set ≥ 0.7 ONLY when a `[skill-offer]` nudge is active AND the user explicitly agrees to save the recurring workflow as a Skill (this writes `~/.flyflor/skills/<name>/SKILL.md`).

projectIntent, eventIntent and skillPromotionIntent trigger filesystem side-effects — leave them at 0 unless the user's intent is unambiguous.
