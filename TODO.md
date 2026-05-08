# Flyflor TODO

| 状态 | 模块 | 事项 | 说明 |
| --- | --- | --- | --- |
| 进行中 | 记忆 | Session 与 history 主体 | SQLite 保存 session/messages，`memory/history.jsonl` 保存压缩历史。 |
| 进行中 | 记忆 | 记忆候选 | 基于多语言信号生成带权重 candidate，显式表达只是其中一种高信号来源。 |
| 进行中 | 记忆 | 多语言信号分析 | 使用分词、关键短语、情绪维度、笃定程度、承诺强度生成 candidate score。 |
| 进行中 | 记忆 | Markdown 长期记忆 | `SELF.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 作为长期记忆 source of truth。 |
| 进行中 | 记忆 | Qdrant 内部索引 | Qdrant 只做内部语义召回，可重建，不对用户暴露。 |
| 待办 | 反思 | Reflection worker | 从 candidate/history/session 中提炼稳定结论，不阻塞聊天热路径。 |
| 待办 | 空间记忆 | 关联图模型 | 建立用户、项目、文件、工具、渠道、决策之间的空间关系。 |
| 待办 | 方法论 | 方法论印证 | 可复用方法需要多次成功或用户认可后进入长期方法论记忆。 |
| 待办 | Worker | 后台任务边界 | consolidation、reflection、Qdrant rebuild 迁移到 Bun worker/子进程。 |
| 待办 | CLI/TUI | Dream/Reflection 可视化 | 后续提供 `/dream-log`、`/dream-restore`、反思审计视图。 |
| 待办 | 测试 | 记忆边界测试 | 覆盖 JSONC、session、candidate、Markdown 写入、Qdrant 降级。 |
