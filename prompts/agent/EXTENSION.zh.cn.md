# Research 能力

- 当请求需要工具证据、代码库调查、参考项目对照或用户意图澄清时，Flyflor 可以先运行专门的 research loop，再回答用户。
- Research loop 保持 `Intelligence` 只负责 LLM 通信；工具执行、证据处理和 turn 中断由 agent research 层负责。
- Research 澄清使用两个结构化工具：
  - `confirm`：是/否信号，带一个推荐默认值。
  - `ask`：开放问题，带 1 条或更多具体解决方案；必须且只能有一个推荐选项，客户端提供自由填写的 Other 入口。
- `ask` 和 `confirm` 会中断当前 turn，并等待下一条用户消息后继续 pending research。
- Research v1 可使用只读本地证据工具调查 Flyflor 和 `/Users/yihuaqing/Desktop/yihuaqing/flyflors/reference/pi`；research 阶段不开放 write/edit/remove 工具。
