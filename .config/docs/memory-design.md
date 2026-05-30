# MemoryComponent 与 memory.db 设计

## 目标

MemoryComponent 要为无 session agent 提供长期上下文连续性。它不是简单向量库包装，而是本地知识树：原始对话、chunk、embedding、实体、边、摘要节点、Markdown 投影都围绕一个权威 `memory.db` 工作。

## 非目标

- 第一阶段不拆多个 DB。
- 第一阶段不实现完整梦境模式，只预留任务和 projection 边界。
- Markdown 文件不是权威源，不允许运行时只读 Markdown 来代替 DB。
- 不把 `.config/templates/SOUL.md`、`USER.md`、`MEMORY.md` 混进知识树投影。

## 存储位置

- `.config/memory/memory.db`：唯一权威库。
- `.config/memory/wiki/`：知识树 Markdown 投影，供审阅、纠偏、梦境模式参考。
- `.config/memory/artifacts/`：工具原始输出、压缩前内容、模型中间产物。
- `.config/sqlite-vec/`：vendor 的 sqlite-vec 动态库资产。
- `.config/runtime/sqlite-vec/`：运行时物化动态库的真实路径。

## sqlite-vec 决策

第一阶段默认使用 `sqlite-vec`。本地报告已经验证 Bun binary 可行，但实现必须遵守以下约束：

- vendor 平台动态库。
- 使用 Bun file asset 嵌入动态库。
- 运行时把 embedded asset 写到真实文件路径。
- 调用 `db.loadExtension(realPath, "sqlite3_vec_init")`。
- 不能直接依赖 `sqlite-vec.load(db)` 作为二进制打包路径。

参考报告：`/Users/yihuaqing/Desktop/yihuaqing/flyflors/test/sqlite-vec-bun-binary-report.md`。

## 表设计方向

`conversations` 记录本地对话线程。无 session 不表示无本地线程，线程只用于本地 continuity 和审计，不传给 provider 当 server-side session。

`messages` 存 canonical turn log。每条消息包含 role、content、turn id、parent id、token 估算、时间、tool metadata。

`context_checkpoints` 存 Codex/OpenCode 风格 anchored summary。checkpoint 用于压缩旧对话，不替代长期记忆。

`memory_chunks` 存知识树叶子和摘要节点。字段需要覆盖 source kind、source id、content markdown、token count、importance、status、created time、updated time。

`memory_vectors` 使用 `vec0` 虚表保存 chunk embedding。rowid 对应 `memory_chunks.id` 的内部数值映射。

`memory_entities` 存实体、主题、repo、文件、用户偏好等索引对象。

`memory_edges` 存 chunk、entity、summary node、conversation 之间的父子、引用、相关、派生关系。

`memory_jobs` 存异步任务：embedding、summary seal、projection、dream-ready compaction。

第一阶段 `forget` 采用硬删除 chunk、vector 和相关边。后续如果需要审计型遗忘，再引入 tombstone 状态；当前 schema 没有 status 字段，因此工具层不能只返回“已请求”而不改变 DB。

第一阶段 context checkpoint 由 `ContextCompressorComponent` 生成确定性 anchored summary，并写入 `context_checkpoints`。`ContextModule` 读取同一 conversation 的最新 checkpoint 注入上下文，recent tail 仍保留原文。

## 记忆生命周期

1. 用户消息和 assistant final 先进入 `messages`。
2. runtime 判断是否值得长期保存。
3. MemoryComponent 生成 chunk，写入 `memory_chunks`。
4. embedding job 写入 `memory_vectors`。
5. entity extraction 生成 `memory_entities` 与 `memory_edges`。
6. projection job 更新 `.config/memory/wiki`。
7. context recall 查询 DB，而不是直接查询 wiki。

## 检索策略

召回分三步：

1. keyword、entity、time、source 过滤。
2. `sqlite-vec` topK 语义召回。
3. 按 recency、importance、conversation continuity、source reliability 重排。

召回结果必须包含 provenance，至少包括 chunk id、source kind、source id、score、摘要或正文片段。

## Markdown 投影

`.config/memory/wiki` 用于人工审阅和纠偏。投影由 DB 生成，不能手工成为权威源。

投影建议包含：

- `daily/YYYY-MM-DD.md`
- `topics/<topic>.md`
- `sources/<source>.md`
- `reviews/pending.md`

后续梦境模式可以读取 DB 和 wiki 投影，生成更高层摘要节点，但第一阶段只预留 job kind 和目录。

## 验收标准

- 能创建 `.config/memory/memory.db`。
- 能加载 sqlite-vec 并创建 vec0 表。
- 能写入 message、chunk、embedding。
- 能对一个 query 返回 topK recall。
- 能导出至少一个 Markdown 投影文件。
- 重启后 recall 仍可用。
- 能删除指定 chunk，删除后 recall 不再返回该 chunk。
- 能写入并读取最新 context checkpoint。
