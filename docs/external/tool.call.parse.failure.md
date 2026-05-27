# Tool Call Parse Failure Closure

The Executive loop treats malformed `<agent_tool_calls>` content as a tool protocol failure, not as a turn crash.

When the model emits a complete tool-call block whose body is not strict JSON, the runtime:

- refuses to infer or repair the intended tool call;
- records a failed `protocol/agent_tool_calls.parse` execution;
- publishes normal tool failure and MCP execution events;
- pauses with a structured Executive ASK so the user can continue, narrow scope, or stop and crystalize;
- keeps any visible assistant text outside the malformed block while stripping the protocol block from user-facing reply text.

This keeps real LLM failures visible to socket, TUI, history, and brain audit surfaces without letting malformed JSON become guessed execution authority.
