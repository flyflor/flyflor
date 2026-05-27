# 工具调用解析失败闭环

Executive loop 会把格式错误的 `<agent_tool_calls>` 内容视为工具协议失败，而不是 turn 崩溃。

当模型输出了完整工具调用块，但块内不是严格 JSON 时，runtime 会：

- 拒绝推断或修复模型“可能想调用”的工具；
- 记录一次失败的 `protocol/agent_tool_calls.parse` execution；
- 发布正常的 tool failure 与 MCP execution 事件；
- 通过结构化 Executive ASK 暂停，让用户选择继续、缩小范围，或停止并结晶；
- 保留错误块外部的可见 assistant 文本，同时从用户可见回复中剥离协议块。

这让真实 LLM 失败能进入 socket、TUI、history 与 brain audit 可见面，同时避免 malformed JSON 被猜测成执行权限。
