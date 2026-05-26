# Flyflor Documentation

This directory keeps the current Bun-kernel contract. Active documentation is maintained as synchronized English `.md` and Chinese `.zh.cn.md` pairs. Retired, misleading or historical material is moved under [old-docs/](old-docs/) with traceable file names.

Official homepage: [https://flyflor.qingshen.xin](https://flyflor.qingshen.xin)

## Reading Order

1. [boundaries.md](boundaries.md) - hard engineering boundaries, OOP + use composition, JSONC config, Bun binary constraints, and the zero-character-matching rule.
2. [architecture.md](architecture.md) - project philosophy, source directory map, context plane and ledger/query plane.
3. [directory.architecture.md](directory.architecture.md) - source owners, naming rules and retired paths.
4. [runtime.turn.md](runtime.turn.md) - single-turn runtime flow from `/ws` to Memory, Crystal, Executive and events.
5. [memory.system.md](memory.system.md) - Memory, Crystal, Scope, codename, ContextFork, recall, forgetting and `brain.db`.
6. [blackboard.md](blackboard.md) - route decisions, Blackboard workers and ASK handoff.
7. [crystal.reflection.md](crystal.reflection.md) - Crystal reflection, Gem promotion and drift repair.
8. [executive.exoskeleton.md](executive.exoskeleton.md) - Capability / Tool / Trust / Loop and external sidecars.
9. [control.protocol.md](control.protocol.md) - `/ws` control protocol and snapshot matrix.
10. [ws.doc.md](ws.doc.md) - field-level WebSocket manual.
11. [runtime.events.md](runtime.events.md) - event classes, timelines and subscription surface.
12. [development.workflow.md](development.workflow.md) - worktree/tmux/Codex collaboration flow.
13. [project.report.md](project.report.md) - current architecture report.
14. [external.kit.md](external.kit.md) - read-only external kit discovery.
15. [external.tools.seal.md](external.tools.seal.md) - external tool capability matrix and seal criteria.
16. [mcp.tools.md](mcp.tools.md) - MCP discovery, resources, prompts and tool execution.
17. [sandbox.capabilities.md](sandbox.capabilities.md) - sandbox, approval and audit boundaries.
18. [skill.system.md](skill.system.md) - external `SKILL.md` capability packages.
19. [refactor.roadmap.md](refactor.roadmap.md) - sealed Bun-kernel roadmap and drift policy.
20. [openapi/flyflor.socket.openapi.md](openapi/flyflor.socket.openapi.md) - Apifox-importable socket OpenAPI.
21. [apifox/README.md](apifox/README.md) - Apifox WebSocket examples and local tester.
22. [../TODO.md](../TODO.md) - active handoff and next work.

## Core Position

- Runtime context is assembled from current input, `MemoryComponent`, `CrystalComponent`, explicit `Scope/Fork`, and the Executive visible capability surface.
- `brain.db` is a monthly ledger/query/replay/audit/detail store, not a prompt container.
- `Scope` is the explicit work domain. `ContextFork` is an explicit branch under a scope. `codename` is an anchor/proposal/recall boost, not a hidden context bucket.
- ASK closes uncertainty, scope promotion, fork merge conflicts, crystallization gates and long-horizon loop pauses.
- `src/socket` owns the socket vascular layer. `gateway.*` wire names remain compatibility strings only.
- HTTP stays limited to `/ws` and `/health`; `/channels` is not restored.

## Archive

[old-docs/](old-docs/) stores historical material. The files can explain past decisions but cannot define the active runtime contract.

External Rust-shell references are archived only:

- [old-docs/rust.integration.md](old-docs/rust.integration.md)
- [old-docs/rust.connection.core.md](old-docs/rust.connection.core.md)
- [old-docs/rust.gateway.shell.backlog.md](old-docs/rust.gateway.shell.backlog.md)

The 2026-05-25 documentation refresh archived the previous active docs under [old-docs/2026-05-25-docs-refresh/](old-docs/2026-05-25-docs-refresh/).

## 外部仓库参考

This heading is kept intentionally for the docs guard and for bilingual operators scanning the English index. These Rust-shell references remain external-only:

- [old-docs/rust.integration.md](old-docs/rust.integration.md)
- [old-docs/rust.connection.core.md](old-docs/rust.connection.core.md)
- [old-docs/rust.gateway.shell.backlog.md](old-docs/rust.gateway.shell.backlog.md)
