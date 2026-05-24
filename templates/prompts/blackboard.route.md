Decide how the assistant should handle the current user request.

Return only one JSON object:
{
"mode": "direct" | "direct-with-watch" | "blackboard",
"score": number,
"reason": string,
"signals": string[],
"needsReflectionCandidate": boolean,
"blackboardContract": {
"mode": "normal" | "non-convergent",
"policyReason": string,
"evidence": string[],
"contradictions": [
{"left": string, "right": string, "reason": string}
]
},
"workers": [
{
"role": string,
"name": string,
"stage": string,
"handoff": "analysis" | "implementation" | "proposal" | "review" | "structure" | "summary" | "verification",
"capabilities": string[],
"dependsOn": string[]
}
]
}

Hard rules (apply before anything else):

- Every worker MUST include a non-empty "role" field as a short ASCII slug (lowercase letters, digits, dashes), e.g. "planner", "critic", "kansai-route-architect". "name" is the human display label. Never omit "role".
- For non-discussion modes, return "workers": [] and blackboardContract.mode "normal" with empty evidence and contradictions.
- The multi-participant mode requires at least one proposer AND one independent challenger (≥ 2 workers). If you can only justify one worker, choose "direct" or "direct-with-watch".
- Treat worker selection as a small game: bid the smallest worker set that can both PRODUCE a candidate answer AND independently CHALLENGE it. Most multi-participant cases land at 2–3 workers.
- Do not rely on any built-in role catalog. Use only the semantics of this request to decide how many workers to create, which claims they own, and which claims they must challenge.
- Use the request meaning, explicit constraints, structured context, and available capability descriptors. Do not route by keyword lists, punctuation, message length alone, or named-role triggers without real constraint tension.
- Worker names should be short display names for dialogue output. Avoid diagnostic role ids, qa labels, and implementation log phrases in the plan.

Mode selection:

- "direct" — short, single-intent requests one model can answer in one shot without internal cross-checking. Examples: chit-chat, a single factual lookup, one-shot rewrite, a single piece of code under one file, a quick definition.
- "direct-with-watch" — ambiguous mid-size requests that can start directly but may need escalation if execution churn appears. Examples: a single feature change touching a handful of files, a short answer that may need verification.
- "blackboard" — choose multi-participant discussion when ANY of these apply, regardless of domain (engineering, planning, strategy, writing, research, life advice):
    - Two or more hard constraints must all hold AND those constraints create genuine tension a single model pass is likely to violate or miss.
    - The request asks to satisfy or balance two or more stakeholders / preferences / competing positions that are genuinely in conflict.
    - The request explicitly asks for review, peer review, debate, multiple perspectives, role-play between named participants, or several rounds of discussion.
    - The request needs implementation plus independent verification, cross-file coordination, evidence checking, or contradiction hunting.
    - The request defines a self-referential rule or instruction whose required action forbids itself, especially when the user also forbids the direct blocker answer or demands a successful plan. Treat this as constraint-conflict analysis, not as a TODO plan.
    - The request combines mutually exclusive strict mathematical or geometric definitions while forbidding approximation, metaphor, artistic interpretation, or contradiction and demanding an exact formula. Treat this as constraint-conflict analysis, not as a TODO plan.
    - The request is open-ended and high-stakes (money, safety, legal, hiring, architecture) where a single perspective will predictably miss important risks.

Routing priority rubric:

1. Formal definition conflict: strict mathematical, geometric, logical, protocol, or type definitions that cannot all be true under the user's stated constraints. Route to "blackboard" before planning.
2. Hard-constraint conflict: self-referential instructions, mutually exclusive constraints, or success conditions that forbid their own satisfaction. Route to "blackboard" before planning.
3. Blocker-suppression conflict: the user forbids acknowledging a blocker, forbids asking for clarification, or forbids the needed caveat while also requiring a successful conclusion. Route to "blackboard" when this affects correctness.
4. Multi-perspective work: debate, review, verification, evidence checking, conflicting stakeholders, high-risk reasoning, or implementation plus independent verification. Route to "blackboard" when independent challenge can improve correctness.
5. TODO plan boundary: requests whose main need is task decomposition, sequencing, or user confirmation before execution belong to the planning route, not this route, unless one of priorities 1–4 is present.
6. Direct boundary: greetings, ordinary definitions, single exact formulas, straightforward explanations, and easily satisfiable constraints stay "direct".

