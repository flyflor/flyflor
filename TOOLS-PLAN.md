# TOOLS-PLAN

Status: planned architecture only. The execution layer described here is not implemented yet.

This document supersedes the previous tool-runtime plan. The old design over-split the execution layer into
`ToolRegistry`, `ToolOrchestrator`, `PermissionService`, `ProcessSessionService`, `PatchService`, and a new
`src/tool` domain. Flyflor should not grow a generic tool platform first. It should grow a brain reflection loop
first.

## Core Mental Model

Flyflor is being built as an intelligent life-like runtime, not as a bag of agent utilities.

The current directory model already implies the correct design:

```txt
IPC / Socket stimulus
  -> Synapse
  -> Agent
  -> Brain
  -> Reflection
      -> model signal
      -> tool impulse
      -> confirm interrupt
      -> child-agent investigation
      -> tool result signal
      -> continued thought
  -> Agent outward signal
  -> Socket / IPC
```

Object meanings:

- `Brain` is the turn owner. It owns context assembly, reflection startup, successful context commit, and rollback on
  failure or cancellation.
- `Reflection` is one neural reflex arc inside the brain. It is the execution layer for a single turn.
- `Synapse` routes external stimulus into the active agent.
- `Socket` and `IPC` are the outer signal boundary. They transmit signals and do not own interaction semantics.
- `PacketService` owns byte framing only: 8-byte big-endian length-prefixed JSON.
- `FTool` objects are action endpoints that a reflection may trigger.
- `task` is multi-agent cognition. It spawns multiple `src/agent` instances for parallel investigation and synthesis.

Important naming rule:

- `confirm` means permission confirmation for an action.
- `ask` means future cognitive questioning when the agent needs missing information.
- Permission must never be modeled as `ask`.

## Current Repository Reality

Existing strengths:

- IOC construction is already centralized in `src/core/ioc/container.ts`.
- Prompt files are already path-bound `FileService` objects.
- Prompt protocol blocks are already parsed as `<flyflor:xxx>` JSONC blocks.
- `Brain.transformer()` already preserves the invariant that context is committed only after successful completion.
- `FSocket` already scopes streamed output to the requesting socket and appends `streamEnd`.
- `src/plugins/tools` already exists as an intended kernel tool area, but its files are currently empty.
- Root `./plugins` already exists with placeholder directories for external capabilities.

Current gaps:

- `IntelligenceTurn` is text-only.
- `Brain` has no reflection loop.
- `Agent` outward signals are text-only.
- `SocketEvent` does not yet include tool, confirm, task, or cancel signals.
- There is no `FTool` scope.
- There is no external plugin bridge.
- `task` is currently only prompt intent, not a runtime multi-agent operation.
- `rtk` and `codegraph` are not installed or bridged through `./plugins`.

## Execution Layer Target

First target:

- Add a `Reflection` object under `src/agent/brain/reflection.ts`.
- Upgrade `Intelligence` to produce structured model events while keeping text compatibility.
- Add `FTool` and `@Tool()` as minimal core scope additions.
- Implement built-in read/write/exec tools as `FTool` objects under `src/plugins/tools`.
- Add `confirm` interruptions for write/execute actions.
- Implement `task` as foreground multi-agent read-only investigation.
- Add a small external plugin bridge for `./plugins/rtk` and `./plugins/codegraph`.

Non-goals for the first implementation:

- Do not create `src/tool`.
- Do not add `ToolRegistry`, `ToolOrchestrator`, `PermissionService`, `ProcessSessionService`, or `PatchService`.
- Do not implement generic MCP.
- Do not implement browser-use or computer-use.
- Do not allow child agents to write files.
- Do not implement background subagents.
- Do not implement `ask`.
- Do not compile external plugin scripts or binaries into the Flyflor Bun binary.

## Reflection Design

`Reflection` is created per turn by `Brain`.

Responsibilities:

- Build model input from the system prompt, existing context, and current user content.
- Expose model-visible tool schemas for the current turn.
- Consume structured `Intelligence` events.
- Stream text deltas outward immediately.
- Execute tool calls.
- Pause on `confirm` when an action needs permission.
- Resume after inbound confirm resolution.
- Append tool results to the ongoing model turn.
- Spawn child agents through the `task` tool.
- Cancel provider streams, tools, and child agents when the parent turn is cancelled.
- Return the final assistant text to `Brain` so `Brain` can commit context.

Internal event vocabulary:

- `turnStart`
- `modelTextDelta`
- `modelToolCall`
- `toolStart`
- `toolDelta`
- `toolEnd`
- `toolError`
- `confirmRequested`
- `confirmResolved`
- `taskStart`
- `taskAgentStart`
- `taskAgentEnd`
- `taskEnd`
- `turnEnd`
- `turnError`
- `turnCancelled`

Implementation style:

- Use RxJS for the turn event stream.
- Keep all turn-local state inside `Reflection`.
- Keep long-lived agent context ownership in `Brain`.
- Keep socket transport ownership in `neural/ipc`.
- Do not let tools mutate `Brain.context` directly.

## Intelligence Events

`Intelligence` should evolve from `ReadableStream<string>` to a structured event stream.

Required event shape:

```ts
type IntelligenceEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'tool_call'; id: string; name: string; input: unknown }
    | { type: 'assistant_finish'; reason?: string }
    | { type: 'error'; error: Error };
```

Compatibility requirements:

- `Brain.transformer()` remains `AsyncGenerator<string>` for existing callers.
- `Intelligence.complete()` remains available and joins `text_delta` events.
- Text-only providers continue to pass existing tests.
- Providers without tool-call support can remain text-only until upgraded.

First provider targets:

- `openaiResponses`
- `anthropicMessages`

Later provider targets:

- `openaiChatCompletions`
- `googleGeminiGenerateContent`
- `ollama`
- other adapters only when their tool-call wire shape is implemented.

## Agent Signals And IPC

`Agent` currently emits strings through `FAgent<string>`. Reflection needs structured outward signals while preserving old
text streaming behavior.

Target signal union:

```ts
type AgentSignal =
    | string
    | { type: 'text'; data: string }
    | { type: 'tool'; action: SocketEvent; data: unknown }
    | { type: 'confirm'; action: SocketEvent; data: unknown }
    | { type: 'task'; action: SocketEvent; data: unknown };
```

Socket compatibility:

- If the signal is a string, write `{ action: SocketEvent.Data, data: signal }`.
- If the signal is `{ type: 'text' }`, write `{ action: SocketEvent.Data, data: signal.data }`.
- If the signal is structured, write the included action and data.
- `streamEnd` is still written by `FSocket` after `Synapse.next()` completes.

New outbound socket events:

- `toolStart`
- `toolDelta`
- `toolEnd`
- `toolError`
- `confirmRequested`
- `confirmResolved`
- `taskStart`
- `taskAgentStart`
- `taskAgentEnd`
- `taskEnd`
- `turnEnd`

New inbound socket events:

- `confirm`
- `cancel`

Inbound `confirm` payload:

```ts
{
    id: string;
    confirmed: boolean;
    remember?: 'turn' | 'session';
}
```

Inbound `cancel` payload:

```ts
{
    turnId?: string;
    toolCallId?: string;
    taskId?: string;
    agentId?: string;
}
```

Socket and IPC do not interpret those payloads. They route them back to `Synapse`, then to the active `Agent` / `Brain`.

## Confirm Semantics

First implementation only supports action confirmation.

States:

- `none`: no confirmation required.
- `required`: reflection must pause and emit `confirmRequested`.
- `confirmed`: external side permitted the action.
- `rejected`: external side denied the action.

Default rules:

- Read tools do not require confirm.
- Write tools require confirm.
- Execute tools require confirm.
- Dangerous tools require confirm.
- Child agents are read-only in v1, so they cannot request confirm for write/execute tools.
- Confirm allowlists only affect permission confirmation.
- Confirm allowlists are not `ask`.

Reserved future meaning of `ask`:

- missing requirement details;
- missing user preference;
- missing external fact;
- ambiguous task intent;
- not permission.

## Built-In Tools

