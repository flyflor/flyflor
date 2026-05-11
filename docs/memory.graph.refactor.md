# Flyflor 海马体记忆系统重构方案 v2

> 状态：设计阶段，未开始实现
> 包含：架构 DAG、晶体智力候选完整逻辑、遗忘曲线、无 session 上下文装配、晶体偏移防控、事件/项目固化时机

---

## 一、当前架构 DAG（As-Is）

```
用户消息
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  handleMessage（并行准备）                                        │
│                                                                   │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  ┌─────────┐ │
│  │ memory.      │  │ loadSkills  │  │ loadMcp   │  │ preRoute│ │
│  │ buildPrompt  │  │ selectSkills│  │ Servers   │  │ LLM call│ │
│  └──────┬───────┘  └─────────────┘  └───────────┘  └────┬────┘ │
│         │                                                 │      │
│   ┌─────┴─────────────────────────────┐                  │      │
│   │ 4 路并行查询                        │                  │      │
│   │ ① session.recentMessages (SQLite) │                  │      │
│   │ ② sqlite.search (MemoryRecord)    │                  │      │
│   │ ③ qdrant.search (ANN)             │                  │      │
│   │ ④ crystal.recall (skill 评分)     │                  │      │
│   └───────────────────────────────────┘                  │      │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────┐
│  runBlackboard (条件触发)         │
│  route decision → direct / board  │
│  若 board：                       │
│    worker plan → 多轮讨论          │
│    收敛 / needs-user / 封顶        │
└──────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  主模型生成回答                                                     │
│  system = [memory | skill | mcp | blackboard | memoryAction]      │
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  rememberTurn（串行，热路径）                                                  │
│                                                                               │
│  ① session.recordTurn → SQLite session history                               │
│  ② parse MemoryActions → MemoryCandidate[]                                   │
│     (weightsFromAction → matrix → importance score)                           │
│  ③ autoPromoteExplicit → markdown.promoteCandidate                           │
│     → sqlite.addSearchRecord → qdrant.upsert（异步fire-forget）               │
│  ④ session.consolidate → HistoryEntry[]                                       │
│  ⑤ crystal.recordTurn（见晶体智力流水线 §2）← 【热路径】                       │
│  ⑥ extractRuntimeReflectionCandidates（LLM调用，~500ms–2s）← 【热路径阻塞】   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**当前痛点（标注在 DAG 中）：**
- ⑥ 每次 turn 都同步调用一次 LLM 做反思提取 → **+500ms–2s 阻塞**
- ③ Qdrant 是 fire-forget 但 crystal.recordTurn 仍在热路径
- Qdrant 使用哈希伪向量，与 Crystal recall 功能重叠
- Crystal recall 是纯 JS 逻辑（symbol + cosine），不查数据库 ANN

---

## 二、晶体智力（Crystal Intelligence）候选流水线（当前实现完整图）

```
来源 A：runtime.reflection.ts（热路径 LLM 调用）
  LLM → crystal.reflection.md prompt
  → ExtractedReflectionItem[]
  → CrystalCandidateInput（含 evidence[]）

来源 B：neural/memory candidates（MemoryAction 提取）
  MemoryAction → MemoryCandidate → MemoryRecord（promoted）
  → candidateFromPromotedMemory()
  → CrystalCandidateInput（evidence = confidence + importance）

来源 C：session history（consolidate 后的 HistoryEntry）
  HistoryEntry → buildReflectionCandidate()
  → evidence weight = 0（"source material, not crystallized skill"）

                    ┌──────────────────────────────────┐
                    │   crystal.recordTurn()            │
                    │                                   │
  A ──────────────► │   buildReflectionCandidate()      │
  B ──────────────► │   → normalizeSymbols()            │
  C ──────────────► │   → dynamicBucketId()             │
                    │   → normalizeCoordinates()        │
                    └────────────┬─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────┐
                    │   store.upsertCandidate()    │  ← SurrealDB reflection_candidate
                    └────────────┬────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────────────────────────────────┐
                    │   crystallizeCandidate()                                │
                    │                                                         │
                    │   scoreEvidence(evidence[])                             │
                    │   = avg(clamp01(weight)) per evidence item              │
                    │                                                         │
                    │   ┌──────────────────────────────────────────────┐     │
                    │   │  Evidence Weight 裁判表：                      │     │
                    │   │                                                │     │
                    │   │  来源                        weight            │     │
                    │   │  ──────────────────────────  ───────          │     │
                    │   │  history（C类，session）       0.0  → 不结晶   │     │
                    │   │  runtime-direct-reflection    0.0  → 不结晶   │     │
                    │   │  blackboard-unverified        0.0  → 不结晶   │     │
                    │   │  blackboard-needs-user        0.65 → 可结晶   │     │
                    │   │  blackboard-converged         0.8  → 可结晶   │     │
                    │   │  promoted-memory-confidence   (record.conf)   │     │
                    │   │  promoted-memory-importance   (record.imp)    │     │
                    │   └──────────────────────────────────────────────┘     │
                    │                                                         │
                    │   if scoreEvidence <= 0 → return undefined（不结晶）   │
                    └────────────┬────────────────────────────────────────────┘
                                 │ scoreEvidence > 0（通过质量门）
                                 ▼
                    ┌─────────────────────────────────────────┐
                    │   生成 ReflectionAtom                    │
                    │   id = "atom-{candidateId}"             │
                    │   evidenceScore = scoreEvidence()       │
                    │   confidence = evidenceScore            │
                    │   bucket / symbols / coordinates 继承   │
                    └────────────┬────────────────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────────────────────────────────┐
                    │   store.findSkill(stableSkillId)                     │
                    │   stableSkillId = hash(bucket + symbols[:6])         │
                    │                                                       │
                    │   ┌─────────────────────────────────────────────┐   │
                    │   │  mergeCrystalSkill(existing?, incoming)      │   │
                    │   │                                               │   │
                    │   │  support = existing.support + incoming.support│  │
                    │   │  confidence = weighted avg（按 support 比）    │   │
                    │   │  method = 取 evidenceScore 更高者             │   │
                    │   │  symbols = union（去重归一化）                 │   │
                    │   │  coordinates = weighted avg                  │   │
                    │   │  evidenceScore = max(existing, incoming)     │   │
                    │   │  sourceAtomIds = union                       │   │
                    │   └──────────────────────────────────────────────┘  │
                    └────────────┬─────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────┐
                    │  store.upsertAtom()  → SurrealDB atom        │
                    │  store.upsertSkill() → SurrealDB crystal_skill│
                    └─────────────────────────────────────────────┘

                    召回路径（crystal.recall）：
                    ┌─────────────────────────────────────────────────────────────┐
                    │  store.listSkills(query, symbols, limit)                    │
                    │  recallCrystalSkills(request, skills[])                     │
                    │                                                              │
                    │  4 路评分（每路 0-1，取平均）：                               │
                    │    ① bucketScore   = bucket 是否匹配（0/1）                  │
                    │    ② symbolScore   = Jaccard overlap                        │
                    │    ③ coordinateScore = cosine similarity（coordinates 空间） │
                    │    ④ confidenceScore = (skill.confidence + support_ratio)/2  │
                    │                                                              │
                    │  score = (①+②+③+④) / 4，过滤 > 0，取 top-K                │
                    └─────────────────────────────────────────────────────────────┘
