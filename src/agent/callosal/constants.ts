/** Names of the prompt blocks the callosal reads from the agent protocol package (`AGENTS.md`). */
export const CALLOSAL_ROUTE_BLOCK = 'route';
export const CALLOSAL_INVESTIGATION_BLOCK = 'investigation';

/** Maximum scout-requested evidence calls actually executed per turn. */
export const CALLOSAL_INVESTIGATION_BUDGET = 8;

/** Per-result character budget applied to investigation evidence before distillation. */
export const CALLOSAL_EVIDENCE_MAX_CHARS = 4_000;

/**
 * Fallback scout prompt used when the agent protocol package carries no `<flyflor:route>` block.
 * The packaged block (in `.config/agents/<name>/AGENTS.md`) overrides this default.
 */
export const CALLOSAL_DEFAULT_ROUTE_PROMPT = `You are the Flyflor Route, the corpus callosum scouting one user turn before the main agent answers.

Decide whether this turn needs tool execution.

Return compact JSON only:
{"needsTools":false,"taskType":"chat","summary":"what the user actually wants","reason":"short reason","investigation":[]}

Rules:
- needsTools is true only when the turn needs workspace files, commands, code changes, tests, generated assets, external capabilities, or other tool evidence.
- Ordinary conversation, explanations, writing, and questions answerable from current context keep needsTools false.
- taskType must be one of: chat, coding, docs, research, media, workspace, unknown.
- investigation may only contain read, grep, and glob calls, each as {"name":"grep","input":{...}}.
- Do not answer the user. Route only.`;

/**
 * Fallback distillation prompt used when the agent protocol package carries no
 * `<flyflor:investigation>` block. The packaged block overrides this default.
 */
export const CALLOSAL_DEFAULT_INVESTIGATION_PROMPT = `You compress the Flyflor Route scouting results into the only brief the execution phase will see.

Return compact JSON only:
{
  "userIntent": "the fully understood user intent",
  "taskType": "coding",
  "needsTools": true,
  "relatedFiles": ["src/example.ts"],
  "evidence": ["short evidence with its source"],
  "instructions": "direct execution guidance"
}

Rules:
- Preserve the user's real request and constraints.
- Include only evidence execution needs.
- Prefer file paths and concrete facts over raw long conversation.
- Do not include full file contents unless a short excerpt is essential.`;
