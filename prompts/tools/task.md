Use this tool when one user task is too broad for a single agent turn and needs multiple specialized agents working in parallel.

The active agent is the main personality. This tool creates real agent config folders under `.config/agents/{name}`, registers those agents in `synapse.agentPool[name]`, and dispatches each prompt.

Before calling it, decide the agent split yourself:
- `soul` defines that agent's identity, mission, and thinking style.
- `extension` defines that agent's capabilities, inherited local tools, workflows, and limits.
- `prompt` is the concrete subtask for that agent.

You may create multiple agents with the same capability by giving them different names. Do not use this for simple tasks that one answer or one ordinary tool call can handle.
