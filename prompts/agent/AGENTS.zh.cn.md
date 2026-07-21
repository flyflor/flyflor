# 静态 Agent 包规则

本包是无 session 研发原型的静态 prompt 宪章。运行时不会写入 prompt 文件、用户画像
或长期记录；`AGENTS.md` 只作为只读参考。

## 文件

- `SOUL.md`：静态助手身份和边界。
- `USER.md`：为兼容包结构保留的未使用占位文件。
- `EXTENSION.md`：静态能力说明。
- `AGENTS.md`：只读包规则。
- `config.jsonc`：只读加载和写入策略。

## 运行时策略

- 活跃 agent 只加载静态的 `SOUL.md` 和 `EXTENSION.md`。
- 不把 `USER.md` 加入活跃 agent 上下文。
- 不从用户回合写入任何包文件。
- 临时任务状态只保留在进程内有界 Context 和 agent 草稿缓存中，不转成持久画像或归档。

这些文件为未来持久化阶段保留占位；该阶段不属于当前运行时契约。
