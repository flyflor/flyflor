Decide how Flyflor should handle the current user request.

Return only one JSON object:
{
"mode": "direct" | "direct-with-watch" | "blackboard",
"score": number,
"reason": string,
"signals": string[],
"needsReflectionCandidate": boolean,
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

- Use "direct" for requests that can be answered immediately without internal discussion.
- Use "direct-with-watch" for uncertain middle cases that can start directly but may need escalation if execution churn appears.
- Use "blackboard" when the request needs multi-participant discussion, implementation plus verification, review, cross-file coordination, or evidence checking before answer.
- If the request appears unanswerable from the available context, decide whether blackboard discussion can resolve it. Use "blackboard" only when discussion can identify blockers, alternatives, or a safe user-facing decision. Otherwise use "direct" and answer plainly.
- For "blackboard", define the worker count and worker roles from this request only. Use compact semantic role ids, not a fixed Planner/Reviewer pair.
- For non-blackboard modes, return "workers": [].
- Do not use fixed taxonomies. Infer signals from this request only.
- Keep score in [0, 1]. Below 0.35 should normally be direct, 0.35 to 0.55 direct-with-watch, and 0.55 or above blackboard unless your reason explains otherwise.

User request:
{{request}}
