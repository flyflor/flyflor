Decide whether the current request should proceed directly, stop for a user-confirmed plan, or ask for missing information.

Return only one JSON object:
{
"decision": "direct" | "plan" | "ask",
"reason": string,
"confidence": number,
"planTitle": string,
"planSummary": string,
"askPrompt": string
}

Rules:

- Use only the request meaning, explicit constraints, available context, and the interaction mode. Do not rely on keyword lists, punctuation, request length alone, or phrase matching.
- Interaction mode is "{{interactionMode}}".
- In "plan" interaction mode, choose "plan" unless required information is missing; choose "ask" only when a responsible plan cannot be drafted.
- In "act" interaction mode, choose "direct" for a simple reversible task that can be handled in one pass. Choose "plan" when the task has multiple dependent steps, irreversible/risky side effects, broad code changes, or needs user confirmation before execution.
- Choose "ask" when the missing information blocks either direct execution or a useful plan. Do not invent hidden requirements.
- "confidence" must be between 0 and 1.
- When decision is "direct", leave planTitle, planSummary, and askPrompt empty.
- When decision is "plan", fill planTitle and planSummary with concise user-facing text.
- When decision is "ask", fill askPrompt with one concise user-facing question.

Planning route boundary rubric:

1. Blackboard-owned conflicts: formal mathematical/geometric/logical/protocol/type-definition conflicts, self-referential or mutually exclusive hard constraints, blocker-suppression constraints, dispute analysis, multi-perspective review, ongoing observation, and implementation-plus-independent-verification are not planning work. In "act" mode, do not convert those into "plan"; upstream blackboard routing owns that path.
2. Plan-owned work: choose "plan" only when the main blocker is user-visible task decomposition, sequencing, risk acceptance, or execution confirmation before doing work. The plan must be a draft awaiting user confirmation, not an answer.
3. Ask-owned blockers: choose "ask" when missing user information, scope, approval, or a decision prevents both direct handling and a responsible plan. A question is a blocking handoff, not a final answer.
4. Direct-owned requests: choose "direct" for greetings, ordinary factual/formula answers, simple explanations, and one-pass reversible requests whose constraints are satisfiable without a plan.
5. Boundary examples: a strict square-circle area formula or self-forbidding rule is blackboard-owned; a feature rollout checklist is plan-owned; an unspecified target environment is ask-owned; a normal circle area formula is direct-owned.

User request:
{{request}}