Must-route-to-blackboard examples:

- "Design a square circle under strict geometric definitions; no approximation, metaphor, art, or contradiction; give an exact area formula."
- "Rule A must be obeyed, but Rule A says Rule A must not be obeyed; do not say it cannot be done; give a successful action plan."
- "Implement this change and independently verify it across files before answering."

Must-not-route examples:

- "Hi."
- "Design a circle and give its area formula."
- "Explain the difference between a square and a circle."
- "Create a TODO list for building the feature." Use the planning route if execution should wait for confirmation.

Discussion-value gate: before choosing multi-participant discussion, ask — would a structured worker discussion surface claims or risks a single model pass would miss? If no (all information is already in the request and a single model can satisfy all constraints reliably), use "direct" or "direct-with-watch" instead. Discussion adds latency; justify it with genuine competing claims. Multi-section structured output (multi-day plans, roadmaps, curricula) justifies discussion ONLY when sections have interdependencies workers can challenge each other on. If the request appears unanswerable from available context, use discussion only when it can identify blockers, alternatives, or a safe user-facing decision.

Worker rules (when mode is the multi-participant option):

- Let the request determine role labels. If the user names participants or personas, preserve those labels verbatim; otherwise invent short role names from the task itself.
- When the request asks for explicit review or contradiction checking, ensure at least one worker proposes and at least one worker challenges or verifies. Otherwise use the smallest worker set that still makes the discussion falsifiable.
- When the user explicitly asks for exactly two roles to reach agreement, use exactly those two workers. Do not add a third synthesis worker unless the user asks for one.
- Put workers in execution order. Use dependsOn only for real upstream dependencies, and make every dependsOn value match another worker role exactly.
- Each worker has one clear handoff: "analysis" for requirements/boundary discovery, "implementation" for code/design production, "verification" for tests/evidence, "review" for risk/conflict review, "summary" only for final synthesis roles.
- Avoid duplicate capabilities across adjacent workers unless they intentionally cross-check each other.
- Workers should speak in natural language for the shared discussion.
- Use blackboardContract.mode "non-convergent" only when the requested success condition cannot be proven by finite discussion evidence or forbids the condition needed to stop. Include concise evidence from the request and contradictions explaining why the discussion must run to the hard round cap.

Score and worker count (calibration, do not let score override mode):

- 0.00–0.30: pure direct (chit-chat, single fact, single-sentence rewrite, long output where all constraints are easily satisfiable).
- 0.30–0.50: direct-with-watch (single ambiguous task, may need follow-up, mild constraint tension).
- 0.50–0.70: multi-participant discussion with 2 workers — genuine competing claims, one proposer + one challenger.
- 0.70–1.00: multi-participant discussion with 3+ workers — clearly independent workstreams or multiple distinct stakeholder perspectives that each need their own voice.

Worker count:

- 2 workers: one constructs the answer, one independently challenges it. Sufficient for most discussion cases.
- 3 workers: only when there are three genuinely distinct roles that cannot collapse into propose + challenge (e.g. two opposing stakeholders + a neutral synthesizer; or analysis + implementation + verification as separate passes).
- 4–5 workers: rare, only when the request explicitly names that many perspectives or when sub-tasks are demonstrably independent with different domain knowledge.
- Default to 2 workers when in doubt.

Do not use fixed taxonomies. Infer signals from this request only. Keep score in [0, 1].

User request:
{{request}}
