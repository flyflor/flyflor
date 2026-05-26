# Executive 外骨骼

## 定位

Executive 是行动外骨骼。它让认知内核能够行动，但不让工具变成 cognition。

这一层拥有：

- Capability：可以做什么。
- Tool：能力如何暴露给模型。
- Trust：当前请求是否可以执行。
- Approval：是否需要用户或策略确认。
- Loop：执行如何被预算、暂停、恢复、审计，并避免无进展循环。

## 代码 Owner

| 路径 | 职责 |
| --- | --- |
| `src/executive/registry.ts` | Capability registry。 |
| `src/executive/manifest.ts` | Manifest 和 external tool definitions。 |
| `src/executive/planner.ts` | Tool plan structures。 |
| `src/executive/tool.runtime.ts` | Tool execution loop 和 result handling。 |
| `src/executive/trust.policy.ts` | Trust 和 permission decisions。 |
| `src/executive/loop.guard.ts` | Unknown-tool、repeated-failure 和 no-progress guard。 |
| `src/executive/mcp.adapter.ts` | MCP capability adaptation。 |
| `src/executive/computer.profile.ts` | Structured computer-control profile。 |
| `src/executive/sidecar/runner.ts` | External sidecar subprocess runner contract。 |

Runtime wiring 位于 `src/agent/runtime/mcp`，消费这些 Executive contracts。

## Capability Sources

支持的 capability sources 包括：

- built-in workspace/git/process/shell-style toolsets
- MCP tools、resources 和 prompts
- plugin capabilities
- skills
- 来自 `tools/external.tools.jsonc` 的 user tools
- external sidecars 和 subprocess runners
- subagents
- channel surface 提供的 channel actions

每个可见 tool 都需要 schema、permission、scope、read-only/danger flags、result limits 和 trust/sandbox treatment。

## Trust、Sandbox 与 Approval

Tool execution 必须经过 config、channel capabilities、permission policy、sandbox mode、approval mode、quota 和 audit。

Executive 层不从自然语言推断业务意图。它消费 structured fields、descriptors、config、sandbox policy、channel capability、approval state 和 numeric loop metrics。

Computer control 是单独的高风险 capability profile，必须保留 computer approval、quota 和 audit 语义。

## Loop Safety

Loop guard 处理：

- unknown tool calls
- tool-name drift
- repeated identical failures
- no-progress tool cycles
- budget exhaustion
- malformed tool results

长线工作通过结构化 ASK 和 `executive.loop.paused` / `executive.loop.resumed` 等事件暂停。不存在隐藏 private continuation channel。

## 工具调用闭环

完整工具调用 loop 是：

1. Runtime 把 Executive visible capability surface 装备进 prompt。
2. 模型输出结构化 tool intent。
3. Executive 将请求映射到已知 descriptor 和 trust policy。
4. Sandbox/approval/quota gates 决定是否允许执行。
5. Built-in tool、MCP call、user tool、sidecar subprocess 或 subagent 执行。
6. Runtime 接收结构化 result metadata，发出 events，并继续 model loop 或通过 ASK 暂停。
7. `turn.final` 携带 machine-readable metadata；`history.list` 和 detail query 可以从 ledger/query plane 重放安全摘要。

`flyflor-cli` 只闭合 UI 一侧。它可以展示 capability snapshot、tool event、ASK pause、execution job 和 approval state；它不能本地执行工具，也不能绕过 kernel。

## 当前 CLI 缺口

Kernel context input 支持：

- `toolApprovals`
- `mcpToolCalls`
- `userToolCalls`

当前 CLI 有 YOLO mode，也能渲染 tool/run events，但面向 `toolApprovals.mcpToolCalls` 和 `toolApprovals.userToolCalls` 的普通 per-turn approval UI 仍是后续任务。在闭环前，文档必须把它写成 gap，而不是完成行为。

## Events And Metadata

Execution result 暴露 machine-readable metadata，包括 capability kind、approvals、failures 和 loop snapshots。Socket clients 通过 `/ws` 读取当前状态；历史/detail 检查读取 ledger/query plane。

## Tests

相关覆盖：

- `tests/executive.core.test.ts`
- `tests/executive.manifest.test.ts`
- `tests/executive.tool.runtime.test.ts`
- `tests/runtime.executive.boundaries.test.ts`
- `tests/runtime.mcp.tool.plan.test.ts`
- `tests/sandbox.gate.test.ts`
- `tests/sandbox.quota.test.ts`
