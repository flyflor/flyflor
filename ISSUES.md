# Flyflor Issues

## 2026-05-31 Runtime Integration Audit Backlog

**Status:** Open. This section supersedes the previously resolved review below for the current working tree.

**Method:** Whole-project read plus dynamic multi-agent review. Verified locally with `bunx tsc --noEmit` and targeted `bun test` runs.

**Current verification (2026-05-31 DI refactored):**

- `bunx tsc --noEmit` passes with zero errors.
- `bun test`: 28/28 pass (ws-services 24, signal.di.lifecycle 3, memory.vector.tree 1).
- DeepSeek provider tests require valid `DEEPSEEK_API_KEY` (expected per AGENTS.md red lines).
- `GrepTool` Bun-native implementation pending; currently requires external `rg`.

### P0 Critical

#### [critical] ~~Turn-decision model can trigger inline shell execution~~ → RESOLVED

**Status:** SandboxGuard wired into DI tree via SandboxModule→ToolModule import chain. SignalBus is shared singleton. Guard ask payloads standardized on `{ toolName, toolInput, turnId }`. Tool risk levels read from `ToolExecutionMetadata.riskLevel`.

#### [critical] ~~Worker spawn events are not wired to WorkerService~~ → RESOLVED

**Status:** `WorkerService.handleSpawn()` has `@Subscribe("worker.spawn")`. Entrypoint uses `createContainer(SocketModule)`. All services share same DI container.

### P1 High

#### [high] Runtime entrypoint bypasses DI/module bootstrap

**File:** `src/index.ts`

The executable path constructs `SocketServerService` directly instead of resolving `SocketModule` through `createContainer()`. That makes module imports/exports and `@Subscribe` lifecycle wiring non-authoritative for real startup.

**Fix direction:** Use `createContainer(SocketModule)` in the entrypoint and progressively remove hidden default object graphs from service constructors.

#### [high] Main runtime bypasses SandboxGuard entirely

**File:** `src/kernel/agent.runtime.service.ts`, `src/sandbox/sandbox.guard.service.ts`

`AgentRuntimeService` creates its own `SignalBus` and never wires `SandboxGuard` to that bus. Guard asks therefore use fallback approval/denial behavior instead of sandbox inspection, escalation, brain audit, and crystal ASK flow.

**Fix direction:** Wire `SandboxGuard` through the same runtime `SignalBus` via DI, then assert guarded tools emit `sandbox.inspected`.

#### [high] Guard ask payload contract is incompatible with SandboxGuard

**File:** `src/tools/shell.tool.ts`, `src/tools/file.tools.ts`, `src/sandbox/sandbox.guard.service.ts`

Tools emit `guard.ask` payloads shaped like `{ tool: this.name, ... }`, while `SandboxGuard` reads `payload.toolName`. If the guard is wired, `riskLevelForTool(payload.toolName)` can throw before approval or denial.

**Fix direction:** Standardize on `{ toolName, toolInput, turnId }` and test shell/write/multi_edit through a DI-wired guard.

#### [high] Untrusted model `projectPath` becomes tool cwd and write root

**File:** `src/context/context.intent.analyzer.component.ts`, `src/kernel/agent.runtime.service.ts`

The decider's `projectPath` is accepted as a string and later used as cwd/write root for inspection, shell, and editing. `resolveToolPath()` protects paths relative to cwd, but cwd itself is not validated against an approved workspace.

**Fix direction:** Canonicalize and allowlist `projectPath` before storing it on the decision. Derive `writeTargetRoot` only from a validated path.

#### [high] Clarification decisions are advisory instead of enforced

**File:** `src/kernel/agent.runtime.service.ts`, `src/context/context.builder.service.ts`

When intent says `clarify_reference` or `needsClarification`, the runtime still builds normal context and streams the answer model. The clarifying question is only rendered inside a diagnostic section and may be ignored.

**Fix direction:** Short-circuit ambiguous turns and persist/emit the clarifying question as the final assistant response. Add a regression test proving ambiguous turns never enter project/tool execution.

#### [high] ProjectPaths.join can bypass the project-root path guard

**File:** `src/shared/path.ts`

`ProjectPaths.join(relativeDir, segment)` validates only `relativeDir`, then appends an unchecked segment. A segment containing `../` can escape the project root.

