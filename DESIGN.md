# Flyflor 智能体架构设计总结

本文总结当前 Flyflor 智能体架构的实际设计，包括三层智能（流体/晶体/海马体）、黑板协作、记忆系统重构方向、思考能力自我迭代的设计哲学。

记忆系统正在从 SQLite/Qdrant/Crystal 三路并行重构为 Redis 海马体 + SurrealDB 图 + 遗忘曲线 + 梦境模式。详细方案见 [docs/memory.graph.refactor.md](docs/memory.graph.refactor.md)，本文反映的是设计哲学与稳定核心，重构进行中的细节以方案文档为准。

## 0. 设计哲学

Flyflor 的核心智能模型：

- **LLM = 流体智力**：当前任务的理解、推理、生成、工具编排、黑板讨论和即时决策。
- **Crystal = 晶体智力**：把验证过的经验压缩成可复用方法，由证据门和质量门控制升格。
- **Neural = 海马体**：工作记忆（Redis）+ 长期记忆图（SurrealDB），支持 TTL 遗忘曲线、概念激活、记忆重建。

**核心原则：不在堆叠记忆上发力，而在思考能力的自我迭代上发力。**

记忆系统是基础设施，让思考有上下文；用户感知的核心是响应速度和回答质量。所有重活（反思、整合、衰减、梦境）必须在异步 worker，热路径只做 Redis O(1) 和 SurrealDB ANN。

设计原则：

1. 不在源码写死语义 bucket、关键词表或方法论 taxonomy。
2. **零字符匹配红线**：业务语义判断（意图、路由、记忆动作、反馈分类、固化触发、矛盾检测等）只能来自模型同轮返回的结构化字段或专用提示词模板的 JSON 输出，禁止任何 `text.includes`、正则识别意图、关键词列表、句式启发式。性能优化只能用资源指标（token 数、相似度数、TTL）短路，不得用关键词短路。详见 `docs/boundaries.md` 全局红线。
3. 反思不在热路径触发；episode 异步捕获，consolidation worker 后台决策。
4. Crystal Skill 是方法建议，不是事实来源。
5. 深度唤醒必须有预算、超时、hop 上限、缓存。
6. 必要提示词集中在 Markdown 模板；代码只负责协议、证据、边界、持久化。
7. 记忆膨胀必须可控：双轨衰减、矛盾检测、版本快照、强制遗忘。

代码分层保留三层智能体核心：`llm` 流体智力、`crystal` 晶体智力、`neural` 海马体。其余装配、协议、IO 围绕三层组织。

## 1. 总体架构

一次用户请求：

1. 入口归一化：渠道、消息、用户身份归一为 `GatewayMessage`。
2. 路由判断：fastRoute 启发式（90% 命中）或 LLM route，决定 `direct` / `direct-with-watch` / `blackboard`。
3. 上下文装配（热路径）：Markdown 宪法层 + Redis 最近交流 ring buffer + SurrealDB 概念激活（memory_node + skill ANN）。
4. LLM 主循环：流式生成，TTFB 目标 < 350ms。
5. 异步收尾：episode 写 Redis、ring buffer 更新、Markdown 显式动作处理；不阻塞 stream。
6. 后台 worker：consolidation（每 10 min）、decay（每 24h）、project 候选扫描（每 1h）、dream mode（空闲触发）。

当前 TypeScript 核心路径：

- `src/agent/runtime`、`src/agent/blackboard`、`src/agent/session`、`src/agent/sandbox`、`src/agent/worker`、`src/agent/mcp`
- `src/neural/memory`（Redis 工作记忆、Markdown、SQLite 审计）
- `src/crystal/memory`、`src/crystal/reflection`、`src/crystal/skills`（SurrealDB 长期图、整合、技能）
- `src/llm`（provider）、`src/protocol/contracts`、`src/agent/di`

## 2. 三种执行模式

`direct`：单智能体路径。fastRoute 启发式覆盖大多数对话；LLM route 仅在启发式未命中时启动，与主模型并行不阻塞首 token。

`direct-with-watch`：路由模式已接通，工具 churn / 重复失败 / 上下文压力升级到 blackboard 仍是 P2 待实现。

`blackboard`：动态 worker plan，session lease 防并发，3 轮目标收敛 / 5 轮硬上限，流式输出 worker 讨论。无法收敛时返回 `flyflor-decision-form` 让用户决策。

## 3. 复杂度计算

由路由 LLM 完成（`src/agent/runtime/blackboard.route.ts` + `templates/prompts/blackboard.route.md`），不是硬编码评分函数。模型返回 `mode`、`score`、`reason`、`signals`。运行时只校验枚举和 JSON shape。

