# knowledge-tree 诊断与重构方案

## 诊断

## 一句话结论

flyflor 的"记忆环绕"层有完整的**表结构与信号骨架**，但**语义内核是空的、遗忘是删除的、第二套召回引擎是死的**——它看起来像一个分层语义记忆生命体，实际是"扁平 chunk + 词面 overlap + 硬删除"，无法支撑双北极星中任何一极。

## 一、语义那一路根本不存在（P0，违反真 embedding 红线）

`memory.component.ts:837 embed()` 是 4 维 charCode 玩具：`vector[index%4] += charCodeAt/255` 后归一化。`memory.component.ts:88` 把 `vec0(embedding float[4])` 维度写死；`config.service.ts:244` 的 `embeddingDimensions ?? 4` **从不被 embed() 或建表读取**——是彻底的死配置（grep 确认只在 config.types/config.service 出现，无任何运行时消费）。

后果链：`vectorChunkScores`（:915）走的是 sqlite-vec 真 KNN 语法（`where embedding match vec_f32(?) and k=?`，合法），但喂进去的是 4 维玩具向量，**语义无关文本的余弦距离几乎相同**，向量信号 ≈ 噪声。`chunkRecallCandidates`（:894）里 `score = overlap*2 + vectorScore + importance + recency`——overlap 权重 *2 是唯一真信号。对外 `recordRetrievalTrace`（:302）却标 `strategy="tree+vector+lexical+fact+graph"` 且 trace 带 `distance`，**用占位实现冒充语义能力**。这直接违反"禁止 4 维玩具 embedding，必须真 embedding"红线，也使"无 session 生命体"赖以生存的语义召回完全失效——重建后的"记忆"无法按语义找回。

## 二、所谓"知识树"名不副实：单层扁平，无分层固化、无摄取管线

`treeRecall`（:229）的"tree"是误称：它对 `memory_chunks` 取**最近 500 行**（`chunkRecallCandidates` SQL 硬编码 `limit 500`，与传入的 MAX_CHUNK_SCAN 无关）做多路打分 + 图邻域一次性扩展，**没有 L0→L1 桶封存、没有 SummaryNode、没有 Buffer、没有 scope/global/topic 三类树**。对照 openhuman `tree_source/{types,bucket_seal,store}.rs`：知识应是"树森林 + 桶封存"——leaf 进 L0 buffer，满双闸门（token≥阈值 或 兄弟≥10）封存成上一级**不可变** SummaryNode 并级联向上。flyflor 的 `store()`（:179）是一条 autoincrement INSERT：无 canonicalise、无 chunker（一条进一条出）、无 token 预算、无确定性 ID（重放必重复）、无源级幂等闸门。红线要求的"双树 = Scope 树 + 全文树"在当前代码里**不存在任何对应实现**。

## 三、遗忘是硬删除 + 删后重写，违反"遗忘≠删除/压缩不删原文"（P1）

`docs/forgetting-system.md:5` 明文"遗忘≠删除…压缩成摘要（不删除原文）"。但：
- `fadeChunks`（:344-361）算出 `newImportance` 仅用于发 `forgetting.chunk.faded` 信号，**从不 UPDATE memory_chunks.importance**（全仓无 `updateChunkImportance` 方法，grep 确认）。下周期从原值重算 → 只有"删或不删"两态，无真正按曲线模糊偏移。
- 跌破阈值即 `forgetChunk(id)`（:359），`forgetChunk`（memory.component.ts:331）`delete from memory_vectors/memory_edges/memory_relations/memory_chunks` **硬删除（连图关系一并删）**。
- `compactAgedChunks`（:507-513）**先 forgetChunk(id) 删原文，再 store(summary)**，且 `recordEvent("forgetting.chunk.compacted")` 只把 500 字截断摘要写进 brain，**chunk 的原始内容并未以原文形态入 brain 审计**（注：派生它的对话消息经 `recordMessage` 在 brain，但 memory.db 侧的 durable chunk 内容审计链断裂）。
- `driftGems`（:456）构造 `newSummary=\`[STALE after Xh] ${gem.summary}\`` 但**从不持久化**（crystal.store 无 `updateGemSummary`，grep 确认），只 `markGemStale` 翻状态；docs:65 承诺"由 LLM 执行语义偏移"——实际无 LLM、无 driftVector、无重嵌入。
- 文档/实现不一致：docs 公式 `strength=1/(1+ageHours/24)`（幂律长尾），代码 `applyEbbinghausDecay`（:222）`Math.exp(-age/24)`（纯指数，衰减快得多）。

## 四、遗忘扫描错用召回 API，覆盖不完整（P0，但根因需修正审计断言）

`fadeChunks/ageFacts/compactAgedChunks` 都调 `treeRecall("", MAX_CHUNK_SCAN, {trace:false})` 当全量存储扫描。**审计断言"空查询导致候选过滤丢弃绝大多数行"需要修正**：实测过滤器 `item.score > item.chunk.importance`（:903）在空查询下 `score = 0 + vectorScore + importance + recencyBoost`，而 `recencyBoost`（:1466）`1/(1+ageHours/24)` 恒 >0，故 `score > importance` 几乎恒真——大多数 chunk **能通过过滤器**。fact 过滤 `score > confidence`（:955）同理恒真。**真正的不完整来自两处**：(1) `chunkRecallCandidates` SQL 硬编码 `limit 500` —— 永远只看最近 500 chunk；(2) `treeRecall` 末尾 `.slice(0, limit)` 再砍一刀。结论仍成立——衰减/压缩近乎只作用于最近 500 行，老记忆永远扫不到——但**机制是"limit 500 上限 + slice"而非"过滤器丢弃"**。这是必须供对抗复核的关键修正。

