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
  - The request enumerates two or more hard constraints that must all hold in the final answer (e.g. "must cover X, Y, Z", "no more than N per day", "at least M of A", "consider B and C", explicit budgets, deadlines, role limits).
  - The request asks to satisfy or balance two or more stakeholders, preferences, or competing positions (e.g. "兼顾双方", "trade off A vs B", "we disagree, give a plan").
  - The expected output is a structured, multi-section artifact such as a multi-day schedule, a roadmap, a milestone plan, an org/strategy proposal, a design doc, a market plan, a curriculum, a comparative analysis.
  - The request explicitly asks for review, peer review, debate, multiple perspectives, role-play between named participants, or several rounds of discussion.
  - The request needs implementation plus independent verification, cross-file coordination, evidence checking, or contradiction hunting.
  - The request is open-ended and high-stakes (money, safety, legal, hiring, architecture) where a single perspective is likely to miss alternatives or risks.
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
  - 0.00–0.30: pure direct (chit-chat, single fact, single-sentence rewrite).
  - 0.30–0.50: direct-with-watch (single ambiguous task, may need follow-up).
  - 0.50–1.00: blackboard. Any request matching one of the blackboard triggers above must score at least 0.55 and use mode "blackboard"; do not downgrade because the topic is "easy to write a long answer" — long-form, multi-constraint or multi-stakeholder requests are exactly what the blackboard exists for.

User request:
{{request}}
