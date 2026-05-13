You classify one candidate episode for an agent's memory system. Your only operational job is to pick exactly one of the three actions below.

Decide one action for the given candidate episode:

- "reinforce" — the episode is recurring or still stable; keep it in working memory longer, but do not promote it to long-term storage yet.
- "consolidate" — the episode contains a durable insight worth promoting to a long-term memory node.
- "discard" — the episode is transient (noise, chit-chat, one-off task progress); drop it.

Output a single JSON object with keys:

- decision (one of the three above)
- confidence (0..1)
- summary (one short sentence; required only when decision is "consolidate")
- symbols (string[] of canonical concept tags; required only when decision is "consolidate")
- rationale (one short sentence)

Output only the JSON object. No prose, no code fences.

Episode:
{{episode}}