```

**结晶条件总结（质量门）：**
> 只有经黑板讨论（converged 或 needs-user）或被用户显式提升（promoted memory）的知识才能结晶为 Skill。
> 纯 session history 和 direct turn 的反思候选 weight=0，**永远不会结晶**。
> 这是设计意图：Skill 代表验证过的方法论知识，不是随机会话片段。

---

## 三、新架构 DAG（To-Be）

```
用户消息
  │
  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  handleMessage（并行，热路径）                                          │
│                                                                        │
│  ┌─────────────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────┐ │
│  │ memory.buildPrompt  │  │ loadSkills  │  │ loadMcp  │  │preRoute│ │
│  │ (新：概念激活装配)    │  │ selectSkills│  │ Servers  │  │LLM call│ │
│  └──────┬──────────────┘  └─────────────┘  └──────────┘  └───┬────┘ │
│         │                                                      │      │
│   ┌─────┴──────────────────────────────┐                       │      │
│   │  2 路并行查询（代替原来 4 路）        │                       │      │
│   │  ① Redis ff:ctx:{userId} ring buffer│                       │      │
│   │     (最近 N 轮对话，连贯性保障)       │                       │      │
│   │  ② SurrealDB 概念激活（spreading    │                       │      │
│   │     activation）                    │                       │      │
│   │     → memory_node + skill ANN       │                       │      │
│   └────────────────────────────────────┘                       │      │
└──────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌────────────────────────────────┐
│  runBlackboard（不变）           │
│  route → direct / board         │
└────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  主模型生成回答（不变）                                              │
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  rememberTurn（异步，不阻塞响应）                                          │
│                                                                            │
│  ① session.recordTurn → SQLite 审计 log + Redis ring buffer               │
│  ② parse MemoryActions → MemoryCandidate（只处理 Markdown 层更新）         │
│  ③ autoPromoteExplicit → markdown.promoteCandidate（不变）                │
│  ④ 异步构建 Episode（无 LLM）                                              │
│       extractConcepts()（matrix/TfIdf，无 LLM）                           │
│       computeImportance()（weightsFromAction 逻辑保留）                    │
│       computeStability(importance) → TTL                                  │
│       HSET ff:ep:{userId}:{id}  EXPIRE TTL                                │
│       ZADD ff:cq:{userId} score=(now+TTL×0.8) {id}                       │
│       LPUSH ff:ctx:{userId} ... LTRIM 0 11                                │
│  ⑤ 若有 blackboard converged/needs-user：                                 │
│       写 晶体候选 evidence metadata 到 episode（sourceKind 携带证据权重）    │
│                                                                            │
│  ← 不再有同步 LLM 反思调用，⑥ 已完全移除热路径                              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 四、整合与晶体智力候选 DAG（新，异步路径）

```
Redis ff:cq:{userId}（整合候选队列，ZSET）
  │
  │  定期扫描（每 10 分钟）+ keyspace 通知（兜底）
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  ConsolidationWorker.run()                                        │
│                                                                   │
│  ZRANGEBYSCORE ff:cq:{userId} 0 {now}（预期过期前 20%）           │
│  → episodeId[]                                                    │
│                                                                   │
│  对每个 episode：                                                  │
│    HGETALL ff:ep:{userId}:{id}（读完整 episode，数据还活着）        │
│    若 key 已消失 → 记录遗忘事件，ZREM，跳过                         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  SurrealDB ANN 相似度预查                                          │
│  SELECT * FROM episode WHERE userId={userId}                      │
│    ORDER BY vector::similarity::cosine(embedding, $ep.embedding) │
│    LIMIT 5                                                        │
│                                                                   │
│  similarity > 0.85 → MERGE 路径                                   │
│  similarity ≤ 0.85 → LLM 决策路径                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┴─────────────┐
              ▼                          ▼
   ┌─────────────────────┐   ┌──────────────────────────────┐
   │  MERGE 路径          │   │  LLM 决策路径                 │
   │  无需 LLM            │   │  crystal.reflection.md prompt│
   │  直接追加 episode    │   │  → action: reinforce /       │
   │  到现有 memory_node  │   │         consolidate /        │
   │  更新图边权重         │   │         discard              │
   └──────────┬──────────┘   └───────────┬──────────────────┘
              │                          │
              └────────────┬─────────────┘
                           │
              ┌────────────┴──────────────────────────────────┐
              │                                               │
              ▼                                               ▼
     ┌─────────────────┐                          ┌─────────────────┐
     │  REINFORCE       │                          │  DISCARD        │
     │                 │                          │                 │
     │  new_stability  │                          │  DEL ff:ep:...  │
     │  = S × 2.5      │                          │  ZREM ff:cq:... │
     │  EXPIRE 更新    │                          │  记录遗忘事件    │
     │  ZADD 更新队列  │                          └─────────────────┘
     └─────────────────┘
              │
              ▼（CONSOLIDATE 路径）
┌──────────────────────────────────────────────────────────────────────────┐
│  写 SurrealDB episode                                                     │
│  INSERT episode {content, embedding, importance, sourceKind, concepts,   │
│                  createdAt, lastAccessedAt, userId, ...}                  │
│                                                                           │
│  图边操作：                                                                │
│    RELATE episode:prev → episode:curr   （next_context，时间链）           │
│    RELATE episode:curr → episode:similar（similar_ep，ANN 阈值边）         │
│                                                                           │
│  DEL ff:ep:{userId}:{id}                                                  │
│  ZREM ff:cq:{userId} {id}                                                 │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  晶体智力候选升格门（核心）                                                 │
│                                                                           │
│  查询同 userId + 概念重叠的 episode clusters：                              │
│  SELECT count() FROM episode WHERE userId={userId}                        │
│    AND concepts CONTAINSANY $ep.concepts                                  │
│    GROUP BY concepts                                                      │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────┐             │
│  │  Evidence Weight 裁判（保留并扩展现有逻辑）               │             │
│  │                                                          │             │
│  │  episode.sourceKind          → 基础 evidence weight     │             │
│  │  ────────────────────────────  ─────────────────────    │             │
│  │  "direct"                      0.0   → 不计入候选分数    │             │
│  │  "blackboard-unverified"        0.0   → 不计入候选分数   │             │
│  │  "blackboard-needs-user"        0.65  → 计入候选分数     │             │
│  │  "blackboard-converged"         0.8   → 计入候选分数     │             │
│  │  "explicit"（显式 memory action）0.9   → 计入候选分数    │             │
│  │                                                          │             │
│  │  evidence_cluster_score =                               │             │
│  │    Σ(episode.importance × sourceWeight) / cluster_size  │             │
│  │                                                          │             │
│  │  升格条件（晶体候选）：                                    │             │
│  │    cluster_size >= evidenceThreshold（默认 3）           │             │
│  │    evidence_cluster_score > 0.4                         │             │
│  └──────────────────────┬──────────────────────────────────┘             │
│                         │ 通过质量门                                       │
│                         ▼                                                 │
│  ┌──────────────────────────────────────────────────────────┐            │
│  │  memory_node 生成/更新（LLM 批量，可选）                   │            │
│  │                                                           │            │
│  │  SELECT content, summary FROM episode                    │            │
│  │    WHERE id IN cluster_episode_ids                       │            │
│  │                                                           │            │
│  │  LLM prompt（crystal.reflection.md）：                    │            │
│  │    输入：cluster episodes（内容+来源+权重）                 │            │
│  │    输出：{ title, method, symbols, confidence }           │            │
│  │                                                           │            │
│  │  → UPSERT memory_node                                    │            │
│  │  → RELATE episode → memory_node（consolidated_into）     │            │
│  └──────────────────────┬──────────────────────────────────┘            │
└──────────────────────────┘
                           │ memory_node 更新后
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  晶体技能升格门（第二级质量门）                                              │
│                                                                           │
│  查询 memory_node 的聚合状态：                                             │
│  SELECT evidenceCount, confidence, symbols FROM memory_node              │
│    WHERE userId={userId}                                                  │
│                                                                           │
│  ┌──────────────────────────────────────────────────────┐               │
│  │  Skill 升格条件（对应现有 crystallizeCandidate 逻辑）   │               │
│  │                                                        │               │
│  │  memory_node.confidence > 0.5（等价于原 scoreEvidence）│               │
│  │  memory_node.evidenceCount >= 3（cluster 覆盖多次）    │               │
│  │  memory_node.updatedAt 近期有更新（活跃节点）           │               │
│  └──────────────────────┬───────────────────────────────┘               │
│                         │ 通过                                            │
│                         ▼                                                 │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │  Skill 生成/合并（等价于现有 mergeCrystalSkill 逻辑）      │           │
│  │                                                           │           │
│  │  stableSkillId = hash(symbols[:6])（不变）               │           │
│  │  findSkill(id) → 合并或新建                               │           │
│  │                                                           │           │
│  │  合并规则（保留现有逻辑）：                                 │           │
│  │    support += evidenceCount                              │           │
│  │    confidence = weighted avg（按 support）               │           │
│  │    method = 取 evidenceScore 更高者                      │           │
│  │    symbols = union 归一化                                │           │
│  │    evidenceScore = max(existing, incoming)              │           │
│  │    sourceAtomIds → 替换为 sourceEpisodeIds              │           │
│  │                                                           │           │
│  │  UPSERT skill                                            │           │
│  │  RELATE memory_node → skill（proven_as）                 │           │
│  │  RELATE skill → episode（proven_by，证据溯源）            │           │
│  └──────────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 五、遗忘曲线 DAG

```
新 Episode 写入 Redis
  │
  │  stability = BASE_STABILITY[importance_band]
  │  TTL = stability × ln(2)
  │
  ▼