## 五、Scope 第二套召回引擎完全 dead（P1）+ 写入侧入口即崩

`recallFromScope`（scope.store.component.ts:239）只在自身定义与一句 doc 注释出现，**零外部调用**；`ScopeRecallResult`（scope.types.ts:122）只定义+导出从不构造；`scope_recall_log`（scope-schema.sql:19）零 INSERT；`scope.activated`/`scope.recall_mode.started`（scope.service.ts:303-304）**只被 socket.server 订阅做 WS 广播显示，无任何改变召回的 @Subscribe 消费者**（grep `@Subscribe("scope` 为空）。`context.builder.service.ts:36-81 build()` 全程**零 scope 引用**——激活期上下文与平时完全一致。

更糟：写入侧也建不起来。runtime 发 `emit("memory.store", {conversationId, turnId, chunk})`（agent.runtime.service.ts:232），真 chunk 嵌在 `payload.chunk`；但 `ScopeService.onMemoryStore`（scope.service.ts:174）读 `payload.content.toLowerCase()`——**顶层无 content**，存在 active scope 时 `undefined.toLowerCase()` 在 async 订阅回调抛 TypeError，`mirrorChunk` 永不被正确调用，`scope_vectors` 永远为空。整套 scope 语义召回**写入崩、召回死、信号空转**。

## 六、召回每轮跑 3 遍同一棵扁平树（P2）

单轮：`intent.analyzer`（context.intent.analyzer.component.ts:86）`treeRecall(userInput)` 第一遍；`context.builder.build`（:40）`recall()` 内部 `treeRecall` 第二遍（recall 是 `treeRecall(...).chunks` 瘦封装，memory.component.ts:217）；同一 build（:46）`recallFacts()` 内部 `treeRecall` 第三遍（:678 区域，`treeRecall(...).facts` 瘦封装）。**对同一数据集每轮 3 次全量 limit-500 扫描多表并重排**，因 recencyBoost 时间漂移结果可能不一致。对照 openhuman `retrieval/topic.rs:173-233`：倒排粗筛 ≤200 候选 → query **仅 embed 一次** → 候选 cosine rerank → 无向量 legacy 行沉底，全程单遍确定性 tie-break。

## 七、结晶升格是裸计数，无统一 stability、无用户主权、无反思（P2）

`crystal.service.ts:397` 升格闸门是 `reinforced.hitCount >= DEFAULT_READY_THRESHOLD(3)`——纯计数，无时间衰减、无 class 半衰期、无 cue 权重。升格强度（hitCount）与遗忘强度（forgetting 独立 Ebbinghaus）是**两套互不相干标量**，无法形成"证据多→更稳→更慢遗忘"闭环。`generateGemSummary`（:694）是纯模板拼接非模型总结。无 post-turn 反思（crystal 候选只来自 ASK 回答/agent.error），无 user_state（pinned/forgotten）让用户保护/否决一条结晶。

## 为什么这些错共同杀死双北极星

- **杀"无 session 生命体"**：每轮从本地状态重建的前提是"本地状态能按语义找回"。但语义那一路是噪声（错一），遗忘把老记忆物理删除且 importance 衰减不落库（错三/四），scope 宪法层固化记忆写入即崩、召回死（错五），结晶无 stability 闭环（错七）。重建出来的"记忆"是一堆最近 500 行扁平 chunk 的词面匹配——这不是生命体的记忆，是一个滑动窗口缓存。
- **杀"coding 内核能干活"**：coding agent 需要"关于这个仓库/这个 bug 我以前知道什么"的可靠语义+图召回。当前向量噪声 + 单层树 + 召回 3 遍漂移 + scope 死，使工具回路拿到的 KNOWLEDGE TREE / MEMORY RECALL 段落质量不可信，等于让内核蒙着眼干活。

## 真实根因

