# Flyflor Documentation

This directory keeps the current Bun-kernel contract. Active documentation is maintained as synchronized English `.md` and Chinese `.zh.cn.md` pairs. Retired, misleading, or superseded material is moved under `old-docs/` with traceable file names.

Official homepage: [https://flyflor.qingshen.xin](https://flyflor.qingshen.xin)

## Reading Order

1. [boundaries.md](boundaries.md) - hard engineering boundaries, OOP + use composition, JSONC config, Bun binary constraints, and the zero-character-matching rule.
2. [architecture.md](architecture.md) - philosophy layers, source ownership, context/ledger split, vascular socket boundary, prompt layering, and flyflor-cli relationship.
3. [directory.architecture.md](directory.architecture.md) - source owners, naming rules, and retired paths.
4. [runtime.turn.md](runtime.turn.md) - single-turn runtime flow from `/ws` to Memory, Crystal, Executive, and events.
5. [memory.system.md](memory.system.md) - constitution, hot memory, memory tree, recall, forgetting, vector offset, Scope, codename, ContextFork, Crystal, and `brain.db`.
6. [blackboard.md](blackboard.md) - routing, Blackboard workers, ASK handoff, current-turn deliberation, and query boundaries.
7. [crystal.reflection.md](crystal.reflection.md) - Crystal reflection, Gem promotion, and drift repair.
8. [executive.exoskeleton.md](executive.exoskeleton.md) - Capability / Tool / Trust / Loop, MCP, user tools, sidecars, subagents, approval, and the CLI tool-call closure.
9. [control.protocol.md](control.protocol.md) - `/ws` control protocol, snapshot matrix, thin-client bootstrap, and current CLI closure state.
10. [ws.doc.md](ws.doc.md) - field-level WebSocket manual and detail query matrix.
11. [runtime.events.md](runtime.events.md) - event classes, timelines, and subscription surface.
12. [development.workflow.md](development.workflow.md) - worktree/tmux/Codex collaboration flow.
13. [project.report.md](project.report.md) - current architecture report.
14. [external.kit.md](external.kit.md) - read-only external kit discovery.
15. [external.tools.seal.md](external.tools.seal.md) - external tool capability matrix and seal criteria.
16. [mcp.tools.md](mcp.tools.md) - MCP discovery, resources, prompts, and tool execution.
17. [sandbox.capabilities.md](sandbox.capabilities.md) - sandbox, approval, and audit boundaries.
18. [skill.system.md](skill.system.md) - external `SKILL.md` capability packages.
19. [refactor.roadmap.md](refactor.roadmap.md) - sealed Bun-kernel roadmap and drift policy.
20. [openapi/flyflor.socket.openapi.md](openapi/flyflor.socket.openapi.md) - Apifox-importable socket OpenAPI.
21. [apifox/README.md](apifox/README.md) - Apifox WebSocket examples and local tester.
22. [../TODO.md](../TODO.md) - active handoff and next work.

## Core Position

- Flyflor is the Bun + TypeScript intelligent-lifeform kernel. It is not a chat/session agent and not a CLI application.
- Mindstream is fluid intelligence: model calls, generation, route decisions, and turn-time reasoning.
- Memory is hot, scoped, and decaying. Crystal is reusable crystallized intelligence. `brain.db` is the ledger/query/replay/audit/detail store.
- `Scope` is the explicit work domain. `ContextFork` is an explicit branch. `codename` is an anchor/proposal/recall boost before scope promotion.
- ASK closes uncertainty, scope promotion, fork merge conflict, crystallization gates, tool-loop pauses, and user decisions.
- Executive is the action exoskeleton. Tools, MCP, plugins, skills, sidecars, user tools, subagents, sandbox, quota, approval, and audit pass through it.
- `src/socket` owns the vascular layer. `gateway.*` names remain `flyflor.ws.v1` wire compatibility strings only.
- HTTP stays limited to `/ws` and `/health`; `/channels` is not restored.

## flyflor-cli Closure

`flyflor-cli` is an external Rust TUI shell. It consumes `/ws` envelopes, snapshots, and events; it must not become the kernel, memory owner, tool executor, prompt container, or ledger writer.

Current closure status:

- Kernel local smoke examples use `ws://127.0.0.1:8788/ws`; the CLI default is `ws://127.0.0.1:8787/ws`. Use `FLYFLOR_WS_URL` until defaults are unified.
- The kernel exposes `server.hello` and `capability.catalog.get`; the CLI bootstrap requests the capability catalog.
- Kernel context input supports `toolApprovals.mcpToolCalls` and `toolApprovals.userToolCalls`; the CLI exposes `/approve` for one-turn non-YOLO approval and also documents/displays YOLO mode.
- ASK typed-answer continuation is closed: plain replies such as `lint:fix` or `prettier:all` carry the latest pending ASK continuation metadata instead of starting a context-losing fresh turn.
- `/undo` is a kernel command (`gateway.message.undo`). The CLI selects a user-message anchor; the kernel records append-only undo audit and abandons affected hot memory / ASK / continuation state without deleting `brain.db`.
- Model context-window display is kernel-authoritative when `gateway.status.snapshot.model.contextWindowTokens` is present; the kernel resolves explicit config, provider model metadata, and fallback mapping before the CLI renders it.

## Archive

`old-docs/` stores historical material. The files can explain past decisions but cannot define the active runtime contract.

External Rust-shell references are archived only:

- [old-docs/rust.integration.md](old-docs/rust.integration.md)
- [old-docs/rust.connection.core.md](old-docs/rust.connection.core.md)
- [old-docs/rust.gateway.shell.backlog.md](old-docs/rust.gateway.shell.backlog.md)

The active documentation snapshots archived on 2026-05-25 and 2026-05-26 live under dated `old-docs/` subdirectories.

## 外部仓库参考

This heading is kept intentionally for the docs guard and for bilingual operators scanning the English index. These Rust-shell references remain external-only:

- [old-docs/rust.integration.md](old-docs/rust.integration.md)
- [old-docs/rust.connection.core.md](old-docs/rust.connection.core.md)
- [old-docs/rust.gateway.shell.backlog.md](old-docs/rust.gateway.shell.backlog.md)