ff:ep:{userId}:{id}  EXPIRE TTL
ff:cq:{userId}  ZADD score=(now + TTL×0.8)   ← 提前 20% 审查

  │
  │  定期扫描 ZRANGEBYSCORE 0 {now}
  ▼
ConsolidationWorker
  │
  ├─ REINFORCE → new_stability = S × 2.5
  │               EXPIRE 更新
  │               ZADD 更新（延后审查时间）
  │               SurrealDB memory_node.importance × 1.1（召回强化）
  │
  ├─ CONSOLIDATE → 写 SurrealDB，DEL Redis key
  │                开始 SurrealDB 长期衰减周期
  │
  └─ DISCARD → DEL Redis key，记录遗忘事件

SurrealDB 长期衰减（定期 job，默认每 24h）：
  UPDATE episode     SET importance = importance × (1 - 0.05) × Δdays
  UPDATE memory_node SET importance = importance × (1 - 0.02) × Δdays
  UPDATE skill       SET importance = importance × (1 - 0.005) × Δdays

  if importance < 0.05 AND protected != true → 归档（不再参与 recall，数据保留）

召回强化（recall 时触发）：
  ZADD ff:act:{userId} {timestamp} {conceptTag}（热概念标记）
  若 SurrealDB memory_node/skill 被命中：
    new_importance = min(1, importance × 1.1)
    lastAccessedAt = now
    → 阻止短期衰减

  若 Redis episode 被命中（working memory 仍活）：
    new_stability = stability × 1.5（温和强化，非完整 2.5×）
    EXPIRE 更新
    ZADD 更新
```

---

## 六、概念激活上下文装配 DAG（新 buildPrompt）

```
message.text
  │
  ▼
extractConcepts(text)
（TF-IDF 纯统计 + 向量 token 化，matrix.ts，无 LLM、无关键词表）
→ concepts[]
→ embedding[]（LocalHashEmbeddingProvider）

  │
  │  并行
  ├──────────────────────────────────────────────────────────┐
  ▼                                                          ▼
Redis ff:ctx:{userId}                               SurrealDB 概念激活
LRANGE 0 11（最近 12 轮对话）                        ┌──────────────────────────────┐
→ 对话连贯性 buffer                                  │  第 1 跳（种子激活）           │
                                                     │  SELECT * FROM memory_node   │
                                                     │    WHERE userId={userId}      │
                                                     │    AND symbols CONTAINSANY   │
                                                     │        concepts              │
                                                     │    ORDER BY importance DESC  │
                                                     │    LIMIT 10                  │
                                                     │                              │
                                                     │  + ANN 向量搜索（并行）       │
                                                     │  SELECT * FROM memory_node   │
                                                     │    ORDER BY vector::cosine(  │
                                                     │      embedding, $qEmbed)     │
                                                     │    LIMIT 5                   │
                                                     └──────────────────────────────┘
                                                              │
                                                              ▼
                                                     ┌──────────────────────────────┐
                                                     │  第 2 跳（图扩散，可选）       │
                                                     │  SELECT ->similar_concept    │
                                                     │    ->memory_node FROM <hop1> │
                                                     │  activation_score × 0.5 衰减 │
                                                     └──────────────────────────────┘
                                                              │
                                                              ▼
                                                     ┌──────────────────────────────┐
                                                     │  Skill 召回                   │
                                                     │  SELECT * FROM skill         │
                                                     │    WHERE userId={userId}     │
                                                     │    ORDER BY vector::cosine(  │
                                                     │      embedding, $qEmbed)     │
                                                     │    LIMIT 3                   │
                                                     │  + symbols 交集过滤           │
                                                     └──────────────────────────────┘
  │                                                           │
  └───────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────────────────────────┐
                  │  上下文装配（按 token budget 截断）          │
                  │                                            │
                  │  优先级（高→低）：                          │
                  │  ① Markdown 宪法层（AGENT.md/USER.md）     │
                  │  ② 最近对话 Redis ring buffer              │
                  │  ③ 激活 memory_node（按 activation_score） │
                  │  ④ 相关 skill（方法论建议）                 │
                  │  ⑤ 工作记忆 episode（Redis 相关片段）       │
                  │  ⑥ 黑板摘要（如果适用）                    │
                  └───────────────────────────────────────────┘
