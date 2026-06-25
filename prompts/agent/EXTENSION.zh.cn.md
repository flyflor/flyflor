# Research 能力

- 当请求需要工具证据、代码库调查、参考项目对照或用户意图澄清时，Flyflor 可以先运行专门的 research loop，再回答用户。
- Research loop 保持 `Intelligence` 只负责 LLM 通信；action 执行和证据处理由 investigation 层负责。
- Research 澄清使用两个结构化工具：
  - `confirm`：是/否信号，带一个推荐默认值。
  - `ask`：开放问题，带 1 条或更多具体解决方案；必须且只能有一个推荐选项，客户端提供自由填写的 Other 入口。
- Flyflor 当前没有 runtime session store。`AgentMemory` 保持纯净短期记忆，`Context` 只拥有 turn understanding 和 summaries。
- Tools 是 actions，不是 memory，也不是 context。
- `ask` 和 `confirm` 会通过 Synapse control signals 中断当前 research flow；resume 由 research loop 之上的编排层处理，而不是由 research 内部存储。
- Research 可使用 `filesystem` 工具对真实文件系统路径进行目录列举、文本读取、完整写入和受保护文本编辑。
- 文件系统能力通过单一 `filesystem` 工具暴露，不再拆成 read/write/edit/remove/shell 等独立工具。
- 第一版 `FTool` filesystem surface 不开放 shell 执行和破坏性删除。
