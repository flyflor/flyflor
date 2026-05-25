# 记忆系统

## 定位

Flyflor 将 memory equipment 与 life ledger storage 分开。

Context assembly 使用 Memory、Crystal 和显式 Scope/Fork。`brain.db` 记录 ledger/query/replay/audit/detail 所需的生命历史，但它不是 prompt 容器，也不会自动恢复 current context。

## 分层

| 层 | Owner | 职责 |
| --- | --- | --- |
| Constitution | `src/cognitive/hippocampus/memory/markdown` 和已安装 workspace files | 读取 `SELF.md`、`IDENTITY.md`、`USER.md` 和 `MEMORY.md` 作为稳定全局画像材料。 |
| Hot memory | `src/cognitive/hippocampus/memory/working`、`hot`、`recall`、`lifecycle` | Recent episodes、activation、TTL decay、compression、recall 和 anti-bloat。 |
| Memory tree / graph | `src/cognitive/hippocampus/memory/graph`、`recall/matrix.ts` | 由资源指标驱动 association 和 recall structure，不用关键词。 |
| Scope-local memory | `src/cognitive/hippocampus/memory/scope` 和 `src/cognitive/hippocampus/scope` | Scope constitution、project memory、scope vector/tree/hot memory 和 codename promotion。 |
| Crystal | `src/cognitive/crystal` | 稳定可复用方法、Gem snapshots、vector recall 和 drift repair。 |
| Ledger | `src/cognitive/hippocampus/memory/brain`、`src/entities/memory/brain`、`src/socket/query` | 按月 `brain.db`、archives、detail、history、replay 和 audit。 |

## `brain.db`

`brain.db` 是当前月可写生命账本。

它保存并服务：

- turn ledger rows
- replay 和 detail anchors
- audit material
- blackboard detail references
- task plans 和 fork records
- ASK 和 continuation records
- 通过 socket reader 暴露的 historical query snapshots

它不负责：

- 直接装配模型 prompt
- 充当 session store
- 拥有 scope continuity
- 从 `conversationKey`、`threadId`、user id 或 connection id 推断 current memory

历史月归档为只读 shard。当前月仍是可写 ledger。

## Hot Memory 与遗忘

Hot memory 有意保持不稳定。它让近期 evidence 可用，同时由 decay、compression 和 consolidation 决定什么值得留下。

遗忘不只是删除：

- TTL 和 recency 会随时间降低 activation。
- Hot compression 在 prompt assembly 膨胀前总结近期材料。
- Consolidation 和 dream workers 可以把重复或高价值 evidence 转成结构化 memory actions。
- Vector offsets 和 graph/matrix impact 调整 recall weight。
- 矛盾或陈旧 Crystal evidence 可以 repair，而不是盲目复用。

生产 recall signals 是 embedding similarity、importance、recency、activation、cluster size、graph relation 和 provenance 等数值/资源信号。它们不是 keyword intent rules。

## Scope 与 Codename

`Scope` 是显式可固化工作域。它可以拥有：

- 局部 constitution
- `project.memory.md`
- `.flyflor/scope.db` 风格的 vector/tree/hot-memory material
- 本地 skills/MCP/plugin surfaces
- fork 和 task-plan continuity

`codename` 更轻。它是 scope promotion 前的 anchor、proposal entry 和 recall boost。它不会自动打开 scope，也不是隐藏 context bucket。

Scope recall 由模型 gate：

1. Memory 列出 candidate scopes/codenames 和 scope-local evidence。
2. `ScopeRecallComponent` 请求模型输出结构化 `none | load | ask`。
3. `load` 为当前 turn 装备 scope。
4. `ask` 生成 ASK 等待确认。

## ContextFork

`ContextFork` 是当前工作上下文下的显式分支。只有传入 `RuntimeContext.contextForkId`，或结构化 runtime 路径创建/继续它时，才进入 prompt assembly。

Fork details 保存在 ledger/query plane。Merge conflict 产生 ASK，而不是静默覆盖。

## Crystal 关系

Memory 处理经验的热区和近期面。Crystal 处理稳定可复用知识。

Crystal candidate 可以来自高价值 ASK answer、已完成 fork、blackboard convergence、replay/task-plan outcome 和 reflection evidence。Gem promotion 有质量门控；它不基于原始 transcript 数量或自动 event copy。

## Prompt 规则

允许的 prompt equipment：

- 当前请求
- constitution files
- Memory recall 和 summaries
- Crystal recall
- 显式 active Scope
- 显式 ContextFork
- Executive visible capabilities

禁止的 prompt equipment：

- 原始 `brain.db` event stream
- transport session history 作为 continuity
- user/thread/conversation metadata 作为 memory owner