Built-in tools live under `src/plugins/tools` as `FTool` objects.

Minimal tool shape:

```ts
interface FToolDefinition {
    name: string;
    description: string;
    inputSchema: unknown;
    level: 'read' | 'write' | 'execute' | 'dangerous';
    confirm: 'none' | 'required';
}
```

Each tool object should expose an execute method that receives reflection context and validated input.

First built-in tools:

- `read_file`
  - read UTF-8 text inside the workspace boundary;
  - no confirm.
- `glob`
  - list files matching a pattern inside the workspace boundary;
  - no confirm.
- `grep`
  - search file contents inside the workspace boundary;
  - no confirm.
- `apply_patch`
  - structured patch application;
  - confirm required.
- `exec_command`
  - bounded process execution;
  - confirm required by default;
  - can return a session id for long-running commands.
- `write_stdin`
  - write to an existing process session;
  - confirm required.
- `todo`
  - turn-local progress state;
  - no long-term memory writes in v1.
- `task`
  - multi-agent investigation;
  - child agents are read-only in v1.

Implementation constraint:

- Tool discovery should be explicit in v1. `PluginsModule` imports the built-in tool classes. Avoid adding broad dynamic
  discovery until the object model needs it.

## Task Multi-Agent Design

`task` is the most important tool for Flyflor's coding ability. It is not a generic background task helper.

Purpose:

- Spawn multiple `Agent` instances for parallel investigation.
- Improve summarization, code archaeology, impact analysis, and patch planning.
- Let the master agent keep final write ownership.

V1 behavior:

- Foreground only.
- Read-only children only.
- No recursive `task`.
- No child memory writes.
- No child user interaction.
- No child confirm.
- No direct file edits from children.
- Parent turn cancellation cancels running child agents.

Task input:

```ts
{
    description: string;
    prompt: string;
    agents: Array<{
        label?: string;
        profile?: string;
        focus: string;
        expectedOutput?: string;
    }>;
    timeoutMs?: number;
    context?: string;
}
```

Scheduling:

- Default child concurrency: 3.
- Hard v1 child concurrency: 5.
- Default timeout per child: 120000 ms.
- Max timeout per child: 600000 ms.
- A single failed child produces `partial`.
- All children failed produces `failed`.
- Results are returned in the order requested, not in completion order.

Child agent setup:

- Construct each child through IOC.
- Give each child an isolated `Brain.context`.
- Inherit the parent agent's constitution prompt.
- Append task-specific instructions that enforce read-only investigation.
- Provide only read tools plus CodeGraph read tools.
- Do not expose `apply_patch`, write tools, arbitrary execute tools, `todo`, or `task`.

Required child output contract:

```txt
SUMMARY:
EVIDENCE:
PATCH_SUGGESTION:
RISKS:
BLOCKERS:
```

Parent task result:

```ts
{
    taskId: string;
    status: 'completed' | 'partial' | 'failed' | 'cancelled';
    children: Array<{
        agentId: string;
        label: string;
        status: string;
        summary: string;
        evidence: string[];
        patchSuggestion?: string;
        risks: string[];
        blockers: string[];
    }>;
    synthesis: string;
}
```

The parent `Reflection` receives the task result as a tool result. The parent model decides how to synthesize, what to
verify, and whether to perform a write action after confirm.

## External Plugin Layer

Root `./plugins` is the external organ layer. It is separate from `src/plugins`.

Goals:

- Support binary or multi-language external capabilities without compiling them into Flyflor.
- Keep third-party installation and runtime scripts outside `src`.
- Prepare for future tools such as Scrapling, browser-use, and computer-use.
- Make plugin communication deterministic through stdio JSONL.

Directory contract:

```txt
plugins/
  rtk/
    plugin.json
    install.ts
    bridge.ts
    bin/
    cache/
  codegraph/
    plugin.json
    install.ts
    bridge.ts
    bin/
    cache/
```

Rules:

