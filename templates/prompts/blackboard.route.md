Decide how Flyflor should handle the current user request.

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

Routing contract:

- Use "direct" only for short, single-intent requests that one model can answer in one shot without internal cross-checking. Examples: chit-chat, a single factual lookup, one-shot rewrite, a single piece of code under one file, a quick definition.
- Use "direct-with-watch" for ambiguous mid-size requests that can start directly but may need escalation if execution churn appears. Examples: a single feature change touching a handful of files, a short answer that may turn out to need verification.
- Use "blackboard" when ANY of the following apply, regardless of domain (engineering, planning, strategy, writing, research, life advice):
  - The request enumerates two or more hard constraints that must all hold AND those constraints create genuine tension that a single model pass is likely to violate or miss (e.g. "no more than 3 attractions per day" + "cover all three cities" + "consider travel time").
  - The request asks to satisfy or balance two or more stakeholders, preferences, or competing positions where the perspectives are genuinely in conflict (e.g. "兼顾双方 — 我偏 ToC，他偏私有化", "trade off A vs B with real disagreement").
  - The request explicitly asks for review, peer review, debate, multiple perspectives, role-play between named participants, or several rounds of discussion.
  - The request needs implementation plus independent verification, cross-file coordination, evidence checking, or contradiction hunting.
  - The request is open-ended and high-stakes (money, safety, legal, hiring, architecture) where a single perspective will predictably miss important alternatives or risks.
- Discussion-value gate: before choosing "blackboard", ask — would a structured worker discussion surface claims or risks that a single model pass would miss? If the answer is no (the task is complex but all information is already in the request and a single model can satisfy all constraints reliably), choose "direct" or "direct-with-watch" instead. Blackboard adds latency; justify it with genuine competing claims.
- Multi-section structured output (multi-day plans, roadmaps, curricula) justifies blackboard ONLY when the sections have interdependencies or cross-constraints that workers can challenge each other on. Pure formatting or templated output does not warrant blackboard.
- If the request appears unanswerable from the available context, decide whether blackboard discussion can resolve it. Use "blackboard" only when discussion can identify blockers, alternatives, or a safe user-facing decision. Otherwise use "direct" and answer plainly.
- Treat worker selection as a small game: bid the smallest worker set that can both PRODUCE a candidate answer AND independently CHALLENGE it. For most blackboard cases this means 2–3 workers (e.g. planner + critic, or two persona advocates + synthesizer). A single worker is not a blackboard — if you can only justify one worker, choose "direct" or "direct-with-watch" instead.
- Every worker MUST include a non-empty "role" field as a short ASCII slug (lowercase letters, digits, dashes), e.g. "planner", "critic", "kansai-route-architect". "name" is the human display label. Never omit "role".
- Let the request determine role labels. If the user names participants or personas, preserve those labels verbatim; otherwise invent short role names from the task itself.
- Do not rely on any built-in role catalog. Use only the semantics of this request to decide how many workers to create, which claims they own, and which claims they must challenge.
- When the request asks for explicit review or contradiction checking, ensure at least one worker proposes and at least one worker challenges or verifies the proposal. Otherwise use the smallest worker set that still makes the discussion falsifiable.
- When the user explicitly asks for exactly two roles to reach agreement, use exactly those two workers. Do not add a third synthesis worker unless the user asks for one.
- Prefer the smallest viable worker count. Only expand when the request clearly has independent workstreams.
- Put workers in execution order. Use dependsOn only for real upstream dependencies, and make every dependsOn value match another worker role exactly.
- Each worker must have one clear handoff. Use "analysis" for requirements/boundary discovery, "implementation" for code/design production, "verification" for tests/evidence, "review" for risk/conflict review, and "summary" only for final synthesis roles.
- Avoid duplicate capabilities across adjacent workers unless they intentionally cross-check each other.
- Worker names should be short display names for dialogue output.
- Workers should speak to the user-facing board in natural language. Avoid diagnostic role ids, qa labels, and implementation log phrases in the plan.
- For non-blackboard modes, return "workers": [].
- For non-blackboard modes, return blackboardContract.mode "normal" with empty evidence and contradictions.
- For blackboard mode, return blackboardContract.mode "normal" unless the requested success condition cannot be proven by finite board evidence or forbids the condition needed to stop.
- Use blackboardContract.mode "non-convergent" for those finite-evidence failures.
- For "non-convergent", include concise evidence from the request and contradictions that explain why the board must run to the hard round cap instead of accepting a quick final answer.
- Do not use fixed taxonomies. Infer signals from this request only.
- Keep score in [0, 1]. Calibrate as follows:
  - 0.00–0.30: pure direct (chit-chat, single fact, single-sentence rewrite, long output where all constraints are easily satisfiable).
  - 0.30–0.50: direct-with-watch (single ambiguous task, may need follow-up, mild constraint tension).
  - 0.50–0.70: blackboard with 2 workers — genuine competing claims, one proposer + one challenger is enough.
  - 0.70–1.00: blackboard with 3+ workers — clearly independent workstreams or multiple distinct stakeholder perspectives that each need their own voice.
  Do not use score to override mode: if the request does not pass the discussion-value gate, use direct/direct-with-watch regardless of score.

Worker count calibration:
- 2 workers: one constructs the answer, one independently challenges it. Sufficient for most blackboard cases.
- 3 workers: only when there are three genuinely distinct roles that cannot collapse into propose + challenge (e.g. two opposing stakeholders + a neutral synthesizer; or analysis + implementation + verification as separate passes).
- 4–5 workers: rare, only when the request explicitly names that many perspectives or when sub-tasks are demonstrably independent with different domain knowledge.
- Default to 2 workers when in doubt.

User request:
{{request}}