```

---

## 七、完整系统边界图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FLYFLOR AGENT RUNTIME                                                       │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  流体智力层 Fluid Intelligence（热路径，实时推理）                        │ │
│  │                                                                         │ │
│  │  GatewayMessage → RuntimeModule → [BlackboardModule] → ModelClient     │ │
│  │                                ↕                                       │ │
│  │  上下文注入：memory + skill + mcp + sandbox + blackboard                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                │ reply 已发出，异步继续                                       │
│                ▼                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  工作记忆层 Working Memory（Redis，海马体短期缓冲）                       │ │
│  │                                                                         │ │
│  │  ff:ep:{userId}:{id}   HASH  有 TTL，遗忘曲线                           │ │
│  │  ff:ctx:{userId}       LIST  ring buffer，对话连贯性                     │ │
│  │  ff:cq:{userId}        ZSET  整合候选队列                                │ │
│  │  ff:act:{userId}       ZSET  概念激活热度                                │ │
│  │  ff:ma:{userId}        LIST  待处理 Markdown 动作                        │ │
│  └─────────────────────────┬──────────────────────────────────────────────┘ │
│                            │ ConsolidationWorker（异步，每 10 分钟）          │
│                            ▼                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  长期记忆图 Long-Term Memory Graph（SurrealDB）                          │ │
│  │                                                                         │ │
│  │  episode ──consolidated_into──► memory_node ──proven_as──► skill       │ │
│  │    │                               │                         │          │ │
│  │    └──next_context──► episode       └──similar_concept──► memory_node  │ │
│  │    └──similar_ep──► episode         └──proven_by──► episode            │ │
│  │                                                                         │ │
│  │  + 概念激活图遍历（spreading activation）                               │ │
│  │  + MTREE 向量索引（SurrealDB v2.0+）                                    │ │
│  └─────────────────────────┬──────────────────────────────────────────────┘ │
│                            │ 定期衰减 job（每 24h）                           │
│                            ▼                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  晶体智力层 Crystal Intelligence（技能图谱）                             │ │
│  │                                                                         │ │
│  │  skill（高置信度，极慢衰减，可 protected 标记）                           │ │
│  │                                                                         │ │
│  │  升格条件（双质量门）：                                                   │ │
│  │    门 1：episode cluster evidence_score > 0 (sourceKind gate)          │ │
│  │    门 2：memory_node.confidence > 0.5 AND evidenceCount >= 3           │ │
│  │                                                                         │ │
│  │  召回：symbols 匹配 + ANN cosine + confidence 加权                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  宪法层 Constitutional Layer（Markdown）                                │ │
│  │                                                                         │ │
│  │  AGENT.md / SOUL.md / USER.md / MEMORY.md                             │ │
│  │  只接受显式 memory action（用户主动要求）或 skill confidence > 0.9      │ │
│  │  人工维护，极低更新频率                                                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  审计层 Audit Log（SQLite）                                              │ │
│  │                                                                         │ │
│  │  原 session history → 降级为不可变审计 log                               │ │
│  │  Blackboard turns/steps/decisions/leases → 不变                         │ │
│  │  不再用于上下文装配                                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

外部存储：
  Redis 7           ← 工作记忆（TTL + AOF 持久化）
  SurrealDB v2.0+   ← 长期记忆图（RocksDB backend，已存在）
  SQLite            ← 审计 log + blackboard 状态（已存在，职责收缩）
  Markdown files    ← 宪法层（已存在，不变）
```

---

## 八、晶体智力候选逻辑在新架构中的对应关系

| 旧概念 | 新概念 | 说明 |
|---|---|---|
| `ReflectionCandidate` | `Episode`（Redis 工作记忆） | 捕获更早，无 LLM，轻量 |
| `ReflectionAtom` | `SurrealDB episode`（整合后） | 整合决策后写入，有图边 |
| `CrystalSkill` | `SurrealDB skill` | 保留完整合并逻辑 |
| `scoreEvidence(evidence[])` | `evidence_cluster_score`（cluster 聚合） | 扩展为跨 episode 聚合，而非单次 |
| `evidence weight gate` | `sourceKind` 权重裁判（完全等价，值不变） | 核心逻辑保留 |
| `mergeCrystalSkill()` | `mergeCrystalSkill()`（不变） | 直接复用 |
| `recallCrystalSkills()` | 扩展：`recallCrystalSkills()` + SurrealDB ANN | 加入向量索引，原 JS 评分逻辑保留 |
| `crystal.reflection.md` prompt | 双路复用：整合决策 + memory_node 生成 | 同一个 prompt，两个调用点 |

**关键设计决策：保留 evidence weight 裁判表（值不变）**

新架构中，`sourceKind` 在 episode 写入时就确定（来自 blackboard 运行结果）：
```
turn 结束时：
  若 blackboard.status == converged  → episode.sourceKind = "blackboard-converged"   → weight 0.8
  若 blackboard.status == needs-user → episode.sourceKind = "blackboard-needs-user"  → weight 0.65
  若 blackboard == undefined          → episode.sourceKind = "direct"                → weight 0.0
  若 memory action explicit           → episode.sourceKind = "explicit"              → weight 0.9
```

ConsolidationWorker 计算 `evidence_cluster_score` 时，按 sourceKind 查权重表，与当前逻辑完全等价。

---

## 九、实施顺序（含依赖）

```
Phase 1：移除 Qdrant                    ← 独立，最小风险
  删 qdrant.ts + docker service + config
  MemoryModule 移除 qdrant 调用

Phase 2：Redis 基础设施                 ← 阻塞：需先验证 ioredis bun compile
  验证 ioredis v5 + bun build --compile
  新增 redis.ts（ff:ep/ff:ctx/ff:cq/ff:act CRUD）
  docker-compose 新增 redis:7-alpine with AOF + keyspace events

Phase 3：SurrealDB 新 Schema           ← 阻塞：需确认 v2.0+（MTREE）
  检查 docker exec flyflor-surrealdb /surreal version
  新建 episode/memory_node/skill + 6 种关系表
  MTREE 向量索引（或降级应用层 cosine）
  迁移：crystal_skill → skill

Phase 4（并行 Phase 5）：Episode 捕获重构
  reflection.ts 异步 episode 构建（无 LLM）
  MemoryModule.rememberTurn 写 Redis（携带 sourceKind）

Phase 5（并行 Phase 4）：Context Assembly 重构
  activation.ts（spreading activation + SurrealDB 图遍历）
  MemoryModule.buildPrompt 改为 Redis ring buffer + 概念激活
  Session ring buffer（读 Redis ctx 替代 SQLite）

Phase 6：整合 Worker                   ← 依赖 Phase 4+5
  consolidation.worker.ts
  双质量门（sourceKind gate + cluster evidence_score）
  memory_node 生成 + skill 升格（复用现有 crystal.reflection.md）
  图边写入

Phase 7：衰减与强化                    ← 依赖 Phase 3+6
  decay.ts（定期 SurrealDB importance 衰减）
  recall 时强化 skill/memory_node
  Redis EXPIRE 更新（温和强化 1.5× vs 完整强化 2.5×）

Phase 8：memory.action.md 简化        ← 独立，最后
  移除 episode 指令（自动捕获）
  只保留 Markdown 层显式更新
  更新相关测试
```

---

## 十、风险清单

