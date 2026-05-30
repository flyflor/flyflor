# No-Session Coding Agent Architecture

## Goal

Flyflor is a no-session coding agent. No-session means the model provider is never trusted as the source of continuity. Every turn is reconstructed from local durable state.

The complete runtime must provide:

- WebSocket conversation and event interaction.
- Full-fidelity monthly brain audit.
- Durable working memory and disaster recovery.
- Question-aware recall.
- Context compaction and checkpointing.
- Model-driven tool loop.
- Atomic multi-file editing.
- Visible workmux sub-agent exploration.
- Optional external plugin integration.

## Runtime Flow

1. Socket receives `chat.message`.
2. Kernel creates `turnId` and writes a `brain_turns` row before model work starts.
3. User message is written to `brain_messages` and `memory.messages`.
4. Kernel records plugin availability diagnostics so optional tooling state is visible before planning.
5. `ContextIntentAnalyzerComponent` builds a clue packet from current input,
   recent conversation, memory/tree candidates, latest checkpoint, recovery
   state, and explicit local-environment clues.
6. The configured real `ModelProvider` answers `prompts/intent.md` with one
   compact JSON turn decision. The host does not classify by matching user
   characters.
7. Kernel writes `turn.clue_packet.created`, `turn.decision.completed`, and
   `context.intent` audit events.
8. `MemoryComponent` stores only model-requested durable facts and task hints
   from the decision.
9. `ContextBuilderService` injects only the model-selected context source
   groups, runs selected memory recall, reads selected checkpoints, and
   assembles model messages.
10. Kernel maps model-selected tool groups to concrete schemas and emits
    `tool.visibility.resolved`.
11. Model-decision-authorized inline project inspection or shell evidence may
    run before the main answer model call when the decision explicitly asks for
    it.
12. `ModelProvider` streams text and tool calls.
13. `ToolRuntime` executes model-requested tools, emits events, writes
    artifacts, and feeds results back to the model.
14. Context budget is checked before and during the loop; compaction writes
    checkpoints when needed.
15. Assistant final is written to brain and memory.
16. Recovery state is marked complete.

## Non-Negotiable Behavior

- A coding request must inspect local files through tools before answering when inspection is possible.
- Tool calls and tool results must be paired in context and audit records.
- Every side effect must pass through `SignalBus`.
- Brain audit data is never deleted by context compression.
- Memory recall must explain why each item was selected.
- Socket debug must show tool, memory, context, brain, and recovery events separately from chat bubbles.

## Context Order

Model input order is stable after the turn decision selects the source groups:

1. Constitutional templates.
2. Runtime system prompt.
3. Current runtime state.
4. Turn decision summary and diagnostics.
5. Recovery state when selected.
6. Active task ledger when selected.
7. Question-aware memory recall when selected.
8. Latest context checkpoint when selected.
9. Recent conversation tail when selected.
10. Current user input.
11. Tool results during the model loop.

## Acceptance

The agent passes when it can survive restart, recall project facts, explore source code, execute and review tools, compact without losing critical evidence, and expose a complete audit trail through `brain.db`.