**Fix direction:** Validate the combined resolved path or reject absolute/parent/separator-bearing child segments.

#### [high] GrepTool hard-requires a real `rg` binary

**File:** `src/tools/file.tools.ts`

`GrepTool` uses `Bun.spawnSync(["rg", ...])`. In this environment `rg` is a shell function, not a subprocess-visible executable, so tests fail with `Executable not found in $PATH: "rg"`.

**Fix direction:** Because project red lines forbid silent fallback execution, either require and verify a configured project-local `rg` executable with explicit diagnostics, or replace the internal tool with a Bun-native grep implementation documented as the primary path.

#### [high] Read-only GitTool can mutate repository state

**File:** `src/tools/git.tool.ts`

`GitTool` advertises `mutability: "read-only"` but allows top-level commands such as `branch` and forwards arguments directly to `git`. Some allowed forms can mutate refs or read surprising paths.

**Fix direction:** Replace top-level allowlists with per-subcommand parsers. Restrict `branch` to non-mutating forms or move mutating git operations behind explicit guards.

#### [high] Worker timeout/cancel lifecycle can leak side effects and capacity

**File:** `src/worker/worker.service.ts`

Timeout emits `worker.failed` but does not abort the in-flight model/tool loop. The timeout path can leave `activeWorkers` uncleared, and cancelled running workers can still later store memory or emit completion.

**Fix direction:** Track per-worker cancellation/abort state, release capacity exactly once, and guard all terminal side effects after timeout or cancel.

#### [high] ForgettingService can run before dependencies are injected

**File:** `src/forgetting/forgetting.service.ts`

The constructor starts periodic work while dependencies are property-injected later. Direct construction in tests proves `startCycle()` can dereference undefined `brainComponent`.

**Fix direction:** Move background startup to an explicit lifecycle hook after DI wiring, or use constructor injection consistently.

#### [high] Scope and crystal schemas require vec0 even when vector mode is disabled

**Files:** `sql/scope-schema.sql`, `sql/crystal-schema.sql`, `src/scope/scope.store.component.ts`, `src/crystal/crystal.store.component.ts`

The base SQL schemas unconditionally create vec0 virtual tables. When `enableSqliteVec=false`, the extension is not loaded, so store construction can fail.

**Fix direction:** Split base schemas from vector schemas and create vec0 tables only when vector mode is enabled. Keep the existing platform probing approach; do not rework it.

#### [high] Forgetting scans use recall ranking instead of storage scans

**File:** `src/forgetting/forgetting.service.ts`

The forgetting cycle calls `treeRecall("", ...)` to find memories to age. Empty-query recall ranking can hide ordinary low-importance chunks and stale facts, which are the exact items forgetting should process.

**Fix direction:** Add explicit memory scan APIs for forgetting, ordered by age/update time, instead of abusing recall.

#### [high] Compaction can delete memory content without guaranteed brain audit

**File:** `src/forgetting/forgetting.service.ts`, `src/memory/memory.component.ts`, `src/brain/brain.component.ts`

Compaction can call `forgetChunk()` after writing a summary. Standalone durable chunks are not guaranteed to have their original full content in `brain.db`, which violates the non-destructive brain audit red line.

**Fix direction:** Before deleting or compacting a chunk, persist original content/provenance to brain events or artifacts, or archive instead of deleting.

### P2 Medium

#### [medium] Module exports are declared but not enforced

**File:** `src/di/container.ts`

`createContainer()` registers every provider from imported modules and never consults `exports`, making module privacy misleading.

**Fix direction:** Enforce exports across module boundaries or remove the field until implemented.

#### [medium] Context checkpoint filtering can drop recent context

**File:** `src/context/context.builder.service.ts`

Recent messages covered by the latest checkpoint are filtered even when `checkpoint` is not in selected context sources, dropping both verbatim messages and the summary.

**Fix direction:** Only filter checkpoint-covered messages when the checkpoint is injected, or force checkpoint source when filtering.

#### [medium] OpenAI-compatible tool protocol is flattened

**File:** `src/kernel/model.provider.ts`

The provider sends native `tools`, but later tool messages are mapped to `user` text and do not preserve assistant `tool_calls` plus `tool_call_id` protocol.

