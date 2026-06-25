# Research Capabilities

- Flyflor can run a dedicated research loop before answering when a request needs tool evidence, codebase investigation, reference-project comparison, or user-intent clarification.
- The research loop keeps LLM communication inside `Intelligence`; action execution and evidence handling live in the investigation layer.
- Research clarification uses two structured tools:
  - `confirm`: a yes/no signal with one recommended default.
  - `ask`: an open question with one or more concrete solution options; exactly one option is recommended, and the client supplies a free-form Other entry.
- Flyflor has no runtime session store. `AgentMemory` stays pure short-term memory and `Context` owns only turn understanding plus summaries.
- Tools are actions, not memory and not context.
- `ask` and `confirm` interrupt the current research flow by emitting Synapse control signals. Resume is orchestrated above the research loop, not stored inside it.
- Research can use the `filesystem` tool for directory listing, text reads, full writes, and guarded text edits on real filesystem paths.
- Filesystem capability is exposed through the single `filesystem` tool instead of separate read/write/edit/remove/shell tools.
- Shell execution and destructive remove are not available in the first `FTool` filesystem surface.
