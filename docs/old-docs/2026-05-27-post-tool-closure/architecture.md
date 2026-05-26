# Architecture

## Position

Flyflor is a Bun + TypeScript intelligent-lifeform kernel. The active architecture is a Cognitive-Executive-Agent system exposed through a vascular socket surface.

- Cognitive owns fluid intelligence, hot memory, crystallized intelligence, Scope/Fork, codename, ASK, and recall.
- Executive owns capability exposure, tool execution, trust, approval, quota, loop safety, and sidecar/subprocess boundaries.
- Agent owns runtime assembly, prompt layering, Blackboard, sandbox, skills, MCP, plugins, workers, and model-facing structured blocks.
- Socket owns `/ws` and `/health`; `gateway.*` remains a v1 wire compatibility vocabulary only.

This repository is the Bun kernel. `flyflor-cli` is a sibling Rust TUI shell that consumes the socket contract; it is not the kernel architecture owner.

## Philosophy Layers

| Layer | Meaning | Code owners |
| --- | --- | --- |
| Constitution | Stable self/user/memory/project rules loaded from Markdown files and scope-local constitution files. | `src/cognitive/hippocampus/memory/markdown`, `templates/memory`, scope scaffolding |
| Fluid intelligence | Turn-time reasoning, generation, route decisions, ASK decisions, and model calls. | `src/cognitive/mindstream`, `src/agent/runtime`, `templates/prompts` |
| Hot memory | Recent, activated, scoped, decaying experience used for the current prompt. | `src/cognitive/hippocampus/memory/working`, `hot`, `recall`, `lifecycle` |
| Crystallized intelligence | Stable reusable methods and knowledge promoted into Crystal/Gem material. | `src/cognitive/crystal` |
| Route and Blackboard | Current-turn decision about direct answer versus worker deliberation. | `src/agent/runtime/blackboard`, `src/agent/blackboard` |
| ASK | Structured user decision boundary for uncertainty, scope/fork/Crystal/tool-loop closure. | `src/cognitive/hippocampus/ask`, `src/agent/runtime/module.ts` |
| Executive exoskeleton | Tool and capability layer outside cognition. | `src/executive`, `src/agent/runtime/mcp`, `src/agent/sandbox` |
| Vascular socket | External control/event/read-model transport. | `src/socket`, `src/protocol/control` |

## Source Directory Map

| Path | Current role |
| --- | --- |
| `app.ts` | Thin command/mode entry. |
| `src/app.ts` | Composition root. It binds config, events, model, Blackboard, Memory, Runtime, and Socket modules. |
| `src/cognitive/mindstream` | Fluid-intelligence provider adapters and generation clients. |
| `src/cognitive/hippocampus` | ASK, continuation state, identity append, Memory, Scope recall, codename promotion, and ContextFork memory stores. |
| `src/cognitive/crystal` | Crystal memory, vector index, reflection candidates, Gem promotion, and drift repair. |
| `src/executive` | Capability registry, manifests, tool descriptors, trust policy, loop guard, MCP adapter, computer profile, and sidecar runner contract. |
| `src/agent/runtime` | Turn pipeline, route selection, prompt assembly, MCP/tool wiring, skills, subagents, streaming visibility, and reflection worker. |
| `src/agent/blackboard` | Blackboard store/module and worker composition. |
| `src/agent/context` | Explicit Scope/Fork normalization and continuity-owner keys. |
| `src/agent/sandbox` | Approval, quota, audit sinks, and shell-hook execution gates. |
| `src/socket` | `/ws`, `/health`, control hub, dedup, read cache, and ledger/detail query readers. |
| `src/events` | Runtime event types, event component, sinks, and classifier. |
| `src/protocol` | Contracts, enums, control envelopes, process envelopes, and structured block registry. |
| `src/config` | JSONC config loading, defaults, and paths. |
| `templates` | Runtime prompt templates, memory templates, and project templates. |

## Two Planes

Runtime context and life history are separate systems.

| Plane | Sources | Owner | Purpose |
| --- | --- | --- | --- |
| Context plane | Current input, constitution, Memory recall, Crystal recall, explicit `activeScope`, explicit `contextForkId`, Executive visible capabilities | `src/agent/runtime`, `src/agent/context`, `src/cognitive` | Assemble the current model turn. |
| Ledger/query plane | Current-month `brain.db`, archives, detail tables, replay/audit rows | `src/cognitive/hippocampus/memory/brain`, `src/entities/memory/brain`, `src/socket/query` | Store, query, replay, audit, and inspect life history. |

`brain.db` can provide provenance, detail rows, replay anchors, and read-model snapshots. It does not directly become prompt text and does not restore hidden session continuity.

## Continuity Rules

Allowed continuity anchors:

- `RuntimeContext.activeScope`
- `RuntimeContext.contextForkId`
- codename as proposal, anchor, and recall boost
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

These fields remain useful for routing, audit, deduplication, and reply anchoring.

## Prompt Layering

Prompt assembly is layered in this order of authority:

1. Constitution: global Markdown memory files and scope-local constitution when an explicit scope is loaded.
2. Crystal: stable crystallized knowledge and methods.
3. Memory: hot recall, working-memory summaries, active memory atoms, and recall evidence.
4. Scope/Fork: explicit scope and context fork constraints.
5. Blackboard advisory: only when the route elects deliberation or a worker result must be summarized.
6. Executive visible capability surface: only capabilities allowed by config, channel, trust policy, sandbox, approval state, quota, and loop guard.
7. Request context: current user input, attachments, and turn metadata.

`brain.db` stays outside prompt layering. It is queried by explicit readers and may contribute provenance through Memory/Crystal owners, but it is not a prompt container.

## Socket Boundary

`SocketModule` starts a Bun server with:

- `GET /health`
- `GET /ws`

`/ws` handles control/event envelopes through `SocketControlHub`. It dispatches `gateway.message.send`, returns `turn.delta` / `turn.final` / `turn.error`, exposes status/capability/history/detail snapshots, and subscribes to RuntimeEvents.

The CLI closure rule is strict: `flyflor-cli` may render socket data, send user decisions, and request snapshots. It must not call Runtime private APIs, write `brain.db`, invent memory continuity, or execute tools outside Executive.