**Fix direction:** Use provider-native tool message shapes, or explicitly switch to text-only tool evidence without native `tools`.

#### [medium] Plugin checks can have installation side effects

**File:** `src/plugins/plugin.installer.component.ts`, `src/plugins/external.command.plugin.component.ts`

Availability checks can call `ensurePlugin()`, and with `autoInstall=true` that can clone/build external plugins during startup diagnostics.

**Fix direction:** Split pure status inspection from explicit install/repair actions.

#### [medium] Plugin executable candidates can escape install directory

**File:** `src/plugins/plugin.installer.component.ts`

Executable candidate paths are joined with install path but not validated to remain inside that plugin directory.

**Fix direction:** Resolve each candidate and verify it is inside `entry.installPath` before accepting it.

#### [medium] SignalBus broadcast errors can abort unrelated subscribers

**File:** `src/signal/signal.bus.service.ts`

`emit()` awaits subscribers sequentially and lets one thrown observer abort later delivery. This is brittle for telemetry and optional systems.

**Fix direction:** Separate strict decision signals from best-effort broadcasts, or collect subscriber errors while continuing delivery.

#### [medium] WebSocket control plane lacks auth/origin protection

**File:** `src/socket/socket.server.service.ts`

`/ws` upgrades any request and accepts `chat.message` envelopes. If bound beyond loopback or proxied, remote clients can drive agent turns and potentially mutating tools.

**Fix direction:** Keep loopback as the strict default and add token/origin validation before any non-loopback use.

#### [medium] Socket broadcasts disappear after stop/start on the same service

**File:** `src/socket/socket.server.service.ts`

Runtime broadcast subscriptions are attached in the constructor and permanently unsubscribed in `stop()`. A later `start()` on the same instance does not reattach them.

**Fix direction:** Attach subscriptions idempotently in `start()` and tear them down in `stop()`.

#### [medium] ScopeService bypasses DI and creates duplicate runtime components

**File:** `src/scope/scope.service.ts`

`ScopeService` manually constructs `ScopeStore`, `MemoryComponent`, `SignalBus`, `ConfigService`, and `BrainComponent`, creating separate runtime islands.

**Fix direction:** Use DI-owned shared instances and ensure `ScopeModule` imports all required modules.

#### [medium] ASK payloads and scope confirmations lose correlation

**Files:** `src/crystal/crystal.service.ts`, `src/scope/scope.service.ts`

`CrystalService.createAsk()` emits blank `conversationId`/`turnId`. `ScopeService.onCrystalAskAnswered()` creates all pending nominations on any answered ASK without checking the ASK/question/affirmative option.

**Fix direction:** Carry conversation/turn/ask ids through the ASK lifecycle and match specific affirmative answers to specific staged nominations.

#### [medium] ConfigService mutates global process.env

**File:** `src/config/config.service.ts`

Every construction loads dotenv into global `process.env` with `override:false`, so earlier profile values can win across later isolated config instances.

**Fix direction:** Decide if this is intentional process-global behavior. If not, parse project env into instance-local config instead of mutating global env.

### P3 Low / Docs And Prompt Alignment

#### [low] Prompt protocol registry references missing prompt files

**File:** `src/prompts/prompt.registry.service.ts`, `prompts/`

Some protocol entries reference prompt files that are not present. Runtime prompt text must live in `prompts`, with `.md` plus `.zh.cn.md` mirrors.

**Fix direction:** Add the prompt files and mirrors, or remove stale registry entries. Prefer prompt-first design over embedded TypeScript text.

#### [low] Runtime prompt text and ASK rules are still embedded in TypeScript

**Files:** `src/crystal/crystal.service.ts`, nearby runtime orchestration files

Hardcoded ASK generation and user-facing protocol text violate the 0-character TypeScript direction.

**Fix direction:** Move runtime wording, ASK templates, routing instructions, and protocol text into `prompts/*.md` plus `.zh.cn.md` mirrors. TypeScript should orchestrate and validate, not author runtime language.

#### [low] Package has no stable scripts

**File:** `package.json`

There are no `test`, `typecheck`, or `serve` scripts, despite docs and workflow depending on those commands.

**Fix direction:** Add stable Bun scripts after the docs/plan bless the command names.