| 风险 | 等级 | 缓解方案 |
|---|---|---|
| `ioredis` + `bun build --compile` | **高** | 先验证；备选：极简 RESP-over-Bun-TCP（只需 8 个命令） |
| SurrealDB < 2.0（无 MTREE） | **中** | 升级 docker image；或应用层 cosine（`activation.ts` 内降级） |
| Keyspace 通知时 key 已消失 | **中** | 主路径用 ZSET 预扫（提前 20%），keyspace 仅兜底 |
| 旧 session_key 散落多处 | **中** | 渐进替换；`identityFor()` 新方法，`scopeFor()` 降级审计 key |
| cluster evidence_score 计算性能 | **低** | SurrealDB 索引 concepts 字段；cluster size 有上限（maxEpisodesPerUser） |
| `natural` 包中文分词质量 | **低** | 初期用纯字符 n-gram 统计降级（不引入业务关键词表）；后期可替换 jieba |
| consolidation LLM token 消耗 | **中** | maxDailyTokenBudget 守卫；batchSize 限制（默认 10） |

---

## 十一、晶体偏移与记忆膨胀防控

### 11.1 三类风险

1. **数量膨胀**：episode/memory_node/skill 无限堆积，召回噪声增大
2. **信念漂移（晶体偏移）**：错误证据累积后高权重 skill 向错误方向偏移，且因 evidenceScore 高难以被覆盖
3. **知识过时**：旧 skill method 因时间不再正确（如 API 接口已变），但 confidence 仍高

### 11.2 数量膨胀防控（硬性上限）

**Redis 工作记忆：**
```
maxEpisodesPerUser = 200（可配置）

写入前检查：
  ZCARD ff:cq:{userId}
  if count >= maxEpisodesPerUser:
    ZPOPMIN ff:cq:{userId}        ← 弹出最旧/最低分候选
    DEL ff:ep:{userId}:{弹出id}    ← 同步删除 episode
    记录 forced-forgetting 事件（不触发 LLM 决策）
```

**SurrealDB 分层上限：**
```
每 userId：
  episode      maxEpisodesLongTerm = 500
  memory_node  maxMemoryNodes      = 100
  skill        maxSkills           = 50

超出时：归档（archived = true，不删数据）
  按 importance ASC + lastAccessedAt ASC 排序
  归档最末 10%（批量，不逐条）
  归档不参与 recall 和激活扩散，但保留审计、可手动恢复
```

**Skill 去重（防同义碎片化）：**
```
新 skill 写入前：
  SELECT * FROM skill WHERE userId={userId}
    AND vector::similarity::cosine(embedding, $newEmbed) > 0.9
    LIMIT 3
  
  若找到高相似 skill → 触发 mergeCrystalSkill()，不新建
  若 support 合并后 > 20 → 标记 consolidated-skill，protected=true（保护不归档）
```

### 11.3 晶体偏移防控（信念漂移 = 反向证据降权）

**矛盾检测**：ConsolidationWorker 的 LLM 决策新增字段
```
{
  action: "reinforce" | "consolidate" | "discard" | "contradict",
  contradicts?: string,        ← 被矛盾的 skill/memory_node id
  contradictWeight?: float     ← 矛盾强度 0-1
}

if action == "contradict":
  - 不升格为同一 skill
  - 对被矛盾的 skill 执行：
    skill.contradictionCount += 1
    skill.confidence *= (1 - contradictWeight × 0.3)
    
    if skill.confidence < 0.3 → 降级为 memory_node（保留数据）
    if skill.confidence < 0.1 → 标记 deprecated，归档（保留数据）
```

**Skill 版本快照（防漂移不可追溯）：**
```
SurrealDB 新增表 skill_snapshot：
  当 skill 被显著更新（confidence 变化 > 0.15）：
  INSERT skill_snapshot { skillId, method, confidence, symbols, updatedAt, reason }
  
  保留最近 5 个版本，超出删除最旧 snapshot（不删 skill）
```

**知识时效性（防过时）：**
```
SurrealDB skill 新增字段：
  lastVerifiedAt: datetime           ← 最近被证据支撑的时间
  verificationIntervalDays: int      ← 预期验证周期（默认 30）

decay.ts 增加时效性衰减（与 importance 衰减并行）：
  days_since_verified = (now - lastVerifiedAt) / day
  if days_since_verified > verificationIntervalDays:
    staleness = min(1, (days_since_verified - verificationIntervalDays) / 30)
    skill.confidence *= (1 - staleness × 0.2)   ← 每超期 30 天降 20%

区别：
  decayRate         控制"还记不记得"
  时效性衰减         控制"是否还可信"
```

### 11.4 Skill 完整生命周期状态机

```
   episode cluster 通过质量门一
                │
                ▼
        ┌──────────────┐
        │  candidate   │  ← Redis episode cluster 候选
        └──────┬───────┘
               │ 通过门二（confidence>0.5, evidenceCount>=3）
               ▼
        ┌──────────────┐  ── recall reinforce ──┐
        │   active     │ ←─────────────────────┘
        │   skill      │
        └──┬────┬────┬─┘
           │    │    │
           │    │    └── support>=20 → ┐
           │    │                       ▼
           │    │              ┌──────────────────┐
           │    │              │   consolidated   │  ← 保护标记，不归档
           │    │              │   (protected)    │
           │    │              └──────────────────┘
           │    │
           │    └── 矛盾累积 conf<0.3 ──┐
           │                            ▼
           │                  ┌──────────────────┐
           │                  │  demoted         │  ← 降级为 memory_node
           │                  │  (memory_node)   │
           │                  └──────────────────┘
           │
           ├── conf<0.1 ──┐
           │              ▼
           │    ┌──────────────────┐
           │    │   deprecated     │  ← 矛盾过多，归档
           │    │   (archived)     │
           │    └──────────────────┘
           │
           └── importance<0.05 ──┐
                                 ▼
                       ┌──────────────────┐
                       │   archived       │  ← 重要性低，归档
                       │   (low-imp)      │
                       └──────────────────┘
                       
   状态横切：
   skill_snapshot（每次重大更新写一份历史快照，最多 5 个）
```

---

## 十二、无 Session 设计补充（来自 PDF 讨论）

### 12.1 设计哲学

> 「你不是在做无 session agent，而是在做一个会改变自己的记忆系统」
> 「同一个问题在不同时间问，回答合理变化但人格一致」← 海马体生效的判断标准

**溶解 session 的工程含义：**
- session 不消失，而是「溶解」进工作记忆和长期记忆图
- 短期连贯性 = Redis ring buffer（不依赖 session_key）
- 长期连续性 = SurrealDB 概念激活（跨任意时间和频道）
- 用户感知 = agent 记得上次讨论的事，即使过了几天换了频道

### 12.2 Feedback Interpreter（PDF 核心模块）

> 「真正的核心模块不是 memory/blackboard/worker，而是反馈如何被理解和吸收。」

**反馈四类分类（无 LLM，基于 memory action 类型 + 信号）：**

