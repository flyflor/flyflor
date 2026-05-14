# 存储降级方案：Redis + SurrealDB → 纯本地方案

> Status: **阶段 1 已落地 — local working memory 默认启用；crystal.db 仍为后续项**
>
> 从智能生命体的设计哲学出发，评估将 Redis（海马体工作记忆）和 SurrealDB（晶体长期图）两个外部服务降级为进程内实现。

---

## 1. 一句话定位

Flyflor 是一个在时间里持续活着的智能生命体。它的记忆系统模仿人类的三层结构：**工作记忆（海马体）→ 生命事件（自传体记忆）→ 晶体智力（可复用的知识）**。

Redis 和 SurrealDB 是这三层中的存储介质。本文评估用进程内 TypeScript 组件替换这两个介质，不改变三层记忆的**流转逻辑**——只换存储载体，不换认知模型。

目标：将 docker-compose 从 3 容器降为 1 容器，零外部运行时依赖，同时确保智能生命体的记忆机制不受损。当前已完成工作记忆 local backend 和 Docker 单容器默认配置；SurrealDB 晶体图仍保留为可选外部后端。

---

## 2. 核心决策

### 2.1 认知前提：三层记忆模型的四个不变原则

存储介质可以替换，但以下四条认知原则不能改变：

| 原则 | 说明 |
|------|------|
| **时间是唯一连续轴** | 无 session 设计。记忆不按对话边界清理，而是按时间衰减 |
| **遗忘是降权，不是删除** | importance 随时间下降，低到阈值以下就不再被召回，但原文不丢 |
| **升格需要证据** | 工作记忆升格为长期记忆必须通过 LLM consolidation 的质量门 |
| **漂移需要修正** | 晶体层知识可能过时或矛盾，Dream worker 负责修正，不凭空创造 |

### 2.2 五项存储决策

| ID | 决策 | 认知对应 | 理论基础 |
|----|------|---------|---------|
| D1 | Redis → 进程内存 | 海马体工作记忆 | TTL 遗忘 + consolidation 升格 + 衰减降权，三条核心通道进程内等价 |
| D2 | SurrealDB 图关系 → SQLite crystal.db | 晶体知识图 | 计划项；当前保留 SurrealDB 可选后端，默认 Docker 不启用 |
| D3 | SurrealDB 向量搜索 → brute-force cosine | 记忆召回 | 召回面受衰减阈值约束，搜索规模天然受限 |
| D4 | 搜索与持久化分离 | 热/冷路径 | 热路径（每请求 recall）走内存索引，冷路径（dream/consolidation）走 SQLite |
| D5 | 文件级别解耦 | 生平 vs 知识 | brain.db = 自传体记忆（发生了什么），crystal.db = 晶体智力（学到了什么） |

### 2.3 D1 详述：工作记忆的进程内等价

**人类的工作记忆**：容量有限，遗忘是时间衰减（非硬删除），重要的经睡眠巩固进入长期记忆。

**Flyflor 的工作记忆**：同样三条通道：

1. **时间衰减（TTL）** — episode 在固定时间窗口后自然消失。进程内 `setTimeout` 精确实现同等语义。过期的 episode 不是被"删除"，而是退出工作记忆窗口。
2. **LLM 巩固（Consolidation）** — 定期让 LLM 判断哪些工作记忆值得升格。升格的 episode 从工作记忆移除，写入晶体层。不管目标是 SurrealDB 还是 crystal.db，consolidation 的逻辑不变。
3. **降权（Decay）** — importance 随时间下降。低重要性的记忆仍存在，但不再被召回。纯数值运算，不受存储介质影响。

**辅助通道**：

4. **激活热度（Activation）** — 频繁访问的概念保持高热度，更容易被召回。进程内 `Map<concept, timestamp>` 等价。
5. **容量安全阀** — 极端高频交互时，最旧最低 importance 的 episode 退出窗口。进程内 `Array.shift()` 等价。

**核心结论**：工作记忆的边界不由固定容量决定，而由**时间窗口 + LLM 价值判断**决定。这两条核心通道与存储介质无关。

### 2.4 D2 详述：晶体知识图从 SurrealDB 到 SQLite