#### [low] Documentation drift

**Files:** `docs/context-memory-compaction.md`, `docs/scope-system.md`, `docs/crystal-system.md`, `docs/forgetting-system.md`, `docs/agent-worker-system.md`, `docs/signal-di-lifecycle.md`

Several docs describe behavior that is not implemented yet: recovery checkpoints, scope recall ownership, prompt-driven ASK generation, forgetting formula, worker spawn subscriptions, and production DI lifecycle.

**Fix direction:** Fix docs before implementation. If implementation intent changed, update docs first; otherwise implement to match docs.

---

## Previous Resolved Review

**Final Status: 4 critical fixed, 7 high fixed, 5 medium fixed, 5 low fixed. 21/21 resolved. ✅**

Review of new systems added in: `src/prompts/`, `src/worker/`, `src/sandbox/`, `src/scope/`, `src/crystal/`, `src/forgetting/`, plus changes to `src/config/`, `src/kernel/kernel.module.ts`, and `src/socket/socket.server.service.ts`.

**Verification:** TypeScript compilation 0 errors. Scenario tests 24/24 passing.

---

## [critical] WorkerService: modelProvider is always undefined, workers can never run

**File:** `src/worker/worker.service.ts`, line 42

The `WorkerService` constructor accepts `private readonly modelProvider?: ModelProvider` as an optional parameter with no default value. The project's DI pattern uses constructor parameter defaults (`new Xxx()`) for dependency instantiation. Since `ModelProvider` has no default and no registered DI provider exists, `this.modelProvider` is always `undefined`. The guard at line 140-143 catches this and emits `worker.failed`, but no worker can ever execute a real model call.

**Recommendation:** Either instantiate a `ModelProvider` internally (as `AgentRuntimeService` does via `createModelProvider()`) or register `ModelProvider` as an injectable provider in the DI container and inject it via `@Inject`.

---

## [critical] CrystalService: chat.message signal is emitted without `role`, answer detection never fires

**File:** `src/kernel/agent.runtime.service.ts`, line 119 and `src/crystal/crystal.service.ts`, lines 211-215

`AgentRuntimeService.runTurn()` emits `chat.message` with `{ conversationId, turnId, content }` -- no `role` field. But `CrystalService.onChatMessage` defines its payload type as `ChatMessagePayload` with `role: string` and checks `if (payload.role !== "user" || ...) { return; }`. Since `role` is always `undefined`, the check `undefined !== "user"` is always `true`, and the handler returns immediately. Crystal ASK answers can never be detected from user chat messages, breaking the entire ASK-answer lifecycle.

**Recommendation:** Add `role: "user"` to the `chat.message` emission in `AgentRuntimeService.runTurn()` at line 119. Update `AgentTurnInput` or the inline object to include it.

---

## [critical] WorkerService: failed workers are overwritten to "completed" in the finally block

**File:** `src/worker/worker.service.ts`, lines 224-234

In `runWorker()`, the `catch` block calls `completeWorkerWithError()` which sets the record status to `"failed"` (line 394-399). However, the `finally` block (lines 225-234) runs AFTER the catch and unconditionally sets `status: "completed"` via `this.records.set(...)`. This means every failed worker is recorded as `"completed"`, making it impossible to distinguish failed workers from successful ones in the records map.

**Recommendation:** Track the error state with a local flag (`let failed = false`) and set the final status conditionally: `status: failed ? "failed" : "completed"`.

---

## [critical] ScopeService.onCrystalAskAnswered is a no-op; scopes can never be created through crystal confirmation

**File:** `src/scope/scope.service.ts`, lines 182-194

The method subscribes to `crystal.ask.answered` with the intent of creating scope records when the user confirms, but the method body only validates `payload.selectedOptionId` and `payload.questionId` without actually creating a scope. The comment says "scope creation data should have been staged by a prior nomination flow" but no staging or creation logic exists anywhere in `ScopeService`. The scope creation flow is dead code.

**Recommendation:** Implement the actual scope creation logic: call `this.scopeStore.createScope()` with staged input data, emit `scope.created`, and store the record in memory.db. Stage candidate data in `nominateCandidate()` or a new staging mechanism.

---

## [high] Missing SQL schema files: scope-schema.sql and crystal-schema.sql

