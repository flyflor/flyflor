# TOOLS-PLAN

Status: research and design only. Nothing in this document is implemented yet.

This plan was produced after reading the current Flyflor repository code (`src/`, `scripts/`, tests, prompts, docs) and the local reference trees for Codex, Claude Code, opencode, openhuman, openclaw, nanobot, CodeWhale, and hermes-agent.

## Goals

Flyflor needs a real tool execution layer that:

- fits the current object-first runtime;
- keeps IOC as the only construction boundary;
- preserves the 8-byte big-endian IPC frame protocol;
- separates kernel plugin loading (`src/plugins`) from the root external tool layer (`./plugins`);
- supports tool calls, approvals, sandboxing, multi-step execution, and subagents without turning the kernel into a loose function registry.

Non-goals for the first implementation:

- do not ship every possible tool on day one;
- do not bundle browser/computer/rtk/codegraph runtimes into the Bun binary;
- do not import a foreign architecture wholesale from Codex/opencode/openhuman;
- do not break the current streamed-text behavior while tool support is still rolling out.

## Current Flyflor Audit

### What already exists

1. IOC and lifecycle are solid enough for a tool layer.
   - `src/core/ioc/container.ts` already gives Flyflor singleton reuse, fresh `create()`, property injection, constructor import resolution, and `@Init()`.
   - `src/core/ioc/abstracts.ts` already has object scopes for services, modules, files, plugins, guards, sandboxes, and agents.

2. Prompt and file objects already expose a policy channel.
   - `src/core/file/service.ts` parses `<flyflor:xxx>` JSONC blocks and stores them in `blocks`.
   - `src/core/prompt/decorator.ts` already loads path-bound prompt file objects through IOC.

3. The current runtime is text-stream oriented and narrow.
   - `src/agent/brain/brain.ts` builds one `system` message, appends text history, and streams text deltas from `Intelligence`.
   - `src/agent/brain/intelligence/*` is still a provider text streaming layer, not a tool event layer.

4. IPC is small and stable.
   - `src/neural/packet/service.ts` owns the 8-byte length-prefixed JSON protocol.
   - `src/neural/ipc/socket.ts` routes one inbound packet to `Synapse`, streams text deltas back, and sends `streamEnd`.

5. A plugin boundary already exists in name only.
   - `src/plugins/plugin.module.ts` is an empty kernel module boundary today.

6. Config already contains relevant seeds.
   - `src/config/config.component.ts` already exposes `mcp`.
   - it also exposes `skills`, but that should not become the executable plugin runtime by accident.

### Current gaps

1. There is no tool-call event model.
   - `IntelligenceTurn` only returns `{ done, value?: string }`.
   - providers do not surface tool calls, tool results, approval requests, or structured reasoning parts.

2. There is no tool loop.
   - `Brain.transformer()` reads one provider stream and commits text directly.
   - there is no "model asks for tool -> tool runs -> result goes back into model" cycle.

3. There is no permission object or approval state.
   - `FGuard` and `FSandBox` exist as scopes, but no runtime service uses them for tool policy.

4. There is no structured file edit path.
   - Flyflor has `FileService`, but no patch grammar, diff object, or multi-edit validator.

5. There is no process-session model for shell execution.
   - nothing in the runtime currently owns long-lived child processes, stdin writes, polling, or cancellation.

6. `src/plugins` and root `./plugins` are not yet distinct in code.
   - the kernel has no loader for external tool packages.

7. Tests currently lock in text streaming semantics that the tool layer must preserve.
   - `brain.test.ts` checks "commit context only on successful completion".
   - `socket.test.ts` checks scoped streaming per socket and `streamEnd` ordering.

## Reference Extraction

### Codex

Useful patterns:

- `ToolDefinition` is a normalized model-facing spec with input schema, optional output schema, and deferred loading.
- `ToolExecutor` keeps executable runtime and model-visible spec tied together, and each tool can declare whether parallel tool calls are safe.
- `mcp_tool.rs` normalizes MCP schemas before exposing them to models.
- `tool_output.rs` separates model-facing output, log preview, and hook-facing post-tool payloads.
- `tool_config.rs` treats shell backend choice, unified exec, and environment mode as explicit runtime policy, not incidental behavior.
- thread/sdk surfaces make approval mode and sandbox mode explicit per thread and per turn.

Implications for Flyflor:

- keep a normalized internal tool definition even when the tool source is built-in, plugin, or MCP;
- treat exposure, schema sanitization, deferred tools, and parallel support as first-class metadata;
- make shell/process execution a dedicated runtime path, not a one-off helper.

### Claude Code

Useful patterns:

- command frontmatter declares `allowed-tools`, model hints, and argument shapes;
- hooks (`PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`) provide lifecycle interception points;
- `TodoWrite`, `Task`, `MultiEdit`, `Edit`, `Bash`, `Read`, `Grep`, and `Glob` are distinct tools rather than one giant shell escape hatch;
- settings layer expresses allow/ask/deny policy separately from tool implementation.

Implications for Flyflor:

- prompt blocks should compile into runtime tool policy;
- guardrails need deterministic pre/post tool hooks;
- multi-edit should be a structured edit surface, not raw overwrite;
- todo and task should be explicit runtime objects, not prompt prose.

### opencode

Useful patterns:

- tool context carries session id, message id, call id, abort, messages, metadata updates, and `ask()`;
- tool execution writes structured parts (`text`, `tool-call`, `tool-result`, `step-finish`) into session state;
- `task` is just a standard tool;
- permissions support `allow`, `deny`, `ask`;
- child agents inherit parent constraints.

Implications for Flyflor:

- subagents should enter through the same tool orchestrator as every other tool;
- tool context must be a stable runtime object;
- permission ask/reply must suspend and resume a tool call instead of forcing tools to block on ad hoc prompts.

### openhuman, openclaw, nanobot, CodeWhale, hermes-agent

Useful patterns worth borrowing selectively:

- openhuman:
  - `ToolScope`, `ToolCategory`, `PermissionLevel`, args-aware permission escalation;
  - provider schema cleaning;
  - codegraph exposed as explicit tools (`codegraph_index`, `codegraph_search`);
  - browser/computer tools treated as higher-risk surfaces.
- openclaw:
  - external plugin manifest compatibility checks and typed plugin SDK entrypoints.
- nanobot:
  - minimal tool interface, schema casting/validation, long-running exec sessions.
- CodeWhale:
  - tool capability metadata, approval requirement, timeout, and hook events;
  - command-prefix exec policy.
- hermes-agent:
  - registry generation counters, TTL availability cache, path security helpers, browser provider registry.

Implications for Flyflor:

- external tool packages should be cold-discovered from manifests and normalized before registration;
- codegraph should be visible as a tool, not hidden behind generic search;
- path guards, command guards, and workspace boundary checks should be deterministic services.

## Target Architecture

### 1. Add a real tool runtime scope

Recommended new primitive layer:

```txt
src/core/tool/
  index.ts
  decorator.ts
  types.ts
```

Recommended addition to `src/core/ioc/abstracts.ts`:

- `FTool extends FService`

Recommended decorator:

- `@Tool()`

Reason:

- tools are now a real runtime object kind, not just helper methods;
- the repository rules already require new runtime scopes to be expressed through decorators plus inheritance.

### 2. Add a dedicated tool domain

Recommended new domain boundary:

```txt
src/tool/
  index.ts
  types.ts
  service.ts
  permission/
    service.ts
    types.ts
  approval/
    service.ts
    types.ts
  process/
    service.ts
    types.ts
  patch/
    service.ts
    types.ts
  mcp/
    service.ts
    types.ts
  plugin/
    service.ts
    types.ts
```

Core objects:

- `ToolService`
  - discovery, filtering, model-visible tool list assembly