晶体智力层存储「已经过 LLM 判断值得长期保留的知识」。它包含三类实体和它们之间的关系：episode（事件）、memory_node（概念聚合）、gem（晶体知识）、边（consolidated_into/similar_concept/contradicts 等）。

当前 SurrealDB 使用 RELATE 管理这些边，但实际使用面只涉及 1-hop 图遍历——从节点 A 沿一条边走到邻居 B。这是普通 SQL JOIN 就能覆盖的操作。当前没有递归图查询，没有复杂图算法，所有图操作都可以用一张 `graph_edges` 表完成。

crystal.db 独立于 brain.db，因为「生平事件」和「晶体知识」是两类不同记忆。

### 2.5 D3 详述：向量搜索用 brute-force 而非专用引擎

晶体层的记忆召回受 **AtomScore 阈值** 约束——只有 importance 高于阈值的记忆才会被召回。实际参与搜索的向量数量天然受限。

**为什么 brute-force 在此场景下是最优方案**：

1. 搜索规模由衰减控制，低 importance 的记忆不参与召回
2. 小数据量下 O(n) 优于 O(log n)——近似算法的索引维护开销超过线性扫描
3. 零外部依赖，与 `bun build --compile` 天然兼容

如果阈值放宽导致搜索面扩大，`VectorIndex` 接口可切换到 HNSW 实现。

### 2.6 D4 详述：搜索与持久化分离

- **热路径**（每请求必调）：向量在内存中，搜索无 IO，延迟 <1ms（实测 0.31ms @ 500 条）
- **冷路径**（dream pass、decay sweep）：从 SQLite 读取全量数据，批量处理，写回

内存索引是 SQLite 的只读镜像，启动时全量加载，写入时同步更新。

### 2.7 D5 详述：文件级别解耦

| 文件 | 记忆层 | 内容 |
|------|-------|------|
| `brain.db` | 自传体记忆 | 每轮 turn 的 event + state + summary |
| `crystal.db` | 晶体智力 | 升格的知识 (episode/node/gem/edges) |
| `audit.jsonl` | 审计日志 | 不可变事件流 |

约定大于配置：文件名本身就是契约。

### 2.8 Redis 的其他消费者

除 MemoryComponent 替代的核心工作记忆外，Redis 还被以下模块使用，替换为零代码改动——`InMemory*` fallback 已有实现：

| 消费者 | 原 Redis 用途 | 替换 |
|--------|-------------|------|
| fastRoute 快照 | L2 跨进程共享 | `InMemoryFastRouteSnapshotStore`（已有） |
| gateway 去重 | 消息幂等 | `InMemoryDedupStore`（已有） |
| FocusPointer | 用户当前注意力指针 | MemoryComponent 内 `Map<userId, pointer>` |

---

## 3. 理论依据：从生命体角度

### 3.1 工作记忆的边界不由固定容量决定

人类的短期记忆能 hold 住 7±2 个 chunks，但这不是硬限制——通过 chunking 可以记住更多。Flyflor 的工作记忆同样不由固定容量决定，而由两条动态边界共同决定：

1. **时间窗口** — TTL 定义「最近多久的事情在工作记忆中」
2. **LLM 价值判断** — Consolidation 决定「哪些值得升格」

两条边界在进程内同样可以实现——`setTimeout` 管理时间窗口，LLM 决策管理升格。

### 3.2 遗忘是降权，不是删除

人类的遗忘不是「记忆被删除」，而是「提取失败」——记忆还在，但 activation 太低无法被 recall。Flyflor 的遗忘同样如此：衰减降低 importance，AtomScore 阈值过滤低分记忆，原文保留可被重新激活。

替换后晶体层数据同样不删除，只通过 decay sweep 更新 importance 字段。

### 3.3 升格需要证据

双质量门控制工作记忆到晶体知识的升格：门 1 校验 sourceKind weight，门 2 校验 confidence × evidenceCount。两个门是纯逻辑判断，不依赖任何存储引擎特性。

### 3.4 漂移需要修正

晶体知识可能过时或矛盾。Dream worker 修正而非删除：写快照保留旧版本，修改 scope/confidence，标记 contradictions 关系。替换后通过 crystal.db 的 SQL UPDATE 同等实现。

---

## 4. 数据量边界

### 4.1 工作记忆层

工作记忆的规模由时间窗口和用户交互频率决定，不由固定容量决定。