- `bridge.ts` is run with Bun from the plugin directory.
- `bridge.ts` is not imported by `src`.
- `bridge.ts` is not compiled into the Flyflor binary.
- `bin/` holds local downloaded executables and should not be committed.
- `cache/` holds local plugin state and should not be committed.
- Bridge stdout is JSONL protocol only.
- Bridge logs go to stderr.
- Missing binaries return typed errors.
- Install scripts are only run by explicit user action, never by autonomous model tool call.

Minimal manifest:

```json
{
  "name": "codegraph",
  "version": 1,
  "runtime": {
    "kind": "bun-stdio",
    "entry": "./bridge.ts"
  },
  "install": {
    "entry": "./install.ts"
  },
  "tools": [
    {
      "name": "codegraph_search",
      "level": "read",
      "confirm": "none"
    }
  ]
}
```

Kernel side:

- Add a small `PluginsService extends FPlugin` under `src/plugins/service.ts`.
- It reads `./plugins/*/plugin.json`.
- It starts and reuses bridge processes.
- It translates bridge tools into reflection-visible tools.
- It is not a general `ToolRegistry`.

## Plugin Bridge Protocol

Communication uses JSONL over stdio.

Request types:

```ts
type PluginRequest =
    | { id: string; type: 'handshake'; cwd: string; workspaceRoot: string }
    | { id: string; type: 'tools' }
    | { id: string; type: 'call'; tool: string; input: unknown; cwd: string; signal?: { timeoutMs?: number } }
    | { id: string; type: 'cancel'; callId: string };
```

Response types:

```ts
type PluginResponse =
    | { id: string; type: 'ready'; name: string; tools: PluginToolSpec[] }
    | {
          id: string;
          type: 'result';
          status: 'completed' | 'error' | 'cancelled';
          content: string;
          data?: unknown;
          truncated?: boolean;
          metadata?: unknown;
      }
    | { id: string; type: 'delta'; content: string; metadata?: unknown }
    | { id: string; type: 'error'; message: string; code?: string; detail?: unknown };
```

Protocol rules:

- Every response preserves the request id.
- Invalid stdout lines are protocol errors.
- Stderr is log output, not protocol.
- Calls have timeout.
- Cancel sends `cancel`; if the plugin cannot stop the call, the host may kill the bridge.
- Bridge startup does `handshake` before any tool call.

## RTK Plugin

Upstream: `https://github.com/rtk-ai/rtk`

Purpose:

- Compress, filter, and structure noisy command output.
- Improve coding loops around tests, search, git output, logs, and build output.
- Act as an execution-output enhancer, not a permission bypass.

V1 tools:

- `rtk_command`
  - level: `execute`
  - confirm: `required`
  - input: command, cwd, timeoutMs
  - behavior: run the requested command through RTK and return compact output.
- `rtk_gain`
  - level: `read`
  - confirm: `none`
  - behavior: return RTK savings/usage stats when available.
- `rtk_discover`
  - level: `read`
  - confirm: `none`
  - behavior: report commands that RTK can optimize.

Integration with `exec_command`:

- Do not force every command through RTK.
- Prefer RTK for noisy, bounded commands such as tests, type checks, `git diff`, `git status`, search, and logs.
- Preserve the original command's permission classification before wrapping.
- Wrapping never lowers confirm requirements.

Install behavior:

- `plugins/rtk/install.ts` downloads a matching release or package for the current OS/arch.
- The executable is stored under `plugins/rtk/bin/`.
- The installer verifies with `rtk --version`.
- Do not run global shell-hook setup such as modifying other agent configurations.

## CodeGraph Plugin

Upstream: `https://github.com/colbymchenry/codegraph`

Purpose:

- Provide fast local codebase graph investigation.
- Improve summarization, impact analysis, and multi-agent research.
- Reduce blind `grep` / `read_file` exploration.

Important behavior:

- CodeGraph creates local workspace graph state under `.codegraph/`.
- Its MCP server exists, but v1 Flyflor should use the CLI bridge first.
- MCP integration can come later after Flyflor has a generic MCP bridge.

V1 tools:

- `codegraph_status`
  - level: `read`
  - confirm: `none`
  - behavior: inspect graph/index health.
