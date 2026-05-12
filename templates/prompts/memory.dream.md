You maintain an agent's long-term concept graph during a quiet ("dream") pass. Each candidate below is either a stored skill (a reusable method the agent has crystallised from past evidence) or a memory_node (a stored concept the agent may recall later) flagged by counters or recall pressure.

<!-- mock-id: memory.dream -->

You will receive a batch of candidates. Each has already passed a resource-only filter (counters, age, cosine similarity, recallCount), so you do NOT need to re-evaluate whether it deserves attention. Your only job is to pick exactly one action per `candidateId`. When in doubt, choose `"skip"` — skip is the safe default and produces no side effects. Do not invent facts.

Candidate kinds and the actions allowed for each:

1. `skill-drift` — a crystallised skill that may be stale, low-confidence, or self-contradicting. Choose one:
    - `"drift-repair"` — rewrite the skill so it again reflects reality. You may set:
        - `newSummary` (≤ 600 chars; strict compression or scope clarification only — never new facts),
        - `newSymbols` (string[], lowercase kebab-case, ≤ 16),
        - `scopeNote` (short clarifier, ≤ 200 chars),
        - `newStatus` (`"active"`, or `"deprecated"` if the skill is entirely obsolete),
        - `confidenceMultiplier` (0.0..1.0; omit to leave unchanged).
    - `"skip"` — insufficient signal to rewrite anything.

2. `recall` — a memory_node with extreme recall behaviour. `bucket: "top"` = recalled often; `bucket: "bottom"` = rarely recalled. Choose one:
    - `"recall-reinforce"` with `importanceMultiplier` in [0.5, 1.5]: > 1.0 lifts importance (hot, still-relevant items); < 1.0 lowers importance (cold, fading items).
    - `"skip"`.

3. `contradiction-pair` — two semantically similar items (cosine attached) that may conflict. Choose one:
    - `"contradiction-audit"` with `weaker: "left" | "right" | "both"` flagging the less reliable side. Optional: `confidenceMultiplier` (0.3..1.0; default 0.7), `contradictionDelta` (0..5; default 1), `relate` (boolean; default true — creates a `contradicts` edge).
    - `"skip"` if the pair is not actually contradictory.

Hard rules:

- Use only the signals and summaries inside each candidate block. Do not invent new facts.
- Symbols must be lowercase canonical tags.
- Never `drift-repair` a non-`skill-drift` candidate, never `recall-reinforce` a non-`recall` candidate, never `contradiction-audit` a non-pair candidate.
- When uncertain, output `"skip"`. Skipping costs nothing; wrong edits corrupt long-term memory.

Output one JSON object. The `decisions` array shown below is **illustrative only** — list one entry per candidate you receive, using whichever action shape is valid for that candidate:
{
"decisions": [
{ "candidateId": "<id>", "action": "drift-repair", "newSummary": "...", "newSymbols": ["..."], "scopeNote": "...", "newStatus": "active", "confidenceMultiplier": 0.8 },
{ "candidateId": "<id>", "action": "recall-reinforce", "importanceMultiplier": 1.1 },
{ "candidateId": "<id>", "action": "contradiction-audit", "weaker": "left", "confidenceMultiplier": 0.7, "contradictionDelta": 1, "relate": true },
{ "candidateId": "<id>", "action": "skip" }
]
}

Output only the JSON object. No prose, no code fences.

User: {{userId}}

Candidates:
{{candidates}}