| 维度 | 约束 | 说明 |
|------|------|------|
| 时间窗口 | TTL | 超出窗口的 episode 退出工作记忆 |
| 升格速率 | Consolidation | 重要的被移出工作记忆，进入晶体层 |
| 衰减 | Decay sweep | 降低 importance，影响 recall 概率 |
| 安全阀 | 可配置上限 | 极端高频时兜底，不参与正常流转 |

**替换后**：进程内 `setTimeout` 管理时间窗口，`Array` 管理候选队列。内存占用 = 时间窗口内活跃 episode × 平均大小，不随用户总数线性增长（冷用户不占工作记忆）。

### 4.2 晶体层

搜索面受 AtomScore 阈值约束。只有 importance 高于阈值的节点参与召回。

| 实体 | 搜索面约束 |
|------|----------|
| memory_node | importance > 阈值，低分不参与召回 |
| gem | confidence > 门 2 + status = active |
| episode | sourceKind + evidence weight 筛选 |

**关键**：搜索面在衰减和阈值的联合控制下收敛。不是「数据越多越慢」，而是「衰减自动控制规模」。

### 4.3 替换后的存储占用 + 实测性能

**存储占用**：

| 组件 | 占用 |
|------|------|
| MemoryComponent | 数百 KB（受 TTL 控制） |
| crystal.db | 数 MB（长期积累） |
| VectorIndex | 数百 KB（受 AtomScore 阈值控制） |

**实测搜索延迟**（Apple M1 + Bun 1.3 JSC JIT + Float64Array × 384 维）：

| 数据量 | brute-force 延迟 | bun compile 后延迟 | 评估 |
|--------|-----------------|-------------------|------|
| 50 条 | 0.10ms | 0.06ms | 无感 |
| 100 条 | 0.06ms | 0.06ms | 无感 |
| 200 条 | 0.12ms | 0.13ms | 无感 |
| 500 条 | 0.31ms | 0.38ms | 无感 |
| 1000 条 | 0.68ms | 0.81ms | 无感 |
| 2000 条 | 1.50ms | 1.65ms | 无感 |

> LLM API 调用延迟参考：500-5000ms。向量搜索占比 <0.3%。

---

## 5. 资源占用对比

### 5.1 当前实测（docker stats，idle 状态）

| 容器 | 内存 | 说明 |
|------|------|------|
| flyflor-dev | 68 MiB | Bun 运行时 + 应用代码 |
| flyflor-redis | 9 MiB | 空载，几乎无数据 |
| flyflor-surrealdb | 66 MiB | RocksDB 引擎 + 空数据库 |
| **合计** | **143 MiB** | 3 容器 idle 最低开销 |

实际负载下，Redis 和 SurrealDB 内存随数据量增长。

### 5.2 降级后预估

| 组件 | 内存 | 说明 |
|------|------|------|
| Bun 运行时 + 应用 | 68 MiB | 不变 |
| MemoryComponent | +0.3 MiB | 时间窗口内 episode（~200 条 × 1.5KB） |
| VectorIndex | +0.5 MiB | 150 条 × 384 维 Float64Array |
| **合计** | **~69 MiB** | 单容器，仅为原来的 48% |

### 5.3 降级收益

| 维度 | 降级前 | 降级后 | 收益 |
|------|--------|--------|------|
| 容器数 | 3 | 1 | -67% |
| idle 内存 | 143 MiB | ~69 MiB | -52% |
| CPU（idle） | 3 进程合计 ~1.2% | 1 进程 ~0.02% | -98% |
| 网络 IO | Redis TCP + SurrealDB HTTP | 零（全部进程内） | 消除 |
| 启动依赖 | Redis healthy + SurrealDB healthy | 无 | 更快 |
| 故障面 | 2 个外部服务可能不可达 | 0 | 更可靠 |

### 5.4 热路径延迟对比

| 操作 | 降级前 | 降级后 |
|------|--------|--------|
| memory_node 召回 | ~2ms（SurrealDB HTTP + MTREE） | ~0.3ms（内存 cosine） |
| 工作记忆写入 | ~0.3ms（Redis TCP） | ~0.01ms（Map.set） |
| 工作记忆读取 | ~0.3ms（Redis TCP） | ~0.01ms（Map.get） |
| context ring 读 | ~0.2ms（Redis TCP） | ~0.005ms（Array.slice） |

