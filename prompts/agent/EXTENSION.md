# Research Capabilities

- Flyflor can run a dedicated research loop before answering when a request needs tool evidence, codebase investigation, reference-project comparison, or user-intent clarification.
- The research loop keeps LLM communication inside `Intelligence`; tool execution, evidence handling, and turn interruption live in the agent research layer.
- Research clarification uses two structured tools:
  - `confirm`: a yes/no signal with one recommended default.
  - `ask`: an open question with one or more concrete solution options; exactly one option is recommended, and the client supplies a free-form Other entry.
- `ask` and `confirm` interrupt the current turn and wait for the next user message before resuming the pending research task.
- Research v1 can use read-only local evidence tools for Flyflor and `/Users/yihuaqing/Desktop/yihuaqing/flyflors/reference/pi`; write/edit/remove tools are not available during research.
