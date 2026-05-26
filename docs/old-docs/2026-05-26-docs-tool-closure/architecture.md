# Architecture

## Position

Flyflor is a Bun + TypeScript intelligent-lifeform kernel. The current line is the Cognitive-Executive-Agent Architecture:

- Cognitive owns fluid intelligence, hot memory, crystallization, Scope/Fork and ASK.
- Executive owns capability exposure, tool execution, trust, approval, quota and loop safety.
- Agent owns runtime assembly, Blackboard, sandbox, skills, MCP, plugins, prompts and workers.
- Socket exposes the vascular surface through `/ws` and `/health`.

This repository is the Bun kernel only. Rust-shell documents are archived under `docs/old-docs/` as future handoff material for an independent repository.

## Two Planes

Runtime context and ledger history are separate systems.

| Plane | Sources | Owner | Purpose |
| --- | --- | --- | --- |
| Context plane | Current input, Memory recall, Crystal recall, explicit `activeScope`, explicit `contextForkId`, Executive visible capabilities | `src/agent/runtime`, `src/agent/context`, `src/cognitive` | Assemble the current model turn. |
| Ledger/query plane | Current-month `brain.db`, archives, detail tables, replay/audit rows | `src/cognitive/hippocampus/memory/brain`, `src/entities/memory/brain`, `src/socket/query` | Store, query, replay, audit and inspect life history. |

`brain.db` can provide provenance and replay anchors, but it does not directly become prompt text and does not restore hidden session continuity.

## Source Directory Map

| Path | Current role |
| --- | --- |
| `app.ts` | Thin command/mode entry. |
| `src/app.ts` | Composition root. It binds `ConfigComponent`, `EventsComponent`, `ModelComponent`, `BlackboardModule`, `MemoryModule`, `RuntimeModule` and `SocketModule`. |
| `src/cognitive/mindstream` | Model clients and fluid-intelligence provider adapters. |
| `src/cognitive/hippocampus` | ASK parsing, continuation ghost state, identity append, Memory, Scope recall, codename promotion and ContextFork-related memory stores. |
| `src/cognitive/crystal` | Crystal memory, vector index, reflection candidates and Gem promotion. |
| `src/executive` | Manifest loading, capability registry, trust policy, loop guard, tool runtime and sidecar runner contracts. |
| `src/agent/runtime` | Turn pipeline, route selection, planning blocks, MCP/tool wiring, skills, subagents, streaming visibility and reflection worker. |
| `src/agent/blackboard` | Blackboard store/module and worker composition. |
| `src/agent/context` | Explicit Scope/Fork normalization and continuity-owner keys. |
| `src/agent/sandbox` | Approval, quota, audit sinks and shell-hook execution gates. |
| `src/socket` | `/ws`, `/health`, control hub, dedup, read cache and ledger/detail query readers. |
| `src/events` | Runtime event types, event component, sinks and classifier. |
| `src/protocol` | Contracts, enums, control envelopes, process envelopes and structured block registry. |
| `src/config` | JSONC config loading, defaults and paths. |
| `templates` | Runtime prompt templates, memory templates and project templates. |

## Cognitive Organs

Mindstream is the current fluid intelligence: model calls, generation, local reasoning and turn-time decisions.

Memory is the hot zone: Markdown constitution files, working memory episodes, recent activation, TTL decay, hot compression, dream/consolidation workers, scope-local memory and recall evidence.

Crystal is crystallized intelligence: stable method/knowledge memory, Gem snapshots, vector recall and drift repair. It is not a larger chat log.

Scope is an explicit durable work domain. It can own local constitution, `project.memory.md`, scope-local memory/index material and future skill/MCP/plugin surfaces.

ContextFork is an explicit branch. It is not recovered from channel metadata.

ASK is the closure organ for uncertainty, scope promotion, fork merge conflict, blackboard cap, tool-loop pause and crystallization gates.

## Continuity Rules

Allowed continuity anchors:

- `RuntimeContext.activeScope`
- `RuntimeContext.contextForkId`
- codename as proposal/anchor/recall boost
- Memory activation and recall evidence
- Crystal recall
- ledger provenance and replay references

Not continuity owners:

- `clientId`
- `conversationKey`
- `threadId`
- connection id
- transport actor metadata
- `sourceKey` / `sourceSurface`

These fields remain useful for routing, audit, deduplication and reply anchoring.

## Prompt Layering

Prompt assembly is layered:

1. Constitution: global Markdown memory files and scope-local constitution when an explicit scope is loaded.
2. Crystal: stable crystallized knowledge and methods.
3. Memory: hot recall, working-memory summaries, active memory atoms and recall evidence.
4. Scope/Fork: explicit scope and context fork constraints.
5. Executive visible capability surface: only the capabilities currently allowed by config, channel, trust policy, sandbox and loop guard.
6. Request context: current user input, attachments and turn metadata.

`brain.db` stays outside that list. It is queried for history/detail/replay/audit and for provenance used by other owners, but it is not a direct prompt container.

## Socket Surface

`SocketModule` starts a Bun server with:

- `GET /health`
- `GET /ws`

`/ws` handles control/event envelopes through `SocketControlHub`. It can dispatch `gateway.message.send`, return `turn.delta` / `turn.final` / `turn.error`, expose status/capability/history/detail snapshots and subscribe to RuntimeEvents.

`gateway.*` names remain v1 wire compatibility. The architecture owner is `src/socket`.