> 热路径操作从「跨进程网络调用」变为「进程内内存操作」，延迟降低 10-30 倍。

---

## 6. 架构流程

### 6.1 替换前

```
flyflor ←→ surrealdb (长期晶体图)
flyflor ←→ redis (工作记忆)
flyflor ←→ brain.db / audit.jsonl (文件)

3 容器，外部依赖 Redis + SurrealDB
```

### 6.2 替换后

```
flyflor (单容器)
  ├── MemoryComponent (工作记忆，进程内存)
  ├── VectorIndex (热路径搜索，进程内存)
  ├── crystal.db (晶体智力，文件)
  ├── brain.db (自传体记忆，文件)
  └── audit.jsonl

1 容器，零外部依赖
```

### 6.3 热路径

```
Gateway → Runtime.handleMessage
  → MemoryComponent.buildPrompt
    → VectorIndex.search (内存 cosine + sort，<3ms)
    → crystal.db SELECT
    → 拼接 memory context
  → LLM generate
  → MemoryComponent.writeEpisode (Map.set + setTimeout，<1ms)
```

### 6.4 冷路径

```
BackgroundScheduler
  → ConsolidationWorker.drain → LLM决策 → crystal.db INSERT
  → DecaySweep → crystal.db UPDATE importance
  → DreamWorker.runOnce → VectorIndex.search + crystal.db UPDATE
```

---

## 7. 回收工程：记忆的完整生命周期

### 7.1 Consolidation（升格）

工作记忆 episode 定期经 LLM 决策：consolidate（升格写 crystal.db）、reinforce（延长 TTL）、discard（移除）。

### 7.2 Decay（衰减）

晶体层实体 importance 随时间下降。纯数值运算，替换后 SQL UPDATE crystal.db。

### 7.3 Dream（漂移修复）

drift-repair / recall-reinforce / contradiction-audit / reconsolidation。替换后查询 crystal.db + VectorIndex 搜索邻居，修改 crystal.db。

### 7.4 Dedupe（去重）

semantic overlap 的 gem 合并为一条。纯函数，替换后不变。

### 7.5 Snapshot（快照）

漂移修复前保留旧版本，支持审计和回滚。替换后 SQL INSERT。

### 7.6 MemoryComponent 持续机制

工作记忆的语义是「临时的、时间窗口内的」。进程重启后丢失工作记忆是正常行为——Redis 当前也不持久化。

但作为智能生命体，在**优雅退出**时保留快照、**启动时可选恢复**可提升体验：

- 收到 SIGTERM/SIGINT 时，将 `episode Map` + `context ring` + `consolidation queue` 序列化为 `~/.flyflor/working.snapshot.json`
- 快照存在且未超过 1 小时，启动时恢复工作记忆窗口
- 非优雅退出不写快照，不引入写时 IO 开销
- 不替代晶体层——晶体知识始终在 crystal.db

---

## 8. 切换策略

```
config.memory.working.backend = "local"  | "redis"
config.memory.vector.backend  = "flat"   | "surreal" | "hnsw"
```

开发默认 `local` working memory，可随时通过 config/compose override 切回 `redis + surreal`。

---

## 9. 风险

| 风险 | 缓解 |
|------|------|
| 进程重启丢失工作记忆 | 工作记忆不持久化（Redis 同等语义）；晶体知识在 crystal.db 不受影响 |
| 搜索规模扩大 | AtomScore 阈值 + anti-bloat 控制；VectorIndex 接口可换 HNSW |
| 图遍历升级 | SQLite 递归 CTE 可覆盖 |
| 文件膨胀 | 月级冷归档 + vacuum |

---

## 10. 实施计划

| 阶段 | 内容 |
|------|------|
| 1 | `VectorIndex` 接口 + `FlatBruteForceIndex` |
| 2 | `MemoryComponent`（替代 Redis）✅ local WAL + snapshot |
| 3 | `SqliteGraphStore`（替代 SurrealGraphStore） |
| 4 | DI 切换 + 配置开关 |
| 5 | 更新 docker-compose.yml |
| 6 | 全量测试回归 |

---

## 11. 回滚路径

- 配置切回 `redis + surreal`，零代码改动
- 未来可切换到 HNSW 实现，VectorIndex 接口已抽象