```
A. 局部纠错（one-shot correction）
   "这次说错了" / "这个方法不对"
   → episode sourceKind="correction"，weight=0.7
   → 不直接修改 skill，待 cluster 积累再决定 contradict

B. 偏好表达（preference signal）
   "我喜欢你这样" / "以后不要这么写"
   → memory_node preference cluster，下次激活高权重
   → 可选写 USER.md（需达到显式 explicit）

C. 全局策略纠正（behavioral correction）
   "你总是过于保守" / "用散文不要列条目"
   → 直接写 MEMORY.md / AGENT.md（宪法层）
   → 同时创建 style-constraint skill，protected=true

D. 验证确认（positive reinforcement）
   "你做得很好" / 用户接受了建议
   → 相关 skill/memory_node 强化（importance × 1.1）
   → lastVerifiedAt = now（重置时效性衰减）
```

**实现位置：**
- 复用现有 `parseMemoryActions()` 解析显式动作
- 新增 `feedback.interpreter.ts`：基于 action type + 信号映射到 A/B/C/D
- A/B → episode 写入，常规整合流水线
- C → 直接写宪法层（现有 autoPromoteExplicit 路径）
- D → 强化调用（接入 recall 强化逻辑）

### 12.3 Reconstruction（记忆参与推理）

> 「人类记忆不是数据库，而是可变形的重建过程。」

**Reconstruction = LLM 调用时记忆是「思维底色」，不是死注入文本：**

```
普通注入：
  [memory:concept] node.content（直接文本）

Reconstruction 模式（激活 memory_node ≥ 3 且有 similar_concept 边时触发）：
  [memory:reconstruction-hint]
  以下记忆节点在当前话题下相互关联：{node_A} ↔ {node_B}
  请在推理中考虑它们之间的关系
  
  → LLM 不只是读取记忆，而是在回答中「重建」记忆间的关系
  → 这是「同一问题不同时间回答合理变化」的来源
```

### 12.4 「打架有记忆」（黑板辩论沉淀）

> 「不是避免打架，而是让打架有记忆。」

当前缺口：黑板讨论写入 SQLite turns/steps，**不进入记忆图**。

新设计：
```
黑板 turn 结束（converged 或 needs-user）：
  
  1. 提取分歧点（blockers + openIssues）
  2. 提取共识（final outcome + outputSummary）
  3. 构建 debate episode：
     sourceKind = "blackboard-converged"（weight 0.8）
     content = 分歧点摘要 + 最终共识
     concepts = steps 中的关键概念
     importance = blackboard 的 convergenceScore
  4. 写入 Redis（与普通 episode 同等流水线）
  5. 整合时 evidence weight = 0.8（高于 direct 的 0）
  6. 同概念多次出现 debate → 优先结晶为 debate-proven skill
  
  效果：思维打架的结果成为最高质量的晶体候选。
```

---

## 十三、事件与项目固化：何时初始化结构与 Markdown

### 13.1 问题定义

海马体的基本单位是 episode 和 memory_node。但有些工作不是零散知识，而是**持续进行的项目**或**有始有终的事件**——这些需要固化为结构化 Markdown（README、TODO、DESIGN）和项目目录，而不只停留在记忆图中。

**固化 ≠ 写文件，而是：**
- 内存中的 episode/memory_node 有了「归属地」
- 后续相关 episode 自动向该项目聚合
- 项目 Markdown 成为该领域的宪法层补充

### 13.2 固化触发的三条路径

```
路径 A：显式用户意图（最高优先级）
─────────────────────────────────
触发条件：模型在该轮输出中返回结构化 memory action：
  type = "project-init" | "event-record" | "project-close"
  
（不通过任何字符匹配判断用户意图。下面括号里的措辞只是
 用户可能怎么表达的非规范示例，仅供 prompt 设计参考；
 代码绝不能 if text.includes(...) 来识别意图。）
  
  示例措辞（不在代码里使用）：
    "记住这个项目"、"帮我建一个项目文件"、"这是我们正在做的 X"
  
  → 模型同轮直接返回 memory action JSON
  → 立即固化，不等 cluster

路径 B：概念 cluster 自动触发（被动识别）
──────────────────────────────────────────
SurrealDB 中某 userId 下，围绕相同 concept group 的 episode：
  - cluster_size >= 5（projectInitThreshold）
  - 跨越 ≥ 2 次不同 turn（排除单次长对话）
  - 至少有 1 条 blackboard-converged 来源
  - cluster evidence_score > 0.5

→ 触发 project-candidate 事件
→ 通过 decision form 询问用户（类似黑板 needs-user）
→ 用户确认 → 触发固化

路径 C：技能升格触发（自动，最保守）
──────────────────────────────────────
某 skill：support >= 5 AND confidence > 0.7
→ 标记 domain-anchor
→ 在 MEMORY.md 追加一条技能摘要（不创建新文件）
→ 不需要用户确认
```

### 13.3 固化流程 DAG

```
固化触发（路径 A/B）
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  项目初始化决策（LLM）                                          │
│                                                               │
│  输入：cluster episodes + 相关 skills                          │
│  输出（JSON）：                                                │
│  {                                                            │
│    projectId: string,           ← slug，工作目录名             │
│    projectName: string,                                       │
│    projectType: "ongoing-work" | "event" | "research",       │
│    summary: string,             ← README.md 用                 │
│    initialTodos: string[],      ← TODO.md 用                   │
│    designNotes?: string,        ← DESIGN.md 用（可选）         │
│    concepts: string[],          ← 后续 episode 归属标记         │
│    confidence: float                                          │
│  }                                                            │
└──────────────────────────────────────┬───────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                         ▼
   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │  文件层写入        │    │  SurrealDB 标记   │    │  Redis 标记       │
   │                  │    │                  │    │                  │
   │  workspace/      │    │  episode         │    │  ff:proj:active:  │
   │  projects/{id}/  │    │  SET projectRef  │    │  {userId}         │
   │   README.md      │    │  = projectId     │    │  ZADD active proj │
   │   TODO.md        │    │                  │    │                  │
   │   DESIGN.md      │    │  memory_node     │    │  概念激活时        │
   │   (可选)         │    │  SET projectRef  │    │  优先匹配 active   │
   │                  │    │                  │    │                  │
   │  写入路径来自     │    │  skill           │    │                  │
   │  config:         │    │  SET projectRef  │    │                  │
   │  projectFileRoot │    │                  │    │                  │
   └──────────────────┘    └──────────────────┘    └──────────────────┘
```

### 13.4 事件 vs 项目 vs 研究的差别

| 类型 | 特征 | 固化形式 | 生命周期 |
|---|---|---|---|
| **事件 (Event)** | 有始有终、一次性，如「讨论了 X 方案」 | 单文件 event log + episode | 完成归档，不再更新 |
| **项目 (Project)** | 持续进行、多 turn，如「Flyflor 开发」 | 目录（README/TODO/DESIGN）+ memory_node cluster | 持续更新，按里程碑快照 |
| **研究 (Research)** | 知识积累型，如「研究 Redis 方案」 | MEMORY.md 追加 + skill 升格 | 完成转 skill，不维护独立文件 |

### 13.5 固化后的记忆归集

```
新 episode 写入时：
  episode.concepts ∩ project.concepts 是否有交集？
    有 → episode.projectRef = project.id
    
ConsolidationWorker：
  cluster 优先按 projectRef 分组
  同 project 的 cluster 生成的 memory_node 也带 projectRef
  与项目 DESIGN.md 内容对齐

Skill 升格：
  若 skill.projectRef 存在 → 更新项目 TODO.md 对应任务
  或追加到 DESIGN.md "已验证方法" 章节
```

