# Evaluation Protocol

## Purpose

Flyflor uses the configured real LLM provider path for every test. Tests must
not use mock, fake, stub, or deterministic model providers, and missing model
credentials must fail the test run instead of skipping it.

## Required Scenarios

- Reply to a direct greeting without project inspection, stale task tail, or
  exposed coding tools.
- Ask a clarification question for ambiguous references such as "continue",
  "that project", or "this error" when the knowledge tree cannot resolve one
  target confidently.
- Add project tooling such as Prettier by reading the repository first.
- Analyze a local project path using tools before answering.
- Recall a user fact by question intent, not by naive recent summary.
- Recover after process interruption.
- Continue a turn after tool calls and context compaction.
- Preserve a full brain audit trail.
- Rebuild memory indexes from brain audit data.
- Execute atomic multi-edit and validate failure rollback.
- Report CodeGraph or RTK absence with explicit unavailable or failed diagnostics.
- Serve the socket test page with chat on the left and debug on the right.

## Real Model Budget

OpenAI-compatible real-model scenarios must cap output tokens deterministically.
Runtime first honors `model.max_tokens`; when it is unset, it must use the
active provider model's `providers.<name>.models.<model>.max_tokens` value.
This keeps reasoning-heavy providers such as DeepSeek from consuming the whole
scenario timeout before producing answer content.

Acceptance scenarios use the configured real LLM path. Core runtime must not
silently substitute mock, fake, or fallback provider behavior for turn
decisions.

## Evidence

Every scenario must leave review evidence:

- brain audit rows,
- memory retrieval traces,
- tool artifacts,
- socket debug events,
- final assistant answer,
- validation command output.