- `codegraph_init`
  - level: `execute`
  - confirm: `required`
  - behavior: initialize CodeGraph for the workspace.
- `codegraph_sync`
  - level: `execute`
  - confirm: `required`
  - behavior: sync/update the local graph.
- `codegraph_search`
  - level: `read`
  - confirm: `none`
  - behavior: semantic or symbol-oriented search.
- `codegraph_context`
  - level: `read`
  - confirm: `none`
  - behavior: gather task-specific code context.
- `codegraph_callers`
  - level: `read`
  - confirm: `none`
  - behavior: inspect callers of a symbol.
- `codegraph_callees`
  - level: `read`
  - confirm: `none`
  - behavior: inspect callees of a symbol.
- `codegraph_impact`
  - level: `read`
  - confirm: `none`
  - behavior: estimate change impact.

Default rules:

- If `.codegraph/` does not exist, read tools return `not_initialized` with a suggested next action.
- Do not auto-initialize.
- `codegraph_init` and `codegraph_sync` require confirm and a workspace-level lock.
- Child agents can use read-only CodeGraph tools.
- Child agents cannot run init or sync.
- Parallel child-agent read queries are allowed.

## Prompt Blocks

Use existing `FileService.blocks`; do not add a new prompt parser.

Tools block:

```md
<flyflor:tools>
{
    version: 1,
    allowed: [
        "read_file",
        "glob",
        "grep",
        "apply_patch",
        "exec_command",
        "write_stdin",
        "todo",
        "task",
        "rtk_command",
        "rtk_gain",
        "rtk_discover",
        "codegraph_status",
        "codegraph_search",
        "codegraph_context",
        "codegraph_callers",
        "codegraph_callees",
        "codegraph_impact"
    ],
    confirmAlways: ["apply_patch", "exec_command", "write_stdin", "rtk_command", "codegraph_init", "codegraph_sync"]
}
</flyflor:tools>
```

Reflection block:

```md
<flyflor:reflection>
{
    version: 1,
    maxToolCalls: 32,
    maxTaskAgents: 3,
    taskTimeoutMs: 120000
}
</flyflor:reflection>
```

Defaults:

- Without blocks, enable built-in read tools only.
- `task` can be enabled by default only in read-only child mode.
- Write and execute tools require confirm.
- Plugin install and plugin mutation actions require confirm.

## Implementation Phases

Each phase should be small enough to review and verify independently.

### Phase 1: Plan Docs

- Rewrite `TOOLS-PLAN.md`.
- Add or sync `TOOLS-PLAN.zh.cn.md`.
- Do not change runtime code.

Verification:

- `bun run check`

### Phase 2: Core Reflection Types

- Add `FTool`.
- Add `@Tool()`.
- Add `AgentSignal`.
- Add reflection event and tool definition types.
- Do not connect real tools yet.

Verification:

- `bun run check`
- focused type-checking through `bunx tsc --noEmit`

### Phase 3: Brain Reflection Shell

- Add `src/agent/brain/reflection.ts`.
- Route text-only model output through `Reflection`.
- Preserve `Brain.transformer()` external behavior.
- Preserve successful-only context commit.

Verification:

- existing `brain.test.ts`
- existing `socket.test.ts`

### Phase 4: Structured Intelligence Events

- Add `text_delta` and `assistant_finish` event support.
- Keep `complete()` compatibility.
- Keep text-only adapters working.
- Do not enable tool calls yet.

Verification:

- existing `intelligence.test.ts`

### Phase 5: Built-In Read Tools

- Implement `read_file`.
- Implement `glob`.
- Implement `grep`.
- Expose schemas to `Reflection`.
- Feed tool results back into the model turn.

Verification:

- path escape rejection;
- read tools require no confirm;
- tool result appears in the next model request.

### Phase 6: Confirm

- Add `confirmRequested` and `confirmResolved` signals.
- Add inbound `confirm` routing.
- Pause reflection while waiting.
- Resume or reject the tool call after confirm.
- Do not use `ask`.

Verification:

- confirmed calls execute;
- rejected calls do not execute;
- cancellation releases pending confirm;
- tests assert no permission path emits `ask`.