### 13.6 项目固化与遗忘的边界

**项目文件不会被自动遗忘（保护）：**
- README/TODO/DESIGN 由用户管理，与 MEMORY.md 同等级别
- 但项目关联的 SurrealDB 节点正常衰减

**项目归档触发：**
```
用户："这个项目结束了" / memory action type = "project-close"
→ project.status = "archived"
→ 关联 memory_node/skill 标记 protected = false（允许正常衰减）
→ 项目目录移至 projects/archived/{id}/
→ LLM 生成 RETROSPECTIVE.md 总结（一次性）
```

### 13.7 项目固化配置

```jsonc
"memory": {
  "project": {
    "autoInitEnabled": true,
    "projectInitThreshold": 5,        // cluster 最小 episode 数
    "projectInitMinScore": 0.5,        // cluster evidence score 最低
    "requireBlackboardEvidence": true, // 至少 1 条 bb-converged
    "confirmWithUser": true,           // 路径 B 是否问用户
    "projectFileRootDir": "projects",  // 相对 workspaceDir
    "maxActiveProjects": 10            // 同时活跃项目上限
  }
}
```

---

## 十四、新增组件总览（追加 §11–§13）

| 组件 | 路径 | 职责 |
|---|---|---|
| `feedback.interpreter.ts` | `src/agent/runtime/` | 反馈四类分类（A/B/C/D） |
| `crystal.snapshot.ts` | `src/crystal/memory/` | Skill 快照写入与查询 |
| `crystal.contradict.ts` | `src/crystal/memory/` | 矛盾检测与 skill 降级 |
| `project.module.ts` | `src/agent/project/` | 项目固化、归属、归档 |
| `project.init.prompt.md` | `templates/prompts/` | 项目初始化 LLM prompt |
| `decay.ts` | `src/crystal/memory/` | 双轨衰减：importance + 时效性 |
| `forced.forget.ts` | `src/neural/memory/` | Redis 上限触发的强制遗忘 |

---

## 十五、性能与响应速度评估

### 15.1 核心原则（重申）

> 「核心不是堆叠记忆，而是思考能力的自我迭代」

记忆系统是**让思考有上下文的基础设施**，不是用户感知的核心。**用户只感知响应速度**。
所以记忆所有重活必须：
1. **不在热路径**（用户等待回复时不能跑）
2. **不阻塞 stream**（首字节时间 TTFB < 300ms 是底线）
3. **可降级**（任何记忆组件挂掉都不能让对话失败）

### 15.2 热路径耗时拆解（新架构）

| 阶段 | 操作 | 估算耗时 | 是否阻塞 stream |
|---|---|---|---|
| ① 接收消息 | gateway parse | 1ms | ✅ |
| ② 并行启动 | promise.all 4 路 | (取最慢) | ✅ |
| ②a buildPrompt | Redis 2 次 + SurrealDB ANN | **20–60ms** | ✅ |
| ②b loadSkills | 文件系统（已 cached） | <5ms | ✅ |
| ②c loadMcpServers | 文件系统（已 cached） | <5ms | ✅ |
| ②d preRoute | LLM call（短 prompt，~200 token） | **150–400ms** | ✅ |
| ③ runBlackboard | 条件触发，direct 时 0ms | 0ms（direct）/ 数秒（board） | direct 不阻塞 |
| ④ 主模型生成 | LLM stream | **TTFB 100–500ms** | 已 streaming |
| ⑤ rememberTurn | 全部异步，fire-and-forget | 0ms（用户感知） | ❌ |

**关键：当前 ⑥（同步 LLM 反思）的 500ms–2s 阻塞 → 完全消除（移到 worker）**

### 15.3 热路径理想时序

```
0ms        消息进入
1ms        ┌─ buildPrompt 开始（Redis ping ~1ms）
1ms        ├─ preRoute 开始（LLM 短调用）
1ms        └─ loadSkills/Mcp（已 cached）
60ms       buildPrompt 完成（Redis 60μs + SurrealDB ANN 50ms）
~250ms     preRoute 完成（这是瓶颈）
~250ms     主模型 LLM 开始（已可发送 system prompt）
~350ms     主模型首 token（用户看到回复）  ← TTFB
~3-10s     stream 完毕
~3-10s     reply 已发出，开始异步 rememberTurn
~3.01s     用户感知"已结束"，但后台仍在异步处理
```

**TTFB 优化目标：350ms（当前估计）**

### 15.4 优化点清单

#### 优化 1：preRoute 是最大瓶颈（占 TTFB 60%+）

当前：每条消息都做 LLM 路由判断（~250ms）。

**短路策略（不做关键词匹配，只用资源指标 + 模型缓存）：**
```
fastRoute(message, identity):
  // 全部基于纯资源指标和上一轮模型已经返回的结构化结果，
  // 不做任何字符/正则/关键词业务语义判断（违反 boundaries.md 全局红线）

  // ① 上一轮模型已经返回 nextRouteHint（结构化 enum），直接复用
  if last_turn.nextRouteHint == "direct" AND age < 5s:
    return direct

  // ② 当前 turn 与上一 turn 的 embedding 余弦相似度 > 0.85（同话题延续）
  //    且上一轮路由是 direct → 复用
  if cosine(curEmbed, lastEmbed) > 0.85 AND last_turn.route == direct:
    return direct

  // ③ token 预算指标：上下文 token 总数 < 路由阈值
  //    （这是资源判断，不是语义判断）
  if estimated_total_tokens < routeBypassTokenBudget:
    // 仍需要模型判断，但走极简路由模板而非完整路由
    return llm_minimal_route()

  → 走完整 LLM route
```

**关键设计：让模型自己决定下一轮的路由提示**

每轮主模型生成结束时，从 JSON 输出里读取 `nextRouteHint` 字段：
- 模型最了解当前对话状态，由它给出"如果用户继续这个话题，下一轮可以直接 direct"的提示
- 代码只读 enum 字段，不解析自然语言
- 命中后下一轮跳过路由 LLM 调用

**预期 60–70% 命中率**来自：连续话题延续（②）+ 模型自己的路由提示（①）+ token 预算（③），完全不依赖关键词匹配。

**LLM 路由批处理（可选）：**
```
若 fastRoute 没命中，启动 LLM route，但**不阻塞主模型**：
  modelMessages 立即开始构建（不等 route）
  route 与主模型并行启动
  若 route 返回 direct → 主模型已在生成，无影响
  若 route 返回 blackboard → 中断主模型，转 board 流程
  
风险：浪费一些 token（极少）
收益：blackboard 转换时几乎无延迟
```

#### 优化 2：Redis 连接池预热

ioredis 默认懒连接。冷启动第一次调用 ~50ms（TCP 握手）。

```
RuntimeModule 启动时：
  await redis.ping()  ← 预热连接
  redis.connect()      ← 持久连接，整个进程生命周期复用
  
每次调用：< 1ms（本地 docker 网络）
```

#### 优化 3：SurrealDB ANN 查询缓存