- R1 (P0, 影响最大): 语义层是占位实现。embed() 4维玩具向量 + vec0 写死 float[4] + embeddingDimensions 死配置，使所有向量召回（memory/scope/crystal 三库）等价噪声，唯一真信号是 lexical overlap*2。没有 EmbeddingProvider 抽象、无 factory、无真 HTTP provider、无维度护栏、无写时阻断——这是违反红线且使整个语义记忆失效的根因。
- R2 (P0/P1): 没有知识树，只有扁平 chunk + 一次图扩展。treeRecall 名不副实：无分层桶封存、无 SummaryNode/Buffer、无 scope/global 双树、无摄取管线（store 是裸 autoincrement INSERT，无 chunker/确定性ID/幂等闸门）。红线要求的'双树'在代码里不存在。
- R3 (P0): 遗忘扫描的覆盖面被 'chunkRecallCandidates 硬编码 limit 500' + 'treeRecall 末尾 slice(limit)' 两道闸门钳死——而非审计所说的过滤器丢弃；衰减只作用于最近 ~500 行，老记忆永远扫不到。根因是'拿单查询 top-k 召回 API 当全表存储扫描'，应改为直接 SQL 全表游标遍历。
- R4 (P1): 遗忘=删除而非模糊。forgetChunk 硬删除（连图关系），compactAgedChunks 先删原文再写截断摘要且原文未入 brain 审计，fadeChunks 的 newImportance 从不落库（无 updateChunkImportance），driftGems 的 newSummary 从不落库（无 updateGemSummary）。违反 docs '遗忘≠删除/压缩不删原文'。
- R5 (P1): Scope 第二套召回引擎全链路 dead——recallFromScope/ScopeRecallResult/scope_recall_log 零调用，激活信号无改变召回的消费者，context.builder 零 scope 引用；且写入侧因 memory.store payload 契约不一致（runtime 发 {chunk} 包裹体 vs ScopeService 读顶层 content/sourceKind）在有 active scope 时抛 TypeError，连镜像都建不起来。信号总线数据契约不一致是直接根因。
- R6 (P2): 召回非单遍——intent.analyzer + recall + recallFacts 每轮对同一扁平树跑 3 次全量重排；recall/recallFacts 是 treeRecall 各取一字段的瘦封装，调用方未复用单次结果。
- R7 (P2): 学习层无统一 stability 标量。结晶升格是裸 hitCount>=3，与遗忘的独立 Ebbinghaus 衰减不耦合；无 class 半衰期、无 cue 权重、无 user_state(pinned/forgotten) 用户主权、无 post-turn 反思沉淀、无可追溯 EvidenceRef。
- R8 (P2): recency-boost 是死功能——LAST_RECALL_KEY/LAST_STORE_KEY 只 setRecoveryState 写、从不 getRecoveryState 读（这两 key），衰减只看 createdAt/updatedAt，docs 承诺的'召回重置衰减计时器'不生效。叠加 docs 公式(幂律 1/(1+t/24))与实现(指数 exp(-t/24))不一致。

## 推荐重构

## 总体形状：在 memory.component.ts 之上立"分层语义树 + 真 embedding + 全表遗忘游标"，复活 scope 召回，统一 crystal stability，全程经 SignalBus，brain 永不删。

### A. 真 embedding（R1，T7 第一优先，守红线核心）
1. 新建 `src/memory/embedding/embedding.provider.ts` 接口（镜像 openhuman `embeddings/provider_trait.rs:6-41`）：`name()/modelId()/dimensions()/signature()/embed(texts):Promise<number[][]>/embedOne(text)`。signature = `provider=X;model=Y;dims=Z` 作向量空间指纹。
2. `OllamaEmbeddingProvider`（照 ollama.rs：POST `/api/embed`，本地 bge-m3/nomic-embed-text，校验返回条数==输入、维度==dims）与 `OpenAiEmbeddingProvider`（照 openai.rs:92-198：POST `/v1/embeddings`，count/dim 双校验）。
3. `createEmbeddingProvider(name,model,dims)` factory（factory.rs:23-52）：**未知名 throw 不静默降级**；保留 `InertEmbeddingProvider`（现 4 维算法重命名）**仅供单元测试**，绝不生产 fallback。
4. `memory.component.ts:88` vec0 建表改 `float[${config.embeddingDimensions}]`；新增 `store_meta(key,value)` 行记 dims+signature，`initialize()` 开库比对不符即 throw（抄 embeddings/store.rs:124-172），堵死"改配置不重建表"腐化。
5. `embed()` 删除玩具实现，改 `await provider.embedOne()`；**store()/recall()/treeRecall() 改 async**（必要破坏性改动）；store 时 `embed` 失败则抛错不写行（写时阻断，bucket_seal.rs:398-426）。向量存紧凑 LE f32 blob 取代现 `JSON.stringify`（:189）。
6. 同步更新写死 `embeddingDimensions:4` 的测试 fixture（tests/scenario/memory.vector.tree.test.ts）。
7. **可选守真零依赖过渡**：若真模型暂不可达，移植 hermes `holographic.py` HRR 相位编码（SHA-256 确定性 → [0,2π) 相位向量）作 SemanticIndex 临时替换 4 维玩具，并暴露 probe/reason/contradict 组合查询为新工具——但这是过渡，T7 终态仍是真模型 embedding。

### B. 分层知识树 + 摄取管线（R2，T7）
1. 新增 `src/memory/tree/` 与三表 `memory_trees / memory_summaries / memory_buffers`（镜像 openhuman store.rs:135-211）。`tree.kind` 用 `'scope'`（每 scope.namespace 一棵，对应 openhuman source）与 `'global'`（全文按天/周折叠，对应 global）——**落地红线'双树=Scope树+全文树'**。
2. `appendLeaf + cascadeSeals + shouldSeal`（照 bucket_seal.rs:311-320 双闸门，token 阈值调小到 ~8k 因本地单用户）；封存写成单个 `this.db.transaction(...)`（bun:sqlite），保证 summary 插入+buffer 清空+父链回填原子；SummaryNode 一旦封存 immutable，更新走 tombstone。
3. `store()` 改为摄取管线：`canonicalise → chunkMarkdown(content,sourceKind,maxTokens) → 确定性 chunk_id = sha256(sourceKind|sourceId|seq|content) 前32hex → INSERT OR REPLACE → embed → appendLeaf`。chunk_id 确定性化是**最高优先零风险项**，立刻获得重放幂等。新增 `memory_ingested_sources` 源级闸门表（document 类一次性物料）。
4. 第一版 summariser 用'拼接+截断'inert 版（对应 InertSummariser），entities/topics 字段**留空别造假**；接入真模型后再换。