- `ToolRegistry`
  - name -> tool runtime mapping
- `ToolOrchestrator`
  - executes one tool call through permission, sandbox, runtime, output shaping, and event emission
- `PermissionService`
  - `allow | deny | ask`
- `ApprovalService`
  - pending approval tickets, replies, "always allow" session rules
- `ProcessSessionService`
  - long-lived shell/exec sessions
- `PatchService`
  - patch grammar parsing, diff validation, atomic apply
- `PluginRuntimeService`
  - load and supervise root `./plugins`
- `McpToolService`
  - normalize configured MCP tools into internal `FTool` objects

### 3. Normalize every tool source into the same internal shape

Recommended internal metadata:

- `name`
- `description`
- `inputSchema`
- `outputSchema?`
- `source`: `builtin | plugin | mcp | generated`
- `exposure`: `direct | deferred | directModelOnly | hidden`
- `permissionLevel`: `none | read | write | execute | dangerous`
- `parallelSafe`
- `lockScope`: `tool | workspace | path | global`
- `timeoutMs?`
- `scope`: `agent | cli | ipc | all`
- `category`: `system | workflow | browser | computer | retrieval`

Recommended call context:

- `sessionId`
- `turnId`
- `messageId`
- `callId`
- `agentName`
- `workspaceRoot`
- `cwd`
- `abortSignal`
- `metadata()`
- `emit()`
- `ask()`
- `sandbox`

Recommended result shape:

- `status`: `completed | error`
- `content`: text and/or structured payload
- `artifacts?`
- `truncated`
- `outputPath?`
- `metadata`

## Model And Brain Changes

### Current problem

`Brain` and `Intelligence` are text-only today.

### Proposed change

Add a structured intelligence event stream:

- `text_delta`
- `tool_call`
- `assistant_finish`
- `error`

Recommended first implementation strategy:

1. keep `Agent.next()` streaming assistant text outward;
2. change `Intelligence` internals to expose structured events;
3. let `Brain` own the tool loop:
   - send user + context to model;
   - read events;
   - stream text deltas outward immediately;
    - on `tool_call`, dispatch through `ToolOrchestrator`;
   - persist the tool-call item in turn state before starting execution so replay/history stay stable;
   - append tool result to the turn state;
   - continue the model turn until assistant finish;
   - only commit turn context on successful finish.

Recommended provider rollout:

- Phase 1 tool-call support:
  - `OpenAIResponses`
  - `AnthropicMessages`
- Keep other adapters text-only until they are upgraded with schema translators and tool-call event parsing.

This is the most conservative path because it does not force all existing providers to change at once.

## IPC And Event Protocol

Keep the frame protocol exactly as it is:

- still 8-byte big-endian length-prefixed JSON;
- still one `SocketPacket` envelope.

Extend the event vocabulary, not the transport.

Recommended new outbound actions:

- `turnStart`
- `toolStart`
- `toolDelta`
- `toolEnd`
- `toolError`
- `approvalRequested`
- `approvalResolved`
- `todoUpdated`
- `subagentStart`
- `subagentEnd`
- `turnEnd`

Recommended new inbound actions:

- `approvalReply`
- `toolCancel`

Compatibility rule:

- keep current `data` and `streamEnd` behavior for assistant text so existing clients do not break while richer events are added.

## Permissions, Approvals, And Sandboxing

### Runtime decision model

Every tool call should resolve to:

- `allow`
- `deny`
- `ask`

Session or agent policy may still be configured in higher-level modes such as:

- `never`
- `on_request`
- `on_failure`
- `unless_trusted`

But the runtime execution decision per call should stay `allow | deny | ask`.

### Guard pipeline

Recommended deterministic checks before tool execution:

1. tool enabled?
2. tool source trusted?
3. workspace path valid?
4. command/network rules valid?
5. permission level within policy?
6. approval required?
7. sandbox/runtime available?

Recommended hook points, implemented as `FGuard` / `FSandBox` subscribers:

- `PreToolUse`
- `PostToolUse`
- `Stop`
- `PreCompact`

### Session inheritance rules

Subagents and plugin-provided tools must inherit:

- parent deny rules;
- workspace boundary restrictions;
- approval mode;
- network restrictions.

Child tools must never widen a parent deny.

## Shell And Process Sessions

Do not model shell as one synchronous `spawn -> collect text -> return` helper.

Recommended process-session object:

- session id
- pid
- command
- cwd
- env policy
- `tty`
- `login`
- `stdin` write support
- polling/yield interval
- truncation counters
- timeout state
- cancellation state

Recommended minimal tool surface:

- `exec_command`
- `write_stdin`
- `terminate_process`

This should be backed by `ProcessSessionService` and routed through `FSandBox`.

## File Editing And Patch

### Recommendation

Make patch/diff the default write surface.

Preferred built-ins:

- `read_file`
- `glob`
- `grep`
- `apply_patch`
- `shell`
- `task`
- `todo`

Avoid exposing raw overwrite as the primary model path.

### Patch rules

Recommended patch flow:

1. parse patch grammar into a structured edit object;
2. resolve every touched path against the workspace boundary;
3. validate `oldText` or hunk context against the current file;
4. compute a preview diff;
5. request approval when required;
6. apply atomically;
7. emit tool lifecycle events with diff metadata.

This should use `FileService` as the path-bound file owner, but the patch logic itself should live in a dedicated patch service.

## Task And Subagent Design

Implement subagent dispatch as a standard tool.

Recommended first tool:

- `task`

Phase 1 behavior:

- foreground only;
- target profiles come from `ConfigComponent.agents`;
- child result is returned as one tool result to the parent.

Phase 2 behavior:

- optional background mode;
- synthetic follow-up events/messages when the child completes;
- later support ephemeral generated agent profiles.

This aligns with the existing prompt intent in `prompts/agent/AGENTS.md` without requiring a special out-of-band text protocol.

## Kernel Plugin Layer vs Root External Tool Layer

### `src/plugins`

Keep `src/plugins` as the kernel-owned loader and supervision boundary.

Its job should be:

- discover plugin manifests;
- validate compatibility;
- start supervised runtimes;
- normalize plugin tools into internal `FTool` objects;
- bridge plugin events, approvals, and shutdown.

### `./plugins`

This is the required root external tool layer. It must stay outside the Bun binary.

Recommended default contents:

- `./plugins/browser-use`
- `./plugins/computer-use`
- `./plugins/rtk`
- `./plugins/codegraph`

Recommended manifest direction:

```json
{
  "name": "codegraph",
  "version": "0.1.0",
  "runtime": {
    "kind": "stdio",
    "entry": "./bin/codegraph"
  },
  "tools": [
    { "name": "codegraph_index" },
    { "name": "codegraph_search" }
  ],
  "permissions": {
    "default": "read"
  },
  "capabilities": ["retrieval", "workspace-local-index"]
}
```

Recommended policy:

- browser/computer/rtk/codegraph stay external packages;
- Flyflor core ships only the contract, loader, and runtime bridge.

### Special notes per external tool

1. `browser-use`
   - explicit opt-in plugin;
   - separate domain allowlist from generic HTTP fetch;
   - default approval level should be at least `execute`, often `dangerous`.

2. `computer-use`
   - explicit opt-in plugin;
   - highest-risk surface;
   - must go through approval + sandbox + lifecycle events.

3. `rtk`
   - integrate through the same plugin contract as any other external tool;
   - do not add a bespoke kernel fast path for it.

4. `codegraph`
   - expose as explicit tools, not hidden retrieval;
   - keep its index/store in plugin-owned local state;
   - enforce workspace-root restriction before indexing or searching.

## MCP Integration

Use the existing `config.mcp` configuration as the seed for MCP server definitions.

Recommended behavior:

- support stdio MCP first;
- normalize MCP tools into internal `FTool`;
- namespace tool names as `mcp__server__tool`;
- sanitize schemas before model exposure;
- keep structured MCP output instead of flattening everything to text too early.

Recommended non-goal for phase 1:

- do not block phase 1 on full OAuth, SSE, or HTTP MCP support.

## Prompt Policy Blocks

Flyflor already has a prompt block system. Use it.

Recommended new block families:

```md
<flyflor:tools>
{
    version: 1,
    allowed: ["read_file", "glob", "grep", "apply_patch", "task"],
    enabledPlugins: ["codegraph"],
    approvalPolicy: "on_request"
}
</flyflor:tools>

<flyflor:permissions>
{
    version: 1,
    maxLevel: "write",
    network: false
}
</flyflor:permissions>
```

These blocks should compile into runtime policy objects before the tool loop starts.

## Recommended Phases

### Phase 1: core tool loop

- add `FTool` and `@Tool()`;
- add `src/tool` runtime services;
- add structured intelligence events;
- implement built-in tools:
  - `read_file`
  - `glob`
  - `grep`
  - `apply_patch`
  - `shell`
  - `task`
  - `todo`
- implement `allow | deny | ask`;
- add IPC tool lifecycle events;
- preserve current text-stream behavior.

### Phase 2: process sessions and external tool bridge

- add `ProcessSessionService`;
- add root `./plugins` discovery and supervision;
- add stdio MCP bridge;
- add external plugins:
  - `browser-use`
  - `computer-use`
  - `rtk`
  - `codegraph`
- add foreground subagent execution through `task`.

### Phase 3: richer policy and background execution

- background tasks/subagents;
- `PreCompact` summaries with structured carry-forward state;
- approval persistence and trusted-session rules;
- more provider tool schemas;
- richer UI/IPC surfaces for approvals, todos, and tool progress.

## Test And Regression Plan

Minimum new test coverage:

1. tool discovery and IOC registration
2. provider schema sanitization
3. intelligence event parsing for tool-call capable providers
4. `Brain` tool loop success/failure/cancel semantics
5. permission `allow | deny | ask`
6. approval suspend/resume over IPC
7. patch path escape and old-text mismatch rejection
8. process session polling, stdin, timeout, cancel, truncation
9. socket event ordering and per-socket isolation
10. MCP name normalization and output shaping
11. subagent deny inheritance
12. plugin manifest validation and plugin runtime supervision
13. codegraph workspace-bound indexing/search

Health gates when implementation starts:

- `bun run check`
- focused `bun test` suites for every changed boundary

## Open Decisions And Recommended Answers

1. Should executable plugins reuse `skills` config?
   - Recommendation: no.
   - Keep `skills` for skill content; add a dedicated plugin config or hard default to root `./plugins`.

2. Which providers should gain tool calls first?
   - Recommendation: `OpenAIResponses` first, `AnthropicMessages` second.

3. Should raw file overwrite be model-visible in phase 1?
   - Recommendation: no.
   - Prefer patch/edit-oriented tools first.

4. Should browser/computer be built-in?
   - Recommendation: no.
   - Keep them as external plugin runtimes and bridge them through the kernel.

5. Should codegraph be hidden behind generic search?
   - Recommendation: no.
   - Expose `codegraph_index` and `codegraph_search` explicitly.

## Final Recommendation

Flyflor should not add "tools" as a bag of helper functions inside `Brain` or `Intelligence`.

It should add:

- a real `FTool` runtime scope;
- a dedicated `src/tool` orchestration boundary;
- structured model events and a real tool loop in `Brain`;
- explicit permission and sandbox services;
- patch/process/session primitives;
- a strict separation between kernel plugin loading (`src/plugins`) and root external tools (`./plugins`).

That path matches the current repository rules, fits the existing IOC and prompt machinery, and leaves room for Codex-style execution, Claude-style policy hooks, and opencode-style task/subagent flow without forcing Flyflor to stop being Flyflor.