热概念组合（如「Redis + 性能」）会被反复查询：

```
LRU 缓存（内存）：
  key = hash(concepts.sort().join('|'))
  value = ANN result（10 个 memory_node）
  TTL = 60 秒
  size = 100 entries

命中率预期：30–50%（同话题持续对话时）
节省：50ms × 命中率 ≈ 15–25ms
```

#### 优化 4：embedding 复用

`message.text` 在 buildPrompt 和 episode 写入时各计算一次。

```
计算一次后挂在 RuntimeContext：
  context.embeddings = {
    message: float[256]
  }
  
节省：~5ms（hash embedding 很快，但聚少成多）
```

#### 优化 5：异步管道化（rememberTurn）

```
当前 rememberTurn 串行 5 步
新设计：
  ① session 写 audit log    │
  ② episode 构建 + Redis 写  │ 全部并行（互不依赖）
  ③ Markdown 显式更新        │
  ④ ring buffer 更新         │
  
  整体耗时取最慢 = 10–20ms（不阻塞用户）
```

#### 优化 6：避免 prompt 重复加载

`loadPromptTemplates()` 当前每次调用都检查文件。

```
模板加载一次后驻留内存：
  module-level cache，启动时加载
  hot reload 通过 fs.watch 触发（dev 模式）
  
节省：~3ms × 每次调用
```

#### 优化 7：Bun 原生 SQLite 替代异步驱动

bun:sqlite 是同步的，但比 better-sqlite3 + promise wrapper 快 2–3 倍。
现在 SQLiteMemoryStore 用什么？需要确认。如果是异步 wrapper，切换到 bun:sqlite 可省 5–10ms。

### 15.5 预期 TTFB 总览

| 场景 | 当前估算 | 优化后估算 |
|---|---|---|
| 短对话 fastRoute 命中 | ~150ms（Redis + 主模型 TTFB） | **~120ms** |
| 复杂请求需 LLM route | ~600ms（含 route 250ms） | **~350ms（route 与模型并行）** |
| 黑板触发 | ~3–10s（黑板讨论） | 不变（黑板已 streaming） |

### 15.6 后台 worker 资源预算

ConsolidationWorker、decay、project module 都是后台异步任务，但仍要控制资源：

| Worker | 频率 | 单次耗时上限 | LLM 调用 |
|---|---|---|---|
| ConsolidationWorker | 每 10 min | 30s | 最多 10 次（batchSize） |
| decay job | 每 24h | 60s | 0 |
| project candidate scan | 每 1h | 10s | 0（探测时无 LLM） |
| project init LLM | 触发驱动 | 5s | 1 次 |

**Token 预算守卫：**
```
config:
  consolidation.maxDailyTokenBudget: 50000   // ConsolidationWorker
  project.maxDailyTokenBudget: 20000         // project init
  globalMaxConcurrentBackgroundLLM: 2        // 任意时刻并发上限
  
超过预算后：worker 跳过当批次，下次再试
```

### 15.7 内存占用估算

| 组件 | 估算 | 备注 |
|---|---|---|
| Redis 单 user 工作记忆 | ~500KB（200 episode × 2.5KB） | maxmemory 256MB 容纳 ~500 用户 |
| SurrealDB rocksdb | 持久化磁盘，内存占用 ~50MB | RocksDB 默认 cache |
| Bun 进程 RSS | ~200MB | 含 LLM client、prompt cache、ANN cache |
| 主进程 ANN LRU 缓存 | ~5MB（100 × 50KB） | 可控 |

### 15.8 风险监控指标

启动时启用 metrics（接入现有 EventSink）：

```
RuntimeEventType.PerfTTFB        每 turn 记录
RuntimeEventType.PerfBuildPrompt 每 turn 记录
RuntimeEventType.PerfRouteLLM    每 turn 记录
RuntimeEventType.RedisLatency     每 100 次操作采样
RuntimeEventType.SurrealAnnLatency 每 100 次查询采样
RuntimeEventType.WorkerBatchTime  每次 batch 完成
```

CLI 命令：`flyflor metrics`（未实现，作为后续 todo）

---

## 十六、梦境模式（Dream Mode）— 占位设计

> 用户提到：「后续将加入梦境模式，有利于记忆控制」
> 此章节为占位设计，确保当前重构不会与未来梦境模式冲突。

### 16.1 概念定位

梦境模式 = **agent 在空闲时间的离线认知整合**，对应人类睡眠中海马体回放（hippocampal replay）。

与 ConsolidationWorker 的差异：
| 维度 | ConsolidationWorker | Dream Mode |
|---|---|---|
| 触发 | 定期 + 数据驱动（episode 即将过期） | 空闲触发 + 用户手动 + 调度（如每日凌晨） |
| 范围 | 单 episode 决策（reinforce/consolidate/discard） | 跨 episode 重组、新关联发现、技能重构 |
| LLM 用量 | 轻量（每 episode 1 次短调用） | 重量（深度推理、多 episode 联合分析） |
| 输出 | episode → memory_node | 新 memory_node、跨域 skill、矛盾发现报告 |
| 用户感知 | 完全后台，不可见 | 可见（生成"梦境日志"，可审阅） |

### 16.2 梦境模式三种活动（设计草稿）

```
A. 重组（Recombination）
   随机抽取 K 个低相关 memory_node 让 LLM 寻找潜在关联
   → 发现新的 similar_concept 边
   → 生成"洞察候选"（insight），用户审阅后可升格为 skill

B. 矛盾审计（Contradiction Audit）
   扫描所有 active skill，两两比较 method 是否潜在矛盾
   → 发现 ConsolidationWorker 单次调用看不到的全局矛盾
   → 生成矛盾报告，触发 contradict 流程

C. 主题压缩（Theme Compression）
   按 concepts 聚类相关 memory_node，让 LLM 提炼"主题摘要"
   → 减少 memory_node 数量，提升 recall 信噪比
   → 与归档协同（旧节点归档，主题节点保留）
```

### 16.3 当前重构对梦境模式的兼容性

**已支持的基础设施：**
- SurrealDB 图边支持任意新增（similar_concept 等）
- skill_snapshot 可记录梦境模式的修改历史
- `protected` 标记可保护重要节点不被梦境模式重组
- consolidation worker 框架可复用为 dream worker（不同 prompt + 不同触发器）

**不冲突，但需预留：**
- 项目固化产生的 README/TODO 应在 dream 时被读取（作为约束，不被改动）
- Feedback Interpreter D 类（验证）应在 dream 时优先选取（更可信的素材）
- Redis ff:dream:{userId} 队列预留（未来加入梦境结果暂存）

### 16.4 哲学一致性

PDF 中的 Reconstruction（记忆参与推理）+ 「打架有记忆」+ 梦境模式 三者构成完整的**思考自我迭代**链路：

```
对话中（清醒）：Reconstruction 让记忆参与当下思考
对话后（短期）：ConsolidationWorker 处理短期整合
空闲时（长期）：Dream Mode 进行深度重组与发现

→ 思考能力随时间持续迭代
→ 不是堆叠记忆，是让记忆相互作用产生新认知
```

这正是用户强调的核心：**思考能力的自我迭代，不是记忆堆叠**。

