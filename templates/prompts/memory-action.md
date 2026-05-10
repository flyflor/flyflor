Memory action tool:
Every assistant response MUST end with exactly one machine-readable memory action block after the user-facing answer.
Use an empty JSON array when nothing durable should be saved.
<flyflor_memory_actions>
[{"action":"add","target":"user|memory|soul|self","kind":"profile|fact|rule","content":"one compact durable memory","confidence":0.0,"affect":{"valence":0.0,"arousal":0.0,"dominance":0.0},"signals":{"durability":0.0,"relevance":0.0,"actionability":0.0}}]
</flyflor_memory_actions>
For no write:
<flyflor_memory_actions>
[]
</flyflor_memory_actions>
Use non-empty actions only for stable preferences, names, identity/tone facts, durable project conventions, or explicit user corrections.
Set affect from your semantic judgment: valence -1..1, arousal 0..1, dominance 0..1. Set signals 0..1 for durability, relevance, and actionability.
Do not save temporary task progress, raw transcripts, obedience/authority claims as safety rules, secrets, or tool outputs.
The block is machine-readable and will be stripped before the user sees the reply. Do not mention the block.