### C. 全表遗忘游标 + 模糊不删（R3+R4，T7/T6）
1. `forgetting.service.ts` 的 `fadeChunks/ageFacts/compactAgedChunks` **停止调 treeRecall("")**，改 memory.component.ts 新增的 `*scanAllChunksCursor(batchSize)` / `scanAllFactsCursor` —— 直接 `SELECT ... ORDER BY id LIMIT ? OFFSET ?` 游标全表遍历，无相关性过滤、无 500 上限。
2. `fadeChunks` 算出 `newImportance` 必须 `memory.updateChunkImportance(id, newImportance)`（**新增方法**）持久化，落地"按曲线模糊偏移"；衰减有效年龄起点改 `max(createdAt, lastRecallAt)`（修 R8，并真正读 LAST_RECALL）。
3. `forgetChunk` 硬删除降级为 `archiveChunk`（加 status 列：active/faded/archived；archived 不进召回但保留行+原文），落地"遗忘≠删除"。
4. `compactAgedChunks`：collapse 前先 `brainComponent.recordEvent` **记录 chunk 原始全文**（不是截断摘要），再 archive 原 chunk + store summary（T6 红线 'collapse 前原文先入 brain'）。摘要 v1 截断、v2 接真模型蒸馏。
5. `driftGems` 的 `newSummary` 必须 `crystalStore.updateGemSummary(gemId, newSummary)`（**新增方法**）+ 重嵌入；stale 不是终点——加 Provisional/回升路径（同 pattern_key 再强化且 stability 回升过阈则复 active）。
6. 统一衰减公式：docs 与 code 二选一对齐（建议 code 改幂律 `1/(1+age/24)` 以符 docs 长尾，或反向改 docs），消除文档/实现漂移。

### D. 复活 Scope 召回（R5，T7）
1. 修信号契约：要么 runtime `emit("memory.store", chunk)`（平铺），要么 `ScopeService.onMemoryStore` 改读 `payload.chunk.content/.sourceKind/.id`。**统一 MemoryStorePayload 类型为单一形状**（建议平铺 chunk 字段 + conversationId/turnId 旁挂），加端到端测试覆盖 runtime→scope 路径。
2. `context.builder.build()` 注入 scope 召回：新增 `@Subscribe("scope.activated")` 由 ScopeService 维护"当前活跃 scope"内存态（kernel 不 imperative 调用），build 时若有活跃 scope 则 `scopeStore.recallFromScope(scopeId, userInput, limit)` 结果并入 `## SCOPE RECALL` 段；写 `scope_recall_log`。
3. `onCrystalAskAnswered`（scope.service.ts:202）收紧：用专门的 scope-creation questionId 而非"任意非空 selectedOptionId 即创建所有 pendingNominations"，消除误创建。

### E. 召回单遍（R6，T7）
1. ContextBuilder 与 IntentAnalyzer **复用单次 treeRecall 结果**：runtime 在一轮开始调一次 `treeRecall`，把 `MemoryTreeRecallResult` 经 intent 传入 build；`recall()/recallFacts()` 改为从已算结果取字段，不再各自触发 treeRecall。
2. recall 改两段式（B 完成后）：倒排/lexical 粗筛 ≤200 → `await provider.embedOne(query)` 一次 → 候选 cosine rerank（抄 topic.rs:173-233 含无向量沉底），确定性 id ASC tie-break。新增 `memory_entity_index` 倒排表。

### F. 统一 crystal stability（R7，T7/T6，shadow 先行）
1. `crystal_candidates` 增 `cue_family(explicit/structural/behavioral/recurrence) / class(identity/tooling/style/veto/goal/channel) / evidence_ref(JSON)` 列；pattern_key 不变作聚合键（保 sha256 去重）。
2. 升格闸门从 `hitCount>=3` 改 `stability >= τ_promote`，`stability = Σ(cue_weight × ebbinghaus(Δt) × ln(1+hitCount))`，class 分级半衰期（identity 90d / veto 60d / tooling/goal 30d / style 14d / channel 7d，照 stability_detector.rs:53）。**先 shadow 计算只记日志**，验证后再切闸门。
3. `crystal_gems`+`memory_fact` 加 `user_state(auto/pinned/forgotten)` 列；driftGems/ageFacts/fadeChunks 衰减前短路：pinned→永不衰减，forgotten→归档且阻止 reinforce 复活（落地"USER 宪法"在记忆层的硬覆盖，照 profile.rs:131）。
4. 补 post-turn 反思钩子（订阅 turn 完成信号）：确定性 cue 快路（"I prefer/记住/以后"）直接落 fact/crystal 候选；复杂 turn 再 best-effort LLM 结构化总结，per-session 节流 + per-turn 去重，失败吞错记 warn（照 reflection.rs:457/514）。`listActiveGems` 加 per-class top-N 预算防无界增长。

### G. 薄编排层（可选，hermes MemoryManager 思想）
引入 `MemoryOrchestrator` DI Component，把 MemoryComponent 包成 'builtin' provider，对 context.builder 暴露 recall 时遍历 + try/catch 故障隔离（记忆失败不冒泡进上下文构建）；保留一外部 provider 上限。MemoryComponent 存储逻辑不动。