**Files:** `src/scope/scope.store.component.ts`, line 60 and `src/crystal/crystal.store.component.ts`, line 83

`ScopeStore.initialize()` calls `readFileSync(this.configService.resolve("./sql/scope-schema.sql"), "utf8")`. `CrystalStore.initialize()` calls `readFileSync(this.configService.resolve("./sql/crystal-schema.sql"), "utf8")`. These SQL files do not exist in the repository. Both stores will throw on construction, making `ScopeModule` and `CrystalModule` unusable at runtime.

**Recommendation:** Create `sql/scope-schema.sql` with CREATE TABLE statements for `scopes`, `scope_vectors`, and `scope_mirrors`. Create `sql/crystal-schema.sql` with CREATE TABLE statements for `crystal_candidates`, `crystal_gems`, `crystal_ask_log`, and `crystal_vectors`.

---

## [high] ForgettingService.startPeriodicCycle is never called

**File:** `src/forgetting/forgetting.service.ts`, lines 113-124

`startPeriodicCycle()` is a public method but is never called from the constructor or any lifecycle hook. The `ForgettingModule` only registers and exports `ForgettingService` -- nothing invokes the timer start. Without calling it, the periodic forgetting cycle (hourly Ebbinghaus decay sweeps) will never run automatically. The only way a cycle triggers is via the `context.compacted` debounce hook.

**Recommendation:** Call `startPeriodicCycle()` from the `ForgettingService` constructor, or from a `@Subscribe('startup')` handler, or provide a `start()` lifecycle method that the kernel calls during bootstrap.

---

## [high] WorkerService.streamWorkerStep discards actual tool schema

**File:** `src/worker/worker.service.ts`, lines 315-319

When building the model-facing tool definitions for the worker, the code discards the actual `tool.schema` from `WorkerToolDefinition` and replaces it with:
```
schema: { type: "object" as const, properties: {}, additionalProperties: true }
```
This means the model provider never sees the real JSON schema for each tool. The model cannot validate or correctly structure its tool call inputs, leading to malformed inputs and poor tool-calling accuracy.

**Recommendation:** Pass through `tool.schema` from the `WorkerToolDefinition` instead of replacing it with an empty stub. If the schema needs normalization, do that transformation rather than discarding it.

---

## [high] CrystalStore constructor always loads sqlite-vec, ignoring the enableSqliteVec config flag

**File:** `src/crystal/crystal.store.component.ts`, lines 59-69

`ScopeStore` correctly checks `config.memory.enableSqliteVec` before loading sqlite-vec. `CrystalStore` does NOT check this flag -- it always calls `this.sqliteVecLoader.prepare()` and `this.sqliteVecLoader.load(this.db)`, then hardcodes `this.vectorEnabled = true`. If a user sets `enableSqliteVec: false`, crystal.db initialization will still attempt to load the extension, potentially crashing.

**Recommendation:** Add the same `config.memory.enableSqliteVec` guard that `ScopeStore` and `MemoryComponent` use: conditionally call `prepare()` and `load()`, and set `vectorEnabled` from the config value.

---

## [high] No brain audit coverage for sandbox, scope, crystal, and forgetting systems

**Files:** `src/sandbox/sandbox.guard.service.ts`, `src/scope/scope.service.ts`, `src/crystal/crystal.service.ts`, `src/forgetting/forgetting.service.ts`

AGENTS.md requires brain audit to "store all visible conversation content, socket events, tool events, model deltas, visible reasoning summaries, sub-agent handoff logs, recovery records, and artifact references." The new systems have little to no brain audit coverage:

- **SandboxGuard**: Stores outcomes as `MemoryFacts` but does not record `brain.db` events for inspections, approvals, denials, or escalations.
- **ScopeService**: No `brainComponent.recordEvent()` calls for scope detection, activation, deactivation, candidate nomination, or creation.
- **CrystalService**: No brain audit for ASK creation, candidate formation, gem elevation, EQ adjustments, or ask-answer logging.
- **ForgettingService**: No brain audit for cycle start/completion, chunk compaction, fact aging, or gem drift. Only memory.db recovery state is written.
- **WorkerService**: Records `worker.completed` to brain but not `worker.started`, `worker.failed`, or `worker.queued`.

