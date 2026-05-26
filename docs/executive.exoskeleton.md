# Executive Exoskeleton

## Position

Executive is the action exoskeleton. It lets the cognitive kernel act without letting tools become cognition.

The layer owns:

- Capability: what can be done.
- Tool: how a capability is exposed to the model.
- Trust: whether this request may execute it.
- Approval: whether the user or policy must confirm it.
- Loop: how execution is budgeted, paused, resumed, audited, and protected from no-progress cycles.

## Code Owners

| Path | Role |
| --- | --- |
| `src/executive/registry.ts` | Capability registry. |
| `src/executive/manifest.ts` | Manifest and external tool definitions. |
| `src/executive/planner.ts` | Tool plan structures. |
| `src/executive/tool.runtime.ts` | Tool execution loop and result handling. |
| `src/executive/trust.policy.ts` | Trust and permission decisions. |
| `src/executive/loop.guard.ts` | Unknown-tool, repeated-failure, and no-progress guard. |
| `src/executive/mcp.adapter.ts` | MCP capability adaptation. |
| `src/executive/computer.profile.ts` | Structured computer-control profile. |
| `src/executive/sidecar/runner.ts` | External sidecar subprocess runner contract. |

Runtime wiring lives under `src/agent/runtime/mcp` and consumes these Executive contracts.

## Capability Sources

Supported capability sources include:

- built-in workspace/git/process/shell-style toolsets
- MCP tools, resources, and prompts
- plugin capabilities
- skills
- user tools from `tools/external.tools.jsonc`
- external sidecars and subprocess runners
- subagents
- channel actions when a channel surface provides them

Every visible tool needs schema, permission, scope, read-only/danger flags, result limits, and trust/sandbox treatment.

## Trust, Sandbox, And Approval

Tool execution must pass through config, channel capabilities, permission policy, sandbox mode, approval mode, quota, and audit.

The Executive layer does not infer business intent from natural language. It consumes structured fields, descriptors, config, sandbox policy, channel capability, approval state, and numeric loop metrics.

Computer control is a separate high-risk capability profile and must preserve computer approval, quota, and audit semantics.

## Loop Safety

The loop guard handles:

- unknown tool calls
- tool-name drift
- repeated identical failures
- no-progress tool cycles
- budget exhaustion
- malformed tool results

Long-horizon work pauses through structured ASK and events such as `executive.loop.paused` / `executive.loop.resumed`. There is no hidden private continuation channel.

## Tool Calling Closure

The complete tool-call loop is:

1. Runtime equips the prompt with the Executive visible capability surface.
2. The model emits structured tool intent.
3. Executive maps the request to a known descriptor and trust policy.
4. Sandbox/approval/quota gates decide whether execution may proceed.
5. Built-in tool, MCP call, user tool, sidecar subprocess, or subagent executes.
6. Runtime receives structured result metadata, emits events, and either continues the model loop or pauses through ASK.
7. `turn.final` carries machine-readable metadata; `history.list` and detail queries can replay safe summaries from the ledger/query plane.

`flyflor-cli` closes only the UI side of that loop. It can display capability snapshots, tool events, ASK pauses, execution jobs, and approval state. It must not execute tools locally or bypass the kernel.

## Current CLI Gap

The kernel context input supports:

- `toolApprovals`
- `mcpToolCalls`
- `userToolCalls`

The current CLI has YOLO mode, renders tool/run events, and exposes `/approve` for one-turn non-YOLO approval through `toolApprovals.mcpToolCalls` and `toolApprovals.userToolCalls`.

## Events And Metadata

Execution results expose machine-readable metadata including capability kind, approvals, failures, and loop snapshots. Socket clients read current state through `/ws`; historical/detail inspection reads the ledger/query plane.

## Tests

Relevant coverage:

- `tests/executive.core.test.ts`
- `tests/executive.manifest.test.ts`
- `tests/executive.tool.runtime.test.ts`
- `tests/runtime.executive.boundaries.test.ts`
- `tests/runtime.mcp.tool.plan.test.ts`
- `tests/sandbox.gate.test.ts`
- `tests/sandbox.quota.test.ts`