### 改完后的数据/控制流
一轮：runtime 持久消息→brain(原文不可删) + memory(messages) → 摄取管线 store(chunk: 确定性ID + 真 embed + appendLeaf 可能触发 cascadeSeals) → emit memory.store(统一payload) → ScopeService 镜像到 scope_vectors → runtime 调一次 treeRecall(两段式: 倒排粗筛+真 embed cosine rerank, 含 global 树 summary + 活跃 scope 树召回) → intent/builder 复用同一结果 → 注入 ## KNOWLEDGE TREE / SCOPE RECALL / FACTS。后台：forgetting 周期全表游标遍历 → updateChunkImportance 模糊偏移（不删）→ 超龄 collapse 前原文入 brain → archive；crystal stability 周期重算升格/漂移，pinned/forgotten 短路。

## 参考映射

- **EmbeddingProvider trait + factory + 真 HTTP provider + signature 分桶 + 写时阻断（未知名 throw 不降级）** ← openhuman (embeddings/provider_trait.rs, factory.rs, openai.rs, ollama.rs; memory/tree/score/embed/mod.rs) → 新建 src/memory/embedding/{embedding.provider.ts, ollama.provider.ts, openai.provider.ts, factory.ts}；替换 memory.component.ts:837 embed()，store/recall/treeRecall 改 async
- **分层知识树三表 + appendLeaf/cascadeSeals/shouldSeal 双闸门 + 单事务封存 + immutable SummaryNode** ← openhuman (memory/tree/tree_source/{types,bucket_seal}.rs, store.rs:135-211) → 新建 src/memory/tree/ 与 sql 中 memory_trees/memory_summaries/memory_buffers；tree.kind='scope'|'global' 落地红线双树
- **摄取管线 canonicalise→chunk→确定性 chunk_id(sha256前32hex)→INSERT OR REPLACE→异步 extract/seal + 源级幂等闸门** ← openhuman (memory/tree/ingest.rs, chunker.rs, types.rs:256-277, store.rs:620-633) → 重写 memory.component.ts:179 store()；新增 chunkMarkdown 与 memory_ingested_sources 表（确定性 ID 为最高优先零风险移植）
- **单遍语义检索：实体倒排粗筛≤200 → query 仅 embed 一次 → cosine rerank → 无向量行沉底 → 确定性 tie-break** ← openhuman (memory/tree/retrieval/topic.rs:173-233, search.rs, store.rs:113-124) → memory.component.ts treeRecall/chunkRecallCandidates 改两段式；新增 memory_entity_index 倒排表；runtime 复用单次结果消除 3 遍重复
- **per-(node,model_signature) 向量旁表 + dim 列自校验 + store_meta 维度门禁 + LE f32 blob** ← openhuman (memory/tree/store.rs:77-87, embeddings/store.rs:124-172, score/embed/mod.rs:88-123) → memory.component.ts:88 vec0 建表参数化 float[${dims}]；新增 store_meta 表 initialize() 比对；向量存 LE blob 取代 JSON.stringify(:189)
- **统一 stability 标量驱动升格/降级/淘汰/遗忘 + cue_family/class 半衰期 + ln(1+count) 边际递减** ← openhuman (learning/stability_detector.rs:108-129, candidate.rs:131) → crystal.service.ts:397 升格闸门从 hitCount>=3 改 stability>=τ（shadow 先行）；crystal_candidates 增 cue_family/class/evidence_ref 列
- **用户主权 Pinned(∞)/Forgotten(0) 在衰减公式前短路 + Pinned 永不删** ← openhuman (learning/stability_detector.rs:117-122/523, profile.rs:131, cache.rs:76) → crystal_gems + memory_fact 加 user_state 列；forgetting driftGems/ageFacts/fadeChunks 衰减前短路（落地 USER 宪法硬覆盖）
- **post-turn 双轨反思（确定性 cue 快路 + LLM 慢路）+ per-session 节流 + per-turn 去重 + best-effort 吞错** ← openhuman (learning/reflection.rs:457/514/421, user_profile.rs) → 新增 src/crystal 反思钩子订阅 turn 完成信号；产出喂回 crystal 候选缓冲；复用 BrainComponent.recordEvent 审计
- **遗忘=多档生命周期降级回升 + per-class top-N 预算（非删/留二元）** ← openhuman (learning/stability_detector.rs:316, profile.rs:96) → forgetting.service.ts forgetChunk→archiveChunk(加 status 列)；driftGems stale 加回升路径；listActiveGems 加 per-class 预算
- **MemoryManager 单一集成点 + provider 遍历扇出 + 逐 provider try/except 故障隔离 + 一外部上限** ← hermes-agent (agent/memory_manager.py:244-492, memory_provider.py:42-262) → 可选新增 MemoryOrchestrator DI Component 包 MemoryComponent 为 builtin；context.builder 依赖 Orchestrator 获故障隔离
- **recall 注入前 sanitize/注入扫描 + 不可见 unicode 检测；常驻笔记冻结快照保 prefix-cache** ← hermes-agent (tools/memory_tool.py:93/157/410/482) → context.builder.service.ts:63 renderRecall 前加 sanitize 步骤（recall 内容确实进模型上下文）
- **HRR 相位编码（确定性零模型依赖语义 + probe/reason/contradict 组合代数）作真 embedding 过渡或补充** ← hermes-agent (plugins/memory/holographic/{holographic,store,retrieval}.py) → 可选 src/memory/embedding/ 临时 SemanticIndex 替换 4 维玩具；contradict 作记忆卫生工具（终态仍换真模型）

## 红线核对

逐条确认：

