# Executive Exoskeleton

## 定位

Executive 是行动外骨骼。它让认知内核能行动，但不让工具变成认知本体。

这一层拥有：

- Capability：能做什么。
- Tool：能力如何暴露给模型。
- Trust：本次请求是否允许执行。
- Loop：如何预算、暂停、恢复、审计，并防止无进展循环。

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
| `src/executive/computer.profile.ts` | 结构化 computer-control profile。 |
| `src/executive/sidecar/runner.ts` | External sidecar process runner contract。 |

Runtime wiring 位于 `src/agent/runtime/mcp`，并消费这些 Executive contracts。

## Capability 来源

支持的 capability sources 包括：

- 内置 workspace/git/process/shell 风格 toolsets
- MCP tools、resources 和 prompts
- plugin capabilities
- skills
- 来自 `tools/external.tools.jsonc` 的 user tools
- external sidecars
- subagents
- channel surface 提供的 channel actions

每个可见 tool 都需要 schema、permission、scope、read-only/danger flags、result limits 和 trust/sandbox treatment。

## Trust 与 Sandbox

Tool execution 必须通过 config、channel capabilities、permission policy、sandbox mode、approval mode、quota 和 audit。

Executive 层不从自然语言推断业务意图。它消费 structured fields、descriptors、config、sandbox policy、channel capability 和 numeric loop metrics。

Computer control 是独立高风险 capability profile，必须保留 computer approval、quota 和 audit 语义。

## Loop Safety

Loop guard 处理：

- unknown tool calls
- tool-name drift
- repeated identical failures
- no-progress tool cycles
- budget exhaustion
- malformed tool results

Long-horizon work 通过结构化 ASK 以及 `executive.loop.paused` / `executive.loop.resumed` 等事件暂停。没有隐藏私有 continuation channel。

## Events 与 Metadata

Execution results 暴露 machine-readable metadata，包括 capability kind、approvals、failures 和 loop snapshots。Socket clients 通过 `/ws` 读取当前状态；历史/detail 检查读取 ledger/query plane。

## 测试

相关覆盖：

- `tests/executive.core.test.ts`
- `tests/executive.manifest.test.ts`
- `tests/executive.tool.runtime.test.ts`
- `tests/runtime.executive.boundaries.test.ts`
- `tests/runtime.mcp.tool.plan.test.ts`
- `tests/sandbox.gate.test.ts`
- `tests/sandbox.quota.test.ts`
