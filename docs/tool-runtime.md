# Tool Runtime Design

## Purpose

The tool layer is the coding agent execution layer. It must be model-visible, typed, observable, and safe enough for repeated coding work.

## Tool Loop

The kernel sends only model-visible tool schemas to the model provider. Tool
visibility is derived from the real model's turn decision and then bounded by
runtime policy. The full registry is not exposed automatically.

When the provider returns `tool_calls`, the runtime:

1. validates tool input,
2. writes a brain audit event,
3. emits `tool.started`,
4. executes the tool through `ToolRegistry`,
5. writes raw artifacts,
6. compresses model-facing output when useful,
7. emits `tool.completed` or `tool.failed`,
8. appends a tool result message,
9. calls the model again.

Every registered tool exposes `execution` metadata. Read-only tools declare
`mutability=read-only` and `concurrency=concurrent`; mutating tools declare
`mutability=mutating` and `concurrency=serial`. The current registry exposes
this metadata to model/tool-loop callers before parallel scheduling is enabled.

Mutating model tools require a scoped target from the structured turn decision.
The runtime derives `writeTargetRoot` only when the model selected edit tools
and identified a unique project path. `write`, `edit`, and `multi_edit` are not
model-visible without that root. `shell` is model-visible only with an exact
`shellCommand`, and a model-requested shell tool call is denied if its command
differs from the decision. Shell is not a fallback path for file mutation.

## Internal Tools

Internal tools live in `src/tools` and are compiled into the Bun binary:

- `read`
- `write`
- `edit`
- `multi_edit`
- `glob`
- `grep`
- `shell`
- `git`
- `memory_recall`
- `memory_store`
- `memory_forget`
- `context_compact`
- `task`
- `codegraph`

`multi_edit` must validate all replacements before writing any file.

## External Plugin Tools

External tools live outside the binary:

- `./plugins/codegraph`
- `./plugins/rtk`
- any future executable or manifest-based plugin.

`src/plugins` owns installation, discovery, manifests, command bridging, and
tool contribution. Runtime must not depend on global `rtk`, `codegraph`, or
future external plugin commands. Plugin manifests are merged by plugin and tool
name in deterministic sorted order so an external manifest cannot duplicate the
built-in `codegraph` adapter surface. Missing project-local plugins trigger an
install attempt first when profile policy allows auto-install; disabled or
failed installs produce explicit unavailable or failed diagnostics. The runtime
must not silently substitute another tool path.

RTK wraps noisy command families and returns a compact model-facing summary plus
a raw artifact reference when available. CodeGraph runs only after the turn
planner marks the turn as codebase or coding work. If an optional plugin is
unavailable, the corresponding tool returns `ok=false` with explicit diagnostics.
Built-in tools that delegate to plugin adapters, such as `shell` and `git`
using RTK, must construct those adapters with the active runtime `ConfigService`
so isolated scenario paths and project-local plugin resolution stay consistent.

## Events

Tool execution emits:

- `tool.call`
- `tool.started`
- `tool.delta`
- `tool.result`
- `tool.completed`
- `tool.failed`
- `tool.error`
- `tool.artifact`
- `guard.ask`
- `guard.answer`

Socket code only broadcasts these events. It does not execute tools.

## Acceptance

The runtime is accepted when a real model can ask for tools, see the result,
continue reasoning, and produce a final answer without host keyword shortcuts.
Any pre-model project inspection or shell execution must be explicitly
authorized by the structured turn decision and audited as tool evidence.
Model-requested mutating tools must have either a unique write target or an
exact shell command from the same decision.