1. **无 session（模型永不作连续性来源，每轮从本地重建）**：方案不引入任何模型侧会话状态；真 embedding provider 只做无状态 embed 调用，向量落 memory.db；每轮仍从 brain/memory 重建。强化——B/C 让重建出的语义记忆真正可用。✅

2. **双北极星**：A（真 embedding）+ B（分层树）+ E（单遍召回）直接让 coding 内核拿到可信语义+图证据干活；C/D/F/G 让记忆机制（遗忘不删/scope 复活/stability/反思）环绕内核。两极都被服务。✅

3. **brain.db 不可变月度全量审计，collapse 前原文先入 brain，绝不删 brain**：C4 明确 compactAgedChunks collapse 前 `brainComponent.recordEvent` 记录 **原始全文**（修复当前只记截断摘要的审计断裂）再 archive；方案全程不 delete brain；archiveChunk 只动 memory.db status 列。✅（且修复了现状的违规）

4. **memory.db = 当前热记忆**：新增的 trees/summaries/buffers/entity_index/store_meta 全在 memory.db；向量/HRR/stability 写 memory.db；user_state 列在 memory/crystal。✅

5. **kernel 纯编排，横切能力经 SignalBus @Subscribe 自持状态，kernel 不 imperative 调子系统**：D2 的活跃 scope 由 ScopeService 经 `@Subscribe("scope.activated")` 自持，context.builder 通过既有注入读取而非 kernel 命令；forgetting/crystal 仍由周期 + @Subscribe 驱动；E1 的"复用单次 treeRecall"经 intent payload 传递不新增 kernel→子系统命令调用。✅

6. **SignalBus 血管层；guard.* ask 必须有 responder（ASK>Confirm）**：本子系统不触碰 guard 回路；D3 收紧 onCrystalAskAnswered 的 ASK 语义判定，不削弱 ASK>Confirm。✅

7. **WS 只对接 guard/db/chat，其余只作广播显示**：方案不让 WS 命令 memory/scope/crystal/forgetting；scope.activated 等仍仅 socket.server 广播显示（现状即如此，保持）。✅

8. **禁 mock/fake/deterministic 模型供应商；禁 4 维玩具 embedding；禁静默 fallback**：A 是核心整改——真 HTTP embedding provider，factory 未知名 throw，InertEmbeddingProvider 仅测试用绝不生产 fallback，embed 失败写时阻断（显式可观测可审计），store_meta 维度门禁开库即报错。HRR 仅作明示过渡且零模型依赖（非冒充模型）。✅

9. **提示词双副本，runtime 只加载 .md，不内嵌 TS**：摘要 summariser v2 接真模型时，其 prompt 必须落 name.md + name.zh.cn.md，runtime 加载 .md；反思 LLM 提示同理。本子系统不新增内嵌 TS 提示词。✅（实施约束已写明）

10. **真 embedding（重申）**：vec0 维度参数化 + 真 provider + 维度护栏，彻底替换 float[4] 玩具，是方案第一优先。✅

## 轨道映射

主要落 **T7（知识树：真 embedding、分层树、摄取管线+job、召回单遍、遗忘归档）**，部分落 **T6（摘要：collapse 前先入 brain、模型蒸馏）**，少量触 **T3（工具：memory 工具 sanitize/确定性 ID 影响 memory_store 工具）**。与现有 master-plan 的关系与补强：

- **与 master-plan 高度一致**：refactor-master-plan.md:47 T7 已明列"真 embedding、分层树、摄取管线+job、召回单遍、遗忘归档"，:46 T6 已列"collapse 前先入 brain"，:28 知识树小节已点名"4 维玩具 embedding/单层统一树/treeRecall('') 当扫描/scope 第二套引擎 dead/payload 不匹配"。本诊断**逐条用 file:line 坐实了 plan 已识别的方向**，不与之冲突。

- **补强点 1（修正一处审计/认知偏差）**：plan 与初始审计都暗示"treeRecall('') 过滤丢弃绝大多数行"。实证表明真正的扫描不完整来自 `chunkRecallCandidates` 硬编码 `limit 500` + `treeRecall` 末尾 `slice(limit)`，过滤器在空查询下几乎恒真。整改应是"全表 SQL 游标遍历"而非"调大过滤阈值或修过滤器"——这改变了 T7 遗忘子项的具体实现。

- **补强点 2（master-plan 未显式拆出的项）**：(a) `embeddingDimensions` 是死配置（需 vec0 建表参数化 + store_meta 门禁）；(b) `fadeChunks` newImportance / `driftGems` newSummary **从不持久化**（需新增 updateChunkImportance/updateGemSummary）；(c) recency-boost 死功能（LAST_RECALL/STORE 只写不读）；(d) docs 公式(幂律)与 code(指数)漂移。这些是 T7 内更细的待办，建议补进 plan 的 T7 验收清单。

- **补强点 3（跨 plan 的学习层）**：crystal 统一 stability + user_state + post-turn 反思（来自 openhuman learning 与 crystal-system.md / soul 宪法 :18）横跨 T6/T7，建议在 plan 中新增一条"T7.5 学习闭环：stability 统一升格/遗忘 + USER 宪法硬覆盖 + 反思沉淀"，因为它把 crystal 与 forgetting 两个当前互不相干的标量打通，是双北极星"生命体"一极的关键，却未在 12 轨里单列。

- **依赖**：T7 依赖 T2（原生 tool 协议）已就绪；本方案 A（async embedding）会令 store/recall 变 async，需确认 T2/T3 的工具回路已能 await memory_store/memory_recall 工具。