**Recommendation:** Add `brainComponent.recordEvent()` calls for each lifecycle event in all new systems. Each system should inject `BrainComponent` (or receive it via DI) and record structured audit events for every significant state transition.

---

## [high] WorkerService has no timeout enforcement

**File:** `src/worker/worker.service.ts`

The config defines `agents.defaults.timeoutSeconds` (default 300 seconds), but `runWorker()` has no timeout mechanism. A hung model call or infinite tool loop would block the worker indefinitely, consuming one of the limited concurrency slots and preventing queue drain. The `finally` block decrements `activeWorkers` only when `runWorker` naturally completes or throws.

**Recommendation:** Add a `setTimeout`-based watchdog in `runWorker()` that calls `completeWorkerWithError` if the worker exceeds `timeoutSeconds`. Clear the timeout in the `finally` block.

---

## [high] WorkerService passes a dummy stub as artifactWriter in tool context

**File:** `src/worker/worker.service.ts`, line 368

`executeWorkerTool()` constructs the `ToolContext` with:
```
artifactWriter: { write: () => "" } as unknown as ToolContext["artifactWriter"]
```
This is a stub that silently swallows artifact writes. If a worker tool needs to produce artifacts (e.g., shell output capture, file diffs), they will be lost. Unlike the main `AgentRuntimeService` which creates a real `ArtifactWriterComponent`, workers get a no-op.

**Recommendation:** Either inject a real `ArtifactWriterComponent` into `WorkerService` and use it in the context, or accept the stub but document clearly that worker tools cannot produce persistent artifacts.

---

## [medium] config.jsonc is missing newly-added config path fields

**File:** `.config/config.jsonc`

`ConfigPaths` now includes `scopeDir` and `crystalDb` (added to `config.types.ts`). The actual `.config/config.jsonc` file does not include these fields in the `paths` section. While `applyConfigDefaults()` fills them with safe defaults (`./.config/scope` and `./.config/crystal/crystal.db`), committed config should be the single source of truth for all configurable paths per AGENTS.md Config Red Lines.

**Recommendation:** Add `"scopeDir": "./.config/scope"` and `"crystalDb": "./.config/crystal/crystal.db"` to the `paths` section of `.config/config.jsonc`.

---

## [medium] Prompt files referenced by listProtocols may not exist on disk

**File:** `src/prompts/prompt.registry.service.ts`, lines 73-89

`listProtocols()` references 13 prompt files (e.g., `./prompts/agent-explore.md`, `./prompts/crystal-gem-summarize.md`, `./prompts/forgetting-compact.md`, etc.). If any of these files do not exist, `load()` will throw a `readFileSync` error at runtime. The agent profile configs in `.config/config.jsonc` also reference some of these paths, so the system will crash on first worker spawn if prompts are missing.

**Recommendation:** Create all required `.md` prompt files (and their `.zh.cn.md` mirrors) under `prompts/`, or add graceful error handling in `load()` that catches missing prompts at load time rather than at first use.

---

## [medium] ScopeService.findRecentChunkId opens a new read-only Database connection per call

**File:** `src/scope/scope.service.ts`, lines 343-358

Each call to `findRecentChunkId` creates a `new Database(memoryDbPath, { readonly: true })`. When scope-tagged memory chunks are stored rapidly (e.g., during a conversation with many memory stores), this creates many short-lived connections to the same database. The overhead is unnecessary since `MemoryComponent` already holds a long-lived connection.

**Recommendation:** Accept a `MemoryComponent` reference and query its internal DB connection directly, or add a method to `MemoryComponent` that returns the most recent chunk ID for given source criteria.

---

## [medium] Tool schema cast in resolveWorkerTools is unsafe

**File:** `src/worker/worker.service.ts`, lines 279-285

`resolveWorkerTools()` maps tool definitions with: `schema: tool.schema as unknown as Record<string, unknown>`. The `ToolDefinition.schema` property may not be a `Record<string, unknown>` (it could be an array schema, a union, or a string). While the downstream `streamWorkerStep` currently discards it anyway (see [high] issue above), if that passthrough is fixed the cast should be validated.

**Recommendation:** Add a runtime guard: `typeof tool.schema === 'object' && !Array.isArray(tool.schema)` before casting, and provide a safe fallback schema.

