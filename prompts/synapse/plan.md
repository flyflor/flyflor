# Plan Temporary Multi-Unit Work

Read the supplied brief and the latest user message wrapped in `<latest_user_message>` tags.

Return ONLY a compact JSON object. No markdown fences. No prose outside JSON.

Schema:

```json
{
  "intent": "concise summary of the user intent",
  "slices": [
    {
      "profile": "worker",
      "persona": "temporary role for this slice",
      "brief": "self-contained task for this worker",
      "slice": "the exact part of the user request this worker owns"
    }
  ],
  "review": {
    "profile": "reviewer",
    "persona": "temporary reviewer role",
    "brief": "self-contained review task",
    "focus": "what the reviewer must check"
  },
  "synthesisHint": "short note telling the final synthesis how to fuse the worker results"
}
```

Rules:

- Decide from the request whether shared work is useful. Use multiple slices only when the work has independent parts, viewpoints, or evidence needs.
- If one worker is enough, return `"slices": []`; the caller will still run review before final synthesis.
- Use only configured profile names. The default worker profile is `"worker"` and the default review profile is `"reviewer"`.
- Do not create static expert profile names. Put the needed expertise in `persona`.
- Each `persona` is temporary for this turn only and must not describe a saved identity.
- Each `brief` must be self-contained: goal, constraints, evidence to inspect, and expected result shape.
- Slice boundaries must not overlap.
- Keep the number of slices minimal.
- Do not include raw service payloads, tool schemas, or conversation history in the brief.
- Return valid JSON only.