## 复核结论

- 总体置信: high
  - [confirmed] 遗忘扫描不完整的真正机制是 chunkRecallCandidates 硬编码 SQL limit 500 + treeRecall 末尾 slice(limit)，而非'空查询过滤器丢弃绝大多数行'；过滤器在空查询下因 recencyBoost>0 几乎恒真。整改应是全表游标遍历。 (src/memory/memory.component.ts:886,903,955,1466; src/forgetting/forgetting.service.ts:335)
    memory.component.ts:882-887 SQL 硬编码 `order by created_at desc limit 500`（chunk），rankFacts:943-948 同样 `limit 500`。treeRecall:234-235 `chunkRecallCandidates(query, Math.max(limit*8,32))` 后 `.slice(0, limit)`；forgetting.service.ts:335/378/481 三处都用 treeRecall("", MAX_CHUNK_SCAN/MAX_FACT_SCAN) 且 MAX_CHUNK_SCAN=MAX_FACT_SCAN=500（:43,46）。过滤器分析也对：chunk 过滤器:903 `item.score > item.chunk.importance` 中 score=overlap*2+vectorScore+importance+recencyBoost（:894），recencyBoost=1/(1+ageHours/24) 严格>0（:1465-1467），空查询下 overlap=0 仍有 score=importance+recencyBoost>importance，恒真；fact 过滤器:955 `score>confidence` 同理 currentBoost=recencyBoost>0 恒真。故限制召回数量的确是 SQL limit 500 + slice，而非过滤器丢行。诊断机制正确。
  - [confirmed] embed() 是 4 维 charCode 玩具且 config.embeddingDimensions(默认4) 是死配置——从未被 embed() 或 vec0 建表读取；grep 全仓 embeddingDimensions 仅出现在 config.types.ts/config.service.ts。 (src/memory/memory.component.ts:837,88; src/config/config.service.ts:244)
    embed():837-845 确为 4 元素数组 `[0,0,0,0]` 累加 charCode/255 再 hypot 归一化，写死 4 维。建表 initialize():88 `create virtual table ... using vec0(embedding float[4])` 维度硬编码字面量 4。config.service.ts:244 `embeddingDimensions: memory.embeddingDimensions ?? 4`。全仓 grep embeddingDimensions 仅命中 config.types.ts:184,190 与 config.service.ts:244，零运行时消费（embed 与 vec0 均不读取该配置）。完全成立。
  - [confirmed] Scope 第二套召回引擎全链路 dead 且写入侧入口即崩：recallFromScope 零外部调用、无改变召回的 scope.activated 消费者、context.builder 零 scope 引用；runtime emit('memory.store',{conversationId,turnId,chunk}) 与 ScopeService.onMemoryStore 读 payload.content.toLowerCase() 形状不匹配，有 active scope 时抛 TypeError。 (src/scope/scope.store.component.ts:239; src/scope/scope.service.ts:174; src/kernel/agent.runtime.service.ts:232; src/context/context.builder.service.ts:36)
    写入侧崩溃确认：agent.runtime.service.ts:232 唯一发射点 emit("memory.store", { conversationId, turnId, chunk }) 是带 chunk 嵌套字段的包装对象；scope.service.ts:40 类型声明 MemoryStorePayload = MemoryChunk | MemoryStoreInput（二者 content/sourceKind 均在顶层，见 memory.types.ts:59-64），onMemoryStore:174 直接 `payload.content.toLowerCase()`。包装对象上 payload.content===undefined → TypeError。早返回:170 `activeScopes.length===0` 仅保护无 active scope 情形，有 active scope 即崩。dead-code 确认：recallFromScope 在 scope.store.component.ts:239 定义，全仓除自身与 doc 注释(:86,306)外零调用；scope.activated 仅在 scope.service.ts:303 发射、socket.server:223 转发，无任何 @Subscribe("scope.activated") 改变召回的消费者；context.builder.service.ts:36 build() 仅调 recall(:40)/recallFacts(:46)，全文件零 scope 引用（context/ 下 scope 命中仅为 intent 标签 memory_scoped/task_scoped）。三段断言全部成立。
  - [confirmed] 遗忘是硬删除+删后重写且衰减不落库：forgetChunk 物理 delete；compactAgedChunks 先 forgetChunk 删原文再 store 截断摘要；fadeChunks newImportance 与 driftGems newSummary 从不持久化（无 updateChunkImportance/updateGemSummary）。违反 docs/forgetting-system.md '遗忘≠删除/压缩不删原文'。 (src/memory/memory.component.ts:331; src/forgetting/forgetting.service.ts:344,456,507; src/crystal/crystal.store.component.ts:382)
    forgetChunk:331-339 物理 `delete from memory_vectors/memory_edges/memory_relations/memory_chunks`，无软删/归档。compactAgedChunks:479-518 先 forgetChunk(chunk.id):507 删原文，再 store({content:summary, importance*0.5}):508-513；buildCompactedSummary:535-550 将 content 截到 500 字符（:537-540），原始全文永久丢失，brain 事件:502 也只记截断 summary。fadeChunks:344 newImportance 计算后仅 emit signal:352 + 条件 forgetChunk:359，从不写回 importance。driftGems 漂移分支:450 仅 markGemStale（只改 status，crystal.store:382-389），newSummary `[STALE after Xh]...`:456 仅 emit signal:458，从不写 gem 行。全仓 grep 无 updateChunkImportance/updateGemSummary（crystal.store 仅有 updateGemConfidence:366 与 markGemStale:382）。注意细微之处：fact 的 newConfidence 与 gem 非漂移分支 newConfidence 确有持久化（ageFacts upsert / updateGemConfidence:445），但 chunk importance 与 gem summary 的衰减确实不落库——与断言一致。整体成立。
  - [confirmed] 召回每轮对同一扁平树跑 3 遍 treeRecall：intent.analyzer + builder.recall(瘦封装→memory:217) + builder.recallFacts(瘦封装→memory:678)；调用方未复用单次结果。docs 公式 1/(1+t/24) 与 applyEbbinghausDecay 的 exp(-t/24) 不一致。 (src/context/context.intent.analyzer.component.ts:86; src/context/context.builder.service.ts:40,46; src/memory/memory.component.ts:217; src/forgetting/forgetting.service.ts:222)
    三遍 treeRecall 确认：intent.analyzer.component.ts:86 buildCluePacket 调 treeRecall(input.userInput, maxRecall);builder.service.ts:40 recall→memory.component.ts:217 `return this.treeRecall(query,limit,options).chunks`（瘦封装，丢弃除 chunks 外全部字段）;builder.service.ts:46 recallFacts→memory.component.ts:678 `return this.treeRecall(query,limit,{trace:false}).facts`（瘦封装，只取 facts）。三处独立调用、入参 query 同为 userInput、无单次结果复用。同一轮内 builder.build 与 intent.analyzer 各跑一次，且 build 内 recall+recallFacts 又各跑一次 treeRecall，共 3 次全树计算。公式不一致确认：召回 recencyBoost memory.component.ts:1467 = 1/(1+ageHours/24)（双曲衰减）；forgetting applyEbbinghausDecay:222 = Math.exp(-clampedAge/24)（指数衰减），两套子系统用了数学上不同的衰减函数。断言成立。