讨论价值门控：blackboard 只有在结构化多 worker 讨论能暴露单次模型会漏掉的主张或风险时采用；多段结构化输出（行程、路线图）只有当各段间存在交叉约束、worker 能互相挑战时才进黑板。

## 4. 黑板工作台

实现 `src/agent/blackboard/blackboard.module.ts`，持久化 `src/agent/blackboard/sqlite.ts`（WAL，5 表：turns/steps/messages/decisions/leases）。

- 同 session 同时只能一个 turn（lease）
- worker 默认 `MaxConcurrency=1`，预算约 12000 runes
- 目标 3 轮收敛，硬上限 5 轮
- livelock 检测：两轮无新事实、重复争议、未解 blocker、重复失败工具
- 黑板讨论流式输出（worker 步骤实时回流给 TUI/CLI）

## 5. 三层智能 + 海马体记忆系统

### 5.1 宪法层（Markdown）

`workspace/AGENT.md`、`SOUL.md`、`USER.md`、`memory/MEMORY.md`：智能体身份、用户偏好、项目长期事实。人可读、可手编辑，ContextBuilder 跟踪 mtime。只接受用户显式 memory action（type=remember 或 high-confidence skill 提升）写入。

### 5.2 工作记忆（Redis，海马体短期缓冲）

实现：`src/neural/memory/redis.ts`（重构后引入）。

Key schema：
- `ff:ep:{userId}:{id}`  HASH：单条 episode，TTL = stability × ln(2)
- `ff:ctx:{userId}`      LIST：最近 12 轮对话 ring buffer，对话连贯性
- `ff:cq:{userId}`       ZSET：整合候选队列（按预计过期时间排序）
- `ff:act:{userId}`      ZSET：概念激活热度

写入时序（异步，不阻塞 stream）：
1. 提取概念（matrix.ts TfIdf，无 LLM）
2. 计算 importance（保留现有 weightsFromAction）
3. 计算 stability → TTL
4. HSET + EXPIRE，ZADD 整合队列，LPUSH ring buffer

### 5.3 长期记忆图（SurrealDB）

实现：`src/crystal/memory/surreal.ts`（重构后扩展）。

主表：
- `episode`：片段，MTREE 向量索引 256 维
- `memory_node`：概念聚合
- `skill`：晶体技能，可 protected
- `skill_snapshot`：版本快照（防漂移不可追溯）

关系表（图边）：
- `next_context`、`similar_ep`、`consolidated_into`、`similar_concept`、`proven_as`、`proven_by`

### 5.4 审计层（SQLite）

`src/neural/memory/sqlite.ts`：仅审计 log（不再用于上下文装配）。Blackboard 状态保留。

## 6. 上下文装配（无 Session 概念激活）

替代旧 session-driven 路径，新 buildPrompt 流程：

1. 提取概念 + embedding（无 LLM）
2. 并行：Redis ring buffer + SurrealDB 概念激活（symbols 匹配 + ANN + 第 2 跳图扩散）
3. Skill 召回（symbols + ANN + confidence 加权）
4. 组装上下文（按 token budget 截断）

优先级：宪法层 → 最近对话 → 激活 memory_node → 相关 skill → 工作记忆 episode → 黑板摘要。

**Reconstruction 模式**：当激活 ≥3 个 memory_node 且有 similar_concept 边时，注入 reconstruction-hint，让 LLM 重建记忆关系而非死读。

## 7. 晶体智力候选与升格

候选三个来源（保留现有逻辑）：
- A. runtime LLM 反思（重构后改为整合 worker 异步触发）
- B. promoted memory（用户显式提升）
- C. session history（evidence weight = 0，不结晶）

**Evidence Weight 裁判表（核心质量门，新架构原样保留）：**

| sourceKind | weight |
|---|---|
| direct / unverified | 0.0 |
| blackboard-needs-user | 0.65 |
| blackboard-converged | 0.8 |
| explicit | 0.9 |

**双质量门（重构后）：**
- 门 1：episode cluster sourceKind weight gate
- 门 2：memory_node confidence > 0.5 AND evidenceCount ≥ 3 → 升格 skill

`mergeCrystalSkill` 逻辑完整保留，直接复用。

## 8. 遗忘曲线与晶体偏移防控

### 8.1 双轨衰减
- `decayRate`：episode 5%/天、memory_node 2%/天、skill 0.5%/天
- 时效性衰减：基于 `lastVerifiedAt`，超 `verificationIntervalDays`（默认 30）每 30 天 confidence × 0.8

### 8.2 强化（recall 触发）
- 短期（Redis 工作记忆）：stability × 1.5（温和）或 × 2.5（完整）
- 长期（SurrealDB）：importance × 1.1，重置 lastAccessedAt

