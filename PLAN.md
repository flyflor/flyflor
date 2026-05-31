# Runtime Integration Repair Plan

This repository is in a documentation-first repair phase.

After a `PLAN.md` file is written for a lane or root repair plan, agents may only:

- update task/status checkboxes;
- append dated notes, validation output, blockers, and handoff records;
- add new sections that extend the plan without rewriting or deleting previous content.

Agents must not rewrite, reorder, delete, or silently replace existing plan text after implementation begins. If the plan is wrong, append an amendment that explains what changed and why.

## Repair Loop

For each issue from `ISSUES.md`:

1. Update the relevant design document under `docs/` first.
2. Update or append the relevant `PLAN.md` section.
3. Implement one small issue or tightly-coupled group.
4. Run the documented validation command for that issue.
5. Append the result to the plan/status notes.
6. Only then move to the next issue.

## Current Direction

The immediate repair theme is runtime integration hardening:

- DI/module startup must become the real executable path.
- Signal subscriptions must be wired through shared runtime instances.
- Guard/ASK/tool contracts must become explicit and tested.
- Runtime wording and decision text should move out of TypeScript and into `prompts/*.md` plus `.zh.cn.md` mirrors.
- sqlite-vec platform probing is considered stable and should not be redesigned; only disabled-mode schema gating needs repair where schemas unconditionally create vec0 tables.

## 2026-05-31 Repair Execution Amendment

Status: in progress.

The user goal is now: complete all issue repairs, launch the service for DEBUG testing, run unit and scenario tests, update documentation, and commit. The implementation must keep docs and prompts ahead of code.

### Batch A: Documentation And Prompt Contracts

Status: in progress.

Scope:

- Update `docs/signal-di-lifecycle.md` to make DI bootstrap the executable runtime path.
- Update `docs/sandbox-guard.md` to define the exact guard payload and awaited escalation behavior.
- Update `docs/agent-worker-system.md` to require `@Subscribe("worker.spawn")`, cancellation semantics, and terminal event uniqueness.
- Update prompt protocol docs and prompt files for any runtime language currently embedded in TypeScript.

Validation:

- Documentation references must match implementation names.
- Every new runtime prompt must have `.md` and `.zh.cn.md` mirrors.

### Batch B: Runtime Wiring And Guard Boundary

Status: pending.

Scope:

- Boot `SocketServerService` through `createContainer(SocketModule)`.
- Ensure core services share `ConfigService`, `SignalBus`, `MemoryComponent`, and `BrainComponent` instances.
- Wire `SandboxGuard` onto the runtime bus.
- Standardize guard ask payloads as `{ toolName, toolInput, turnId }`.
- Block model-decider inline shell execution unless user intent and guard approval are explicit.
- Validate model-derived `projectPath` before it becomes cwd or write root.
- Enforce clarification decisions as a short-circuit final response.

Validation:

- Typecheck.
- Guard contract scenario test.
- Clarification short-circuit scenario test.
- Service startup smoke test.

### Batch C: Tool, Worker, And Signal Reliability

Status: pending.

Scope:

- Fix `GrepTool` so tests do not depend on a shell-function `rg`; use an explicit project-owned implementation or explicit executable diagnostic per docs.
- Restrict `GitTool` to truly read-only subcommands and operands.
- Connect `WorkerService` to `worker.spawn`.
- Register real worker tools.
- Add cooperative cancellation/timeout state so worker terminal events are unique and capacity is released exactly once.
- Decide and implement broadcast error semantics in `SignalBus`.
- Fix socket stop/start broadcast subscription lifecycle.

Validation:

- Worker spawn/queue/run/timeout/cancel scenario tests.
- Tool registry grep/git tests.
- SignalBus subscriber failure tests.
- WebSocket protocol lifecycle tests.

### Batch D: Memory, Scope, Crystal, And Forgetting

Status: pending.

Scope:

- Split vec0 virtual tables out of base scope/crystal schemas so `enableSqliteVec=false` works. Do not redesign sqlite-vec platform probing.
- Move `ForgettingService` background startup after DI wiring.
- Add explicit memory scan APIs for forgetting.
- Ensure destructive compaction preserves original content in brain audit or archives instead of losing it.
- Fix ASK conversation/turn correlation.
- Ensure scope confirmation matches the specific ASK/question/affirmative option.
- Remove duplicate runtime component islands in `ScopeService`.

Validation:

- Scope/crystal disabled-vector construction tests.
- Forgetting cycle tests.
- Brain audit preservation tests.
- ASK/scope correlation scenario tests.

### Batch E: Full Verification And Commit

Status: pending.

Commands:

- `bunx tsc --noEmit`
- `bun test`
- targeted scenario tests for any touched subsystem
- service startup with socket test page and DEBUG-style event observation
- `git status`
- commit with required co-author footer

Exit criteria:

- No known open P0/P1/P2 defects in `ISSUES.md`.
- All tests that are expected to run in this environment pass.
- Any external credential or environment blocker is recorded honestly in `PLAN.md`, `ISSUES.md`, and the final message.