### Phase 7: Write And Exec Tools

- Implement `apply_patch`.
- Implement `exec_command`.
- Implement `write_stdin`.
- Add timeout, truncation, cancellation, and process session ids.
- Write and execute tools require confirm.

Verification:

- patch context mismatch rejection;
- shell timeout handling;
- stdin to existing session;
- confirm required by default.

### Phase 8: Task Tool V1

- Implement foreground `task`.
- Spawn multiple child `Agent` instances through IOC.
- Give each child isolated context and read-only tools.
- Collect structured reports.
- Return deterministic ordered synthesis to parent reflection.

Verification:

- child context isolation;
- child cannot write;
- partial result when one child fails;
- parent cancellation cancels children.

### Phase 9: External Plugin Bridge

- Add `src/plugins/types.ts`.
- Add `src/plugins/service.ts`.
- Load `./plugins/*/plugin.json`.
- Start `bun bridge.ts`.
- Implement JSONL handshake, tools, call, cancel.
- Convert plugin responses into reflection tool events.

Verification:

- fake plugin bridge tests;
- invalid JSONL handling;
- timeout and cancel;
- stderr does not affect protocol.

### Phase 10: RTK Plugin

- Add `plugins/rtk/plugin.json`.
- Add `plugins/rtk/install.ts`.
- Add `plugins/rtk/bridge.ts`.
- Implement `rtk_command`, `rtk_gain`, `rtk_discover`.
- Optionally let `exec_command` choose RTK wrapping for noisy commands.

Verification:

- missing binary typed error;
- `rtk_command` requires confirm;
- `rtk_gain` requires no confirm;
- RTK wrapping does not lower permission classification.

### Phase 11: CodeGraph Plugin

- Add `plugins/codegraph/plugin.json`.
- Add `plugins/codegraph/install.ts`.
- Add `plugins/codegraph/bridge.ts`.
- Implement status, init, sync, search, context, callers, callees, impact.
- Make CodeGraph read tools available to task children.
- Keep init/sync parent-only.

Verification:

- no `.codegraph/` returns `not_initialized`;
- init/sync require confirm;
- child agents cannot init/sync;
- parallel read queries are stable.

### Phase 12: Docs And Mirror Cleanup

- Update architecture docs only after code exists.
- Keep all `.md` mirrors paired.
- Ensure runtime never reads `.zh.cn.md`.

Verification:

- `bun run check`

## Test Plan

Minimum focused coverage:

- `Brain` text compatibility and context commit/rollback.
- `Reflection` text, tool, confirm, cancel, error, and task paths.
- `Intelligence` structured events for supported providers.
- `Socket` compatibility for `data` and `streamEnd`.
- `Socket` structured signals for tool, confirm, task events.
- Built-in read tools and workspace path safety.
- Patch validation and mismatch handling.
- Exec timeout, truncation, cancellation, and stdin.
- Task child context isolation and read-only enforcement.
- Plugin host handshake, call, delta, result, error, timeout, and cancel.
- RTK permission preservation.
- CodeGraph init/sync locks and child read-only access.

Health gates:

- `bun run check`
- focused `bun test` suites for changed boundaries
- broader `bun test` before large phase completion

## Open Risks

- `Intelligence` provider adapters may need different tool result message formats.
- `AgentSignal` migration can break socket tests if compatibility is not kept exact.
- Confirm pause/resume needs careful pending-turn ownership so concurrent sockets do not cross signals.
- Child agents can multiply token usage quickly; concurrency caps must be enforced from v1.
- CodeGraph sync may race with child read queries unless mutation tools take a workspace lock.
- RTK wrapping must never hide command failure or lower confirm requirements.
- Plugin install scripts need deterministic OS/arch handling and typed failure modes.

## Non Goals

- No generic MCP bridge in v1.
- No browser-use or computer-use in v1.
- No background child agents in v1.
- No persistent task ledger in v1.
- No child-agent writes in v1.
- No recursive task in v1.
- No permission `ask`.
- No global shell hook installation for RTK.
- No plugin binary compilation into Flyflor.