---

## [medium] ForgettingService uses fixed scan limits that may miss items

**Files:** `src/forgetting/forgetting.service.ts`, lines 43-46

`MAX_CHUNK_SCAN = 500` and `MAX_FACT_SCAN = 500` are fixed limits. If memory.db accumulates more than 500 chunks or facts, the `treeRecall("", limit, ...)` call will cap results at 500, meaning older items beyond that boundary are never scanned for Ebbinghaus decay. Over long-running sessions, chunks and facts beyond the scan limit accumulate without being faded, aged, or compacted.

**Recommendation:** Use pagination or iteration over all items, or increase scan limits to match expected data volumes. Consider a cursor-based approach that remembers the last-scanned row and continues from that point across cycles.

---

## [low] Duplicate ChatMessagePayload interfaces across CrystalService and ScopeService

**Files:** `src/crystal/crystal.service.ts`, lines 47-52 and `src/scope/scope.service.ts`, lines 24-28

Both `CrystalService` and `ScopeService` define their own `ChatMessagePayload` interface, with different shapes (`CrystalService` includes `role`, `ScopeService` does not). This should be a single shared type to prevent drift.

**Recommendation:** Extract `ChatMessagePayload` to a shared location (e.g., `src/signal/signal.types.ts`) and import it consistently.

---

## [low] CrystalService.elevateToGem misses `await` on signalBus.emit

**File:** `src/crystal/crystal.service.ts`, line 422

`this.signalBus.emit("crystal.gem.elevated", gem)` is called without `await` or `void`, leaving a floating Promise. Other signal emissions in the same file consistently use `await`. If the signal emission has side effects (e.g., persisting to memory or brain), they may race with subsequent code.

**Recommendation:** Add `await` (or `void`) for consistency: `await this.signalBus.emit("crystal.gem.elevated", gem)`.

---

## [low] PromptRegistryService.listProtocols is hardcoded; new prompts require code changes

**File:** `src/prompts/prompt.registry.service.ts`, lines 73-89

The protocol list is a hardcoded array of 13 protocol entries. Adding a new prompt file requires updating this method. There is no file-system-based discovery mechanism to pick up new prompt files automatically.

**Recommendation:** Consider scanning the `prompts/` directory at startup to discover `.md` files (excluding `.zh.cn.md` mirrors) and deriving protocol entries from a convention. Keep the hardcoded list as the canonical source if manual registration is preferred for safety.

---

## [low] ScopeService.nominateCandidate emits signal without await/void

**File:** `src/scope/scope.service.ts`, line 294

`this.signalBus.emit("scope.candidate.nominated", payload)` is called in a synchronous method without `await` or `void`. The returned Promise is unhandled, which could mask errors in the signal pipeline.

**Recommendation:** Either make `nominateCandidate` async and `await` the emit, or prefix with `void`.

---

## [low] WorkerService: hardcoded budget of 4000 outputChars for worker tools vs. 8000 for main agent

**File:** `src/worker/worker.service.ts`, line 370 and `src/kernel/agent.runtime.service.ts`, line 307

The main `AgentRuntimeService` uses `budget: { outputChars: 8000 }` in its `ToolContext`. Workers get only `budget: { outputChars: 4000 }`. This asymmetry is not documented or configurable. It may cause worker tool outputs to be silently truncated at half the main agent's budget.

**Recommendation:** Make the worker budget configurable (e.g., in `agents.defaults`) and document the rationale for the differing budget.

---

## [low] SandboxGuard.autoApproveGuards getter could throw if DI not yet wired

**File:** `src/sandbox/sandbox.guard.service.ts`, lines 52-54

The `autoApproveGuards` getter accesses `this.configService.getConfig().runtime.autoApproveGuards`. Since `configService` is injected via `@Inject(ConfigService)` property injection, there is a window after construction but before DI wiring when accessing this getter would throw `TypeError: Cannot read properties of undefined`. While unlikely in practice (subscription handlers run after DI wiring), it is a latent risk.

**Recommendation:** Add a null guard: `return this.configService?.getConfig()?.runtime?.autoApproveGuards ?? true;` or ensure the container wires `@Inject` properties before any signal subscriptions are activated.
