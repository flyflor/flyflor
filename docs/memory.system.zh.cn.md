# 记忆系统

## 定位

Flyflor 把 prompt equipment 与 life ledger storage 分开。

Context assembly 使用宪法文件、Memory、Crystal、显式 Scope、显式 ContextFork 和 Executive visible capabilities。`brain.db` 记录 ledger/query/replay/audit/detail 所需的生命历史，但它不是 prompt container，也不会自动恢复当前上下文。

## 分层

| 层 | Owner | 作用 |
| --- | --- | --- |
| 宪法层 | `src/cognitive/hippocampus/memory/markdown`、workspace memory files、scope scaffolded files | 读取稳定的 self/user/identity/memory/project 规则，例如 `SELF.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`、`AGENTS.md` 和 `project.memory.md`。 |
| 热记忆 | `src/cognitive/hippocampus/memory/working`, `hot`, `recall`, `lifecycle` | 近期 episode、activation、TTL decay、compression、recall 和 anti-bloat。 |
| 记忆树 / graph | `src/cognitive/hippocampus/memory/graph`, `recall/matrix.ts` | Association structure、recall matrix、relation weight、cluster impact 和 provenance。 |
| Scope-local memory | `src/cognitive/hippocampus/memory/scope`, `src/cognitive/hippocampus/scope` | Scope constitution、`project.memory.md`、scope vector/tree/hot memory、codename promotion 和 task/fork continuity。 |
| Crystal | `src/cognitive/crystal` | 稳定可复用方法、Gem snapshot、vector recall 和 drift repair。 |
| Ledger | `src/cognitive/hippocampus/memory/brain`, `src/entities/memory/brain`, `src/socket/query` | 按月 `brain.db`、archive、detail、history、replay、ASK、task、fork 和 audit rows。 |

## `brain.db`

`brain.db` 是当前月份可写 life ledger。

它存储并服务：

- turn ledger rows
- replay and detail anchors
- audit material
- Blackboard detail references
- task plans and fork records
- ASK and continuation records
- execution-job rows
- socket reader 暴露的 historical query snapshots

它不负责：

- 直接装配模型 prompt
- 充当 session store
- 拥有 scope continuity
- 从 `conversationKey`、`threadId`、user id、client id 或 connection id 推断当前记忆
- 授权 tool 或 approval

归档月份会变成 read-only shards。当前月份保持可写。

## 热记忆与遗忘曲线

热记忆本来就是不稳定的。它让近期 evidence 可用，同时由 decay、compression 和 consolidation 决定什么值得留下。

热记忆不是易失进程内存。`MemoryComponent` 必须有 durable backend。进程内 Map/LRU view 只是性能缓存；可恢复权威来自本地 snapshot/WAL 或 SQLite state。所有 mutation 必须先持久追加，再更新 hot view。启动恢复顺序固定为 snapshot、WAL replay、health snapshot、active-memory hydrate。断电最多丢失最后一条 torn WAL line，不能丢掉整个活跃上下文窗口。

遗忘不只是删除：

- TTL 和 recency 会随时间降低 activation。
- Hot compression 在近期材料撑爆 prompt 前先做摘要。
- Consolidation 和 dream worker 可以把重复或高价值 evidence 变成结构化 memory actions。
- 向量偏移和 graph/matrix impact 会调整召回权重。
- 矛盾或过期 Crystal evidence 可以被 repair，而不是盲目复用。

生产召回信号是 embedding similarity、importance、recency、activation、cluster size、graph relation、vector offset 和 provenance 这类数值/资源信号，不是关键词 intent rule。

## 向量偏移和召回

Vector recall 是 evidence ranking 机制，不是单独的语义权威。

- Embedding similarity 提出 candidate。
- Offset 和 graph/matrix signals 调整本地 ranking。
- Provenance、owner key、scope、fork id、recency 和 activation 决定 candidate 是否可以安全装备。
- 模型 prompt 接收 summarised/equipped memory，不接收 raw vector rows。

这保证召回有用，但 approximate vector neighbor 不会变成隐藏 continuity owner。

## Scope 与 Codename

`Scope` 是显式 durable work domain。它可以拥有：

- local constitution
- `project.memory.md`
- scope-local vector/tree/hot-memory material
- local skills/MCP/plugin surfaces
- fork and task-plan continuity

`codename` 更轻。它是 scope promotion 前的 anchor、proposal entry 和 recall boost。它不会自动打开 scope，也不是隐藏 context bucket。

Scope recall 由模型 gate：

1. Memory 列出 candidate scopes/codenames 和 scope-local evidence。
2. `ScopeRecallComponent` 要求模型输出结构化 `none | load | ask`。
3. `load` 为当前 turn 装备 scope。
4. `ask` 产生 ASK 给用户确认。

Scope 热记忆也必须持久化。默认 context/index plane 是 scope-local `.flyflor/scope.db`；它存储 vector/tree/hot-memory/association material，并可恢复成 prompt equipment，同时不把 `brain.db` 当成 prompt container。

## ContextFork

`ContextFork` 是当前工作上下文下的显式分支。只有 `RuntimeContext.contextForkId` 被提供，或结构化 runtime 路径创建/继续它时，才进入 prompt assembly。

Fork details 保存在 ledger/query plane。Merge conflict 必须产生 ASK，不能 silent overwrite。

## 与 Crystal 的关系

Memory 处理热的、近期的经验。Crystal 处理稳定可复用知识。

Crystal candidate 可以来自高价值 ASK answer、完成的 fork、Blackboard convergence、replay/task-plan outcome 和 reflection evidence。Gem promotion 有质量 gate，不基于 raw transcript count 或自动复制 event。

## Prompt 规则

允许进入 prompt 的 equipment：

- current request
- constitution files
- Memory recall and summaries
- Crystal recall
- explicit active Scope
- explicit ContextFork
- Executive visible capabilities

禁止当作 prompt equipment：

- raw `brain.db` event stream
- transport session history as continuity
- user/thread/conversation/client metadata as memory owner
- CLI-local transcript state as kernel memory
