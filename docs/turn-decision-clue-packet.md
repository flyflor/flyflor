# Turn Decision And Clue Packet Design

Flyflor core does not classify user text by matching words. The host builds a
bounded clue packet, asks a model to produce a JSON turn decision, and then
routes context and tools from that decision.

## Runtime Contract

`ContextIntentAnalyzerComponent` now has three responsibilities:

- Collect provenance-backed clues from memory, knowledge tree, recent messages,
  checkpoints, and recovery state.
- Send those clues to the model with `prompts/intent.md`.
- Parse the returned JSON into a `ContextIntentDecision`.

It must not decide that a user is greeting, continuing, coding, or asking a
memory question by checking characters in the user message. If the model
decision call fails, returns no JSON, or returns invalid JSON, the turn must fail
explicitly and be audited. Runtime must not fabricate a direct reply decision.

Scenario coverage uses the real configured LLM path for turn decisions. The
decision call must have enough output budget for complete JSON, and the prompt
must request compact JSON rather than prose. A truncated or empty provider
response is treated as a model failure, not as permission for the host to infer
intent from user characters.

## Decision Shape

The model returns:

- `mode`: `direct_reply`, `clarify_reference`, `continue_task`,
  `investigate`, `code`, `memory_answer`, or `refuse_or_block`.
- `contextSourcesToInject`: explicit source groups for `ContextBuilderService`.
- `toolGroupsToExpose`: explicit tool groups for `AgentRuntimeService`.
- optional task ids, clarification question, project path, shell command, and
  facts to store.

Runtime derives:

- `contextPolicy`: `isolated`, `task_scoped`, `memory_scoped`, or
  `project_scoped`.
- `targetConfidence`: `none`, `ambiguous`, or `unique`.
- `writeTargetRoot`: the only root allowed for model-requested file mutation,
  present only when the decision exposes edit tools and identifies one project
  path.
- `candidateTaskIds`: if the model chooses `clarify_reference` or
  `continue_task` but omits candidate ids, runtime copies task ids from the
  clue packet for audit and clarification. It does not select one target.

`ContextBuilderService` injects only the requested source groups. The default
direct response path does not include recent task tail, durable memory recall,
or knowledge-tree content.

## Knowledge Tree Role

The knowledge tree supplies candidates for "which thing" resolution. It does
not make the final semantic decision. The model decides whether one candidate is
strong enough to continue or whether Flyflor must ask the user to clarify.

## Tool Visibility

The full tool registry is never automatically exposed to the model. Runtime maps
model-selected tool groups into concrete tools:

- `read_only`: `read`, `glob`, `grep`, `git`
- `memory_read`: `memory_recall`
- `memory_write`: `memory_store`, `memory_forget`
- `context`: `context_compact`
- `codegraph`: `codegraph`
- `workmux`: `task`
- `shell`: `shell`
- `edit`: `write`, `edit`, `multi_edit`

`direct_reply`, `clarify_reference`, and `refuse_or_block` decisions expose no
tools. `shell` is exposed only with an exact `shellCommand`. `edit` is exposed
only when `writeTargetRoot` is present and `targetConfidence=unique`.

## Plugin Boundary

RTK remains an optional plugin for command-output filtering only. It does not
participate in turn decisions, recall acceptance, task continuation, tool
visibility, or shell allow/deny policy. Missing RTK must produce explicit
unavailable diagnostics; it must not silently substitute another filtering path.

CodeGraph remains an optional read-only coding plugin. If unavailable, runtime
records unavailable diagnostics and the `codegraph` tool result fails
explicitly.

## Audit Events

Each turn records:

- `turn.clue_packet.created`
- `turn.decision.completed`
- `context.ready`
- `tool.visibility.resolved`
- `tool.call.denied`
- `plugin.availability` / `plugin.unavailable` / `plugin.failed`

These events let log review answer what evidence the model saw, what it decided,
which context sources were injected, which target confidence was derived, and
which tools were exposed.

## Regression Evidence

The 2026-05-30 investigation found:

- At 16:07, the input "你好" triggered 19 tool calls.
- At 18:40, "你好" no longer triggered tools but still inherited a stale
  `flyflor-front` task tail.
- At 18:41, the phrase "这个项目根目录" was treated as the current Flyflor root
  and wrote a file there; at 18:43 the owner clarified that the intended target
  was `flyflor-front`.

The runtime contract above addresses these as separate requirements: direct
reply isolation, ambiguous reference clarification, and unique write-target
gating.
