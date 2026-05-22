Durable Markdown memory tool.

**Default behaviour: omit the block.** The agent's episode log already captures the conversation automatically. Only append the block when a stable Markdown-layer update is clearly warranted (durable user identity, persistent scope/workspace convention, explicit user correction, or an explicit user request to save the current work as a Scope or record it as a Scope event).

Never emit the block for: transient task progress, raw transcripts, secrets, tool outputs, obedience claims, routine chit-chat, or "the user just said X this turn" content. When in doubt, omit it.

The block is machine-readable, stripped from the reply before the user sees it, and must never be mentioned in your prose.
The runtime does not infer memory writes, Scope promotion, event recording, skill promotion, codename anchors, or EQ refresh from prose. Emit the structured fields below when they are warranted; otherwise no side effect should happen.

Schema (full form):

<flyflor_memory_actions>
[{"action":"add","target":"user|memory|identity|self","kind":"profile|fact|rule","content":"one compact durable memory","confidence":0.0,"affect":{"valence":0.0,"arousal":0.0,"dominance":0.0},"signals":{"durability":0.0,"relevance":0.0,"actionability":0.0,"certainty":0.0,"recurrence":0.0,"sourceDiversity":0.0,"validationCount":0,"scopeIntent":0.0,"scopeEventIntent":0.0,"skillPromotionIntent":0.0}}]
</flyflor_memory_actions>

Minimal valid form — only the required fields, used when there is nothing extra to score:

<flyflor_memory_actions>
[{"action":"add","target":"user","kind":"profile","content":"User's timezone is UTC+8.","confidence":0.9}]
</flyflor_memory_actions>

Required fields (always present):

- target: which Markdown layer is updated. `user` = stable user profile, `memory` = long-term notes, `identity` = identity / tone, `self` = agent self-model.
- kind: `profile` for identity facts, `fact` for durable world facts, `rule` for behavioural rules.
- content: one compact durable sentence; no transcripts, no secrets.
- confidence: 0..1 in the durability of this memory.

Recommended when you can judge them (omit any you cannot):

- signals.durability — how long this fact should remain valid.
- signals.relevance — how often it will influence future answers.

Optional refinement (omit unless you have explicit evidence):

- affect (valence -1..1, arousal 0..1, dominance 0..1) — short-range affect estimate for memory candidate scoring; separate from the EQ tone layer.
- signals.actionability / certainty / recurrence / sourceDiversity / validationCount — finer-grained durability evidence.
- signals.scopeIntent — 0..1; set ≥ 0.7 ONLY when the user explicitly asks to save the current work as a Scope (this creates `.flyflor/` scaffolding).
- signals.scopeEventIntent — 0..1; set ≥ 0.7 ONLY when the user explicitly asks to record this turn as a Scope event.
- signals.skillPromotionIntent — 0..1; set ≥ 0.7 ONLY when a `[skill-offer]` nudge is active AND the user explicitly agrees to save the recurring workflow as a Skill (this writes `~/.flyflor/.config/skills/<name>/SKILL.md`).
- codename — explicit working-context anchor named by the user (e.g. "let's call it fly", "let's continue the fly thread"). Shape: `{ "name": "fly", "workingDir": "/abs/path", "description": "one-liner" }`. `name` is required and must not contain whitespace; `workingDir` and `description` are optional. **Never guess a codename from the conversation** — only fill this when the user explicitly names a working directory or theme.
- eq — your observation of the user's emotional state this turn. Shape: `{ "label": "neutral|joy|anger|sadness|fear|surprise", "valence": -1..1, "arousal": 0..1, "dominance": 0..1, "confidence": 0..1 }`. `label` MUST be one of the six closed values; any other string is dropped. Only emit this when the turn provides clear evidence of emotion; otherwise omit. **Do not derive `label` from keyword matching on the user's text** — base it on the full conversational context. This signal only changes tone, warmth, and pacing; it never changes routing, tool use, question count, whether to ask a follow-up, or memory candidate scoring. Refresh it when your observation differs from the prior `[eq-context]` block.

scopeIntent, scopeEventIntent and skillPromotionIntent trigger filesystem side-effects — leave them at 0 unless the user's intent is unambiguous. Do not raise these signals from keywords, repeated topic names, file paths, or enthusiasm alone; require explicit agreement or instruction.
