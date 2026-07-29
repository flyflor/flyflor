# 静态 Agent 包规则

该 active profile 是无 session 研发原型的静态宪章。运行时绝不写入 prompt 文件、用户
画像或长期记录。本文件只读，也不会加载进普通 agent 消息。

## 文件

- `SOUL.md`：静态助手身份和边界。
- `USER.md`：为兼容保留的未使用占位文件。
- `EXTENSION.md`：静态能力说明。
- `AGENTS.md`：只读包规则。
- `config.jsonc`：只读加载和写入策略。

## 运行时策略

- 只加载 `SOUL.md` 和 `EXTENSION.md`。
- 不把 `USER.md` 放入活跃上下文。
- 拒绝所有运行时 prompt 包写入。
- 临时任务状态只保留在进程内有界 Workspace 和逐线程 Scratchpad 中，不创建持久用户画像或对话归档。

未使用的 `USER.md` 只为包结构兼容而保留；持久化不属于当前运行时契约。
