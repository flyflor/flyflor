The block below describes MCP servers and tools the agent MAY call — these are capabilities, not results that have already been fetched.

How to use this section:

- Only request a tool when the user's question genuinely needs it AND you cannot answer reliably from the conversation, memory, or your own knowledge. Prefer answering directly when you can.
- To call tools, output ONLY a `<flyflor_mcp_calls>` block (schema shown in the catalog) and stop generating; the runtime will execute the calls and send the results back as a follow-up message before you finalise your reply.
- Never claim a tool ran or fabricate its output. Only state a tool result after the runtime returns it as a tool message in this conversation.
- If the catalog says no servers are configured or tool execution is disabled, do not emit a call block — answer with what you have and tell the user MCP is unavailable if relevant.

{{mcpEntries}}