### 8.3 矛盾检测（晶体偏移防控）
ConsolidationWorker LLM 决策新增 `contradict` 动作：
- skill.contradictionCount += 1
- skill.confidence × (1 - contradictWeight × 0.3)
- < 0.3 降级 memory_node，< 0.1 deprecated 归档

### 8.4 数量膨胀防控
- Redis：`maxEpisodesPerUser=200`，超出 ZPOPMIN 强制遗忘
- SurrealDB 分层：episode 500 / memory_node 100 / skill 50，超出归档（保留数据）
- Skill 去重：相似度 > 0.9 → merge

### 8.5 状态机
`candidate → active → {consolidated|demoted|deprecated|archived}` + 横切 `snapshot`

## 9. Feedback Interpreter 与思考自我迭代

> 「真正核心不是 memory/blackboard/worker，而是反馈如何被理解和吸收」

反馈四类（A/B/C/D）映射到不同记忆路径：

- **A 局部纠错**：episode sourceKind="correction"，weight=0.7，待 cluster 决定 contradict
- **B 偏好表达**：memory_node preference cluster，下次激活高权重
- **C 全局策略**：写宪法层 + 创建 protected style-constraint skill
- **D 验证确认**：相关 skill 强化 + 重置 lastVerifiedAt

## 10. 事件与项目固化

**三条触发路径：**
- A 显式：memory action `project-init` / `event-record`
- B 自动 cluster：≥5 episode + 跨 ≥2 turn + ≥1 黑板收敛 + score > 0.5 → 询问用户
- C 技能升格：skill.support ≥5 + confidence > 0.7 → 自动追加 MEMORY.md

固化产物：`workspace/projects/{id}/{README,TODO,DESIGN}.md` + SurrealDB `projectRef` 反向标记。归档时 LLM 生成 `RETROSPECTIVE.md`。

## 11. 性能保障

热路径目标 TTFB < 350ms：
- 反思 LLM 完全离开热路径（移到 worker）
- fastRoute 启发式 60–70% 命中跳过 LLM route（省 250ms）
- LLM route 与主模型并行启动
- Redis 连接预热、ANN LRU 缓存、embedding 复用、prompt 模板内存缓存
- rememberTurn 4 路完全并行（10–20ms）

后台 worker 资源预算：
- consolidation token 预算 50K/天
- project init token 预算 20K/天
- 全局并发 LLM ≤ 2

详细分解见 [docs/memory.graph.refactor.md §15](docs/memory.graph.refactor.md)。

## 12. 梦境模式（占位设计）

Agent 空闲时的离线认知整合，对应人类海马体回放：
- 重组（Recombination）：低相关 memory_node LLM 联想 → 新 similar_concept 边
- 矛盾审计（Contradiction Audit）：跨 skill 全局矛盾扫描
- 主题压缩（Theme Compression）：concepts 聚类 → 减少节点数

Reconstruction（清醒）+ ConsolidationWorker（短期）+ Dream Mode（长期）= 思考能力自我迭代链路。

详细见 [docs/memory.graph.refactor.md §16](docs/memory.graph.refactor.md)。

## 13. 运行时可观察性

关键事件：
- `agent.turn.start` / `agent.turn.end`
- `agent.complexity.assessed`
- `agent.blackboard.escalated`
- `agent.sandbox.assessed`
- `agent.llm.request` / `agent.llm.response`
- `agent.tool.exec_*`
- `agent.context.compress`
- 重构后新增：`PerfTTFB`、`PerfBuildPrompt`、`PerfRouteLLM`、`RedisLatency`、`SurrealAnnLatency`、`MemoryEpisodeCaptured`、`MemoryConsolidated`、`MemoryForgotten`、`MemoryDecayed`

## 14. 风险预警

- 源码写死 bucket / 关键词 / taxonomy → Crystal Memory 退化为规则工程
- candidate 不经证据门直接结晶 → 垃圾污染未来规划
- 深度唤醒无预算 → 拖慢热路径
- 无遗忘曲线 → 过期经验干扰；遗忘过强 → 低频关键方法丢失
- 反思在热路径 → TTFB 飙升（**已在重构方案中根除**）
- 矛盾不被检测 → 晶体偏移稳定化
- ioredis 不兼容 bun compile → 需要 RESP-over-Bun-TCP 备选

## 15. 一句话总结

Flyflor 是：LLM 处理当前任务；fastRoute + 黑板把复杂工作变成可观察、可收敛、可交还的协作流程；Markdown 是宪法层；Redis 是海马体短期缓冲（带遗忘曲线）；SurrealDB 是长期记忆图（episode → memory_node → skill）；通过双质量门、矛盾检测、双轨衰减保证晶体智力不膨胀不偏移；目标不是堆叠记忆，而是让思考能力随时间持续自我迭代。