- 修正: Claim 4 措辞需收紧：'衰减不落库'仅对 chunk importance 与 gem summary 成立。实际上 fact confidence 经 ageFacts(forgetting.service.ts:376+) 的 upsert 路径会落库，gem 在非漂移分支也通过 updateGemConfidence(crystal.store:366, 经 driftGems:445 调用)落库 newConfidence。准确表述应为：'chunk 衰减后的 newImportance 与 gem 漂移后的 newSummary 从不持久化（无 updateChunkImportance/updateGemSummary）'，而非笼统的'衰减不落库'。
- 修正: Claim 1 与 Claim 4/5 的扫描限制是同一根因的不同表述：forgetting 三相(fadeChunks/ageFacts/compactAgedChunks)全部经 treeRecall("", 500) 受 SQL limit 500 + slice(limit) 双重截断；综合报告应将'遗忘扫描不完整'与'召回扫描不完整'合并为单一根因(treeRecall 无全表游标)，避免重复计为两个独立缺陷。
- 修正: Claim 3 写入侧崩溃是真实的运行时 bug 而非纯 dead-code：onMemoryStore(scope.service.ts:174) 在任何 active scope 存在时 100% 抛 TypeError，应按'P0 运行时崩溃'而非'dead code'定级；其严重性高于 recallFromScope 的纯死代码部分。

## 开放问题

- 真 embedding provider 的部署形态拍板：本地 Ollama(bge-m3/nomic, 零外网、单用户友好) 还是云 OpenAI 兼容端点？维度选 768 还是 1024？这决定 vec0 建表维度、store_meta signature、以及是否需要 HRR 作离线过渡。
- embedding/store/recall 改 async 是必要破坏性改动——需确认 T2/T3 的工具回路与 context.builder 调用链已全部支持 await，且 forgetting 周期任务能容忍 async 全表扫描的耗时（是否需要分批 yield 防阻塞 turn loop）。
- '双树' 的 global 树折叠粒度：按天/周/月哪一级作 L1？本地单用户场景 token 阈值定多少（openhuman 50k，建议 8k）？以及 scope 树与 global 树召回结果如何加权合并进上下文（覆盖 vs 并列 vs scope 优先）。
- 遗忘从硬删改 archive 后，archived 行的最终归宿：永久保留在 memory.db（库无界增长）还是定期迁移到 brain 月度库后从 memory 清理（清理本身是否算'删 memory 热记忆'而非'删 brain'，需确认不违反红线）。
- crystal stability 统一闸门切换策略：shadow 期多久、用什么指标判定'新闸门不劣于 hitCount>=3'才正式切换？现有已升格的 Gem 是否需要按新公式回溯重算 stability（迁移风险）。
- docs 与 code 的衰减公式分歧（幂律 vs 指数）以哪个为准——是改 code 贴合 docs 的长尾哲学，还是改 docs 承认指数实现？这影响老记忆的实际存活时长，属产品语义取舍。
- post-turn 反思的 LLM 调用预算与触发阈值：哪些 turn 值得花一次模型调用做反思？per-session 节流上限多少？反思 prompt 的 .md/.zh.cn.md 双副本由谁撰写与审定。
- 是否引入 hermes 式 MemoryOrchestrator 薄层（故障隔离 + 未来多 provider），还是保持 MemoryComponent 直接注入——前者增一层抽象成本，后者记忆 SQL 异常会冒泡进 context 构建。需 owner 权衡当前是否值得。