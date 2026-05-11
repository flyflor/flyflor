# Skill/MCP 记忆链路审查

> 审查视角：无 session 智能体 + 海马体记忆偏移防控
> 2026-05-12

## 0. 核心判断

**最大的问题不是 Skill/MCP 本身的实现完整性，而是它们产生的知识没有进入记忆闭环。**

### 2026-05-12 更新

本轮已补上第一层闭环：

- Runtime 每轮发布 `skill.context.built`、`mcp.tool.catalog.built`、`mcp.tool.call.executed`。
- `GatewayReply.metadata` 记录 `skills`、`mcpToolCalls`、`mcpToolExecutions`。
- Redis episode 写入 `metadata.provenance.skillNames` 和 `metadata.provenance.mcpCalls`。
- 有成功 MCP 调用的 episode 使用 `sourceKind = mcp-augmented`。
- Consolidation prompt 的 episode block 现在包含 episode metadata，LLM 能看到 Skill/MCP provenance。
- Runtime reflection evidence 现在包含 `skillNames` 和 `mcpCalls`；成功 MCP 调用会触发 reflection 提取。
- `detectClusterCandidate` 接受 `mcp-augmented` 作为收敛证据，项目局部记忆可覆盖 MCP 辅助完成的问题。
- Runtime 对 stdio MCP `tools/list` 加了 30 秒 TTL 缓存，减少热路径重复 discovery。
- 项目本地 `.flyflor/skills/skill.usage.jsonl` 和 `.flyflor/skills/skill.usage.summary.json` 已记录 skill `useCount`、`lastUsedAt`、MCP 调用数和成功数，给后续 support/热度排序提供真实数据源。
- Streamable HTTP MCP runtime client 已接入 `initialize`、`tools/list`、`tools/call`，支持 `Mcp-Session-Id` 会话头和 JSON/SSE 响应解析。

仍未完成：

- sessionKey 还未从核心记忆类型中降级为纯审计字段。
- skill 选择仍主要是显式请求优先 + 默认前 4 个；还没接 embedding/热度排序。
- 旧式单独 SSE endpoint 兼容还未实现；当前 remote runtime 按 MCP Streamable HTTP transport 实现。

## 后续计划

P0：补完整 MCP remote transport 兼容

- Streamable HTTP 已完成。
- 后续补旧式 SSE 双端点兼容和 auth/secrets provider 头注入。
- 增加 remote transport 的 CLI inspect/doctor 检查。

P0：Skill 选择从固定前 4 个升级为有数据依据的排序

- 使用 `skill.usage.summary.json` 的 `useCount`、`lastUsedAt`、`mcpSuccessCount` 形成 support 基线。
- 再接 embedding 相似度和 capability/compatibility 结构化字段。
- 保持显式 `--skills` 最高优先级，不从用户文本做关键词推断。

P1：Skill promotion 接入真实 support

- `detectSkillPromotion` 读取 usage summary 中的 support/useCount。
- promotion 结果进入 project memory 或 crystal skill 候选。
- 仍由结构化数值阈值驱动，不做字符串语义规则。

P1：session 降级为审计层

- recent session context 热路径迁移到 Redis ring buffer。
- SQLite session 只保留审计、CLI 查看和导出。
- 核心记忆候选逐步减少对 `sessionKey` 的依赖。

P2：工具/技能调试面

- `skills usage [name] --json` 查看项目内 usage summary。
- `mcp inspect <name>` 同时展示配置、transport、catalog cache 状态、最近调用摘要。
- `doctor --fix` 后续可以修复缺失目录、损坏 JSONC 和禁用的 MCP server。

审查时，Skill 和 MCP 在架构里接近"用完即走"的 stateless 通道。它们影响模型回答，回答被写成 episode，但**技能使用记录、工具调用过程、工具返回的数据**没有进入可复用的记忆证据。这意味着：

- Consolidation worker 看到的 episode 和"纯对话"episode 没有区别，无法区分"这是 skill 引导的回答"还是"模型自由发挥"
- Crystal 无法从工具辅助的对话中提炼方法知识
- 项目记忆触发路径不认识 MCP 收敛，MCP 协助解决的复杂问题永远不会触发 project candidate
- 系统无法学习"哪个 skill 对哪个用户有用"

## 1. Session 残留：无 session 设计的最大障碍

### 现状

架构目标是"无 session"，但 sessionKey 仍然贯穿整个记忆系统：

```
gateway message
  → scopeFor(message) 生成 sessionKey = "channel:accountId:chatId:threadId"     ← 这里是 session
  → buildPrompt 中调用 session.recentMessagesFor(message)                        ← 读 session
  → rememberTurn 中调用 session.recordTurn(message, reply)                       ← 写 session
  → 每个 memory candidate 携带 sessionKey                                       ← 传播 session
  → crystal.recordTurn 接收 sessionKey 用于去重                                  ← 依赖 session
  → markdown appendHistory 携带 sessionKey                                       ← 审计依赖 session
  → blackboard.startTurn 用 scopeFor 做 session lease                            ← 黑板依赖 session
  → fastRouteSnapshots 用 (channel, chatId, user) 做 key                         ← 等同 session 状态
```

### 问题

1. **记忆检索已经被 sessionKey 污染** — `MemorySearchRequest` 包含 `scope` 字段，但海马体（Redis）的实际 key 只用 `userId`。sessionKey 是个多余的维度。
2. **session 边界模糊了记忆连续性** — 同一用户在 channel A 和 channel B 的对话被分到不同 session，但海马体不区分渠道。sessionKey 的存在让"该不该跨 session 召回"成为模糊地带。
3. **SQLite 作为 session 存储拖累了无状态化** — `recordTurn` 写入 SQLite、`recentMessagesFor` 读 SQLite，这是 warm path 上的 I/O。如果 session 只是审计日志，不应该出现在 `buildPrompt` 热路径上。

### 建议

- 把 session 降级为纯审计层：`recordTurn` → 只写 SQLite（审计），不参与上下文装配
- `buildPrompt` 的最近对话连续性改由 Redis ring buffer 承担（`readContextRing` 已经做了）
- 移除 `sessionKey` 在 `MemoryCandidate`、`CrystalTurnInput` 等核心类型中的依赖
- `fastRouteSnapshots` 的 (channel, chatId, user) key 应改为 (userId) — 同一用户跨渠道共享路由状态

## 2. Skill 记忆冷区

### 缺陷 2a：episode 不记录技能使用

每轮 `loadSkills` → `selectSkills` → 注入 prompt，但 `writeEpisodeToRedis` 只写对话文本，没有技能信息。

```
writeEpisodeToRedis 的 text 字段:
  "[user] 帮我重构这个函数\n[assistant] 好的，根据 Clean Architecture 技能..."

consolidation worker 看到的:
  一段对话文本，完全不知道 "Clean Architecture" 这个 skill 被用上了
```

结果是 consolidate 决策时，重要度的来源不透明。模型选了 consolidate 可能是因为用户确认了回答质量，也可能是因为 skill 本身质量高——episode 无法区分。

### 缺陷 2b：skill 选择没有记忆反馈

`selectSkills` 只是 `skills.slice(0, limit)`。

对比海马体的 `spreadActivation`（embedding + 热度排序），skill 选择缺少类似机制：
- 不对比 context embedding 做相关度排序
- 不看过去哪些 skill 产生了高重要度 episode
- 不看 hotConcepts 与 skill 的 symbols 匹配
- 不使用 dream 或 consolidation 来淘汰无用 skill

### 缺陷 2c：skill support 计数器没有数据来源

`detectSkillPromotion` 检查 `skill.support >= 5`，但 **没有任何代码在累加 skill.support**。这个字段没有写入点。

### 建议

```typescript
// writeEpisodeToRedis 增加 skillNames
writeEpisodeToRedis(message, reply, context, importance, selectedSkillNames)
```

- episode 增加 `skillNames: string[]` 字段。consolidation worker 看到的 episode 文本里标注 `[skills: clean-architecture, code-review]`
- `selectSkills` 增加 embedding 门控：只有与当前 query embedding 相似度 > threshold 的 skill 才加载
- 在 `rememberTurn` 后累加被使用 skill 的 `lastUsedAt` 和 `useCount`，给 detectSkillPromotion 提供真实数据

## 3. MCP 记忆冷区

### 缺陷 3a：工具结果蒸发

完整的数据流：

```
模型请求 tools/call → 收到结果 → 回灌模型 → 生成最终回答 → writeEpisodeToRedis
                                                              ↓
                                                    只写了 "[user] 查一下用户数\n[assistant] 当前是 1,284"
                                                    工具返回的具体数据全部丢失
```

下一轮用户说"刚才那个数字是多少？"——模型看不到。不在 episode 里，不在 ring buffer 里，不在任何记忆层里。

对比黑板辩论有一整套 `recordDebateEpisode`（高权重、附带辩论摘要），MCP 增强的回合完全相同的场景但没有类似的特殊处理。

### 缺陷 3b：项目记忆不识别 MCP 收敛

`detectClusterCandidate` 要求 `hasConverged = some e.sourceKind === "blackboard-converged"`。

但通过 MCP 工具链完成的多步分析（查 API → 分析结果 → 确认方案）的 episode，其 `sourceKind` 是 `"session-turn"`，永远不会触发 project candidate。

### 缺陷 3c：tools/list 每轮重复发现

`buildMcpToolCatalog` 在每轮 `handleMessage` 中 spawn 子进程做 MCP initialize + tools/list。

- 没有 TTL 缓存。工具列表很少变化但每轮重做 I/O
- 子进程的 session 状态（数据库连接、认证 token）每轮重置
- 产出结果（可用工具列表）在整轮对话中不变，纯属浪费

### 建议

- 新增 `recordMcpEpisode` 方法（类比 `recordDebateEpisode`），包含：
  - 用户原始请求
  - MCP 工具调用摘要（用得哪些工具、返回了什么）
  - 模型基于工具结果的最终回答
  - `sourceKind = "mcp-augmented"`
- `detectClusterCandidate` 增加 `sourceKind === "mcp-augmented"` 作为 alternative 收敛信号
- `buildMcpToolCatalog` 加 30 秒 TTL LRU 缓存

## 4. Reflection 盲区

### 缺陷 4a：reflection 证据不包含工具信息

`renderReflectionEvidence`（`reflection.ts:126`）生成的证据 JSON 只有：

```json
{
  "request": "用户问题",
  "route": { "mode": "direct", ... },
  "blackboard": { ... },
  "answer": "模型回答"
}
```

没有 `mcpCalls`、没有 `toolResults`、没有 `skillNames`。

这意味着 `crystal.reflection.md` 收到的证据是残缺的。模型从工具调用结果中推导出的方法知识不会被提取，因为证据中没有呈现出"模型是通过工具才确认这个结论的"。

### 建议

`extractRuntimeReflectionCandidates` 的 `RuntimeReflectionSource` 增加 `mcpCalls?: Array<{server, tool, ok, resultSummary}>` 和 `skillNames?: string[]`。

## 5. 海马体维度上的综合影响

```
                       当前                             理想
技能选择    ────  slice(0, limit)                 embedding + 记忆热度的排序
技能效果    ────  无记录                          episode 标记 + support 计数
工具结果    ────  蒸发（只留回答文本）             recordMcpEpisode 保留摘要
工具知识    ────  reflection 看不到               reflection 证据含工具信息
session     ────  贯穿所有核心类型                降级为纯审计，热路径用 Redis ring
项目记忆    ────  只看 blackboard-converged       增加 mcp-augmented 识别
```

所有这六个断链有一个共同根源：**episode 记录的数据模型太薄**。

当前 episode 字段：
```
episodeId, userId, text, concepts, embedding, importance, stability, sourceKind, createdAt, ttlSeconds, metadata
```

`text` 是对用户可见的回答文本，不是知识提取的输入。`metadata` 存在但没有被结构化使用（consolidation worker 读 episode 时只传 episode block，metadata 没有被序列化进去）。

### 根本改善方向

给 episode 增加一个 `provenance` 块（来源标注）：

```typescript
interface EpisodeProvenance {
    skillNames?: string[];
    mcpCalls?: Array<{
        server: string;
        tool: string;
        ok: boolean;
        resultSummary: string;  // 结果摘要，非原始 payload
    }>;
    reflectionRequested?: boolean;
    blackboardTurnId?: string;
}
```

这样 consolidation worker 看到的 episode = 文本 + provenance，能做出更好的 consolidate/discard 决策。

## 6. 优先修复顺序

| 优先级 | 改动 | 工作量 | 影响 |
|--------|------|--------|------|
| P0 | sessionKey 从 `MemoryCandidate`、`CrystalTurnInput` 等核心类型中移除，降级为审计 | 中 | 彻底无 session 化的前提 |
| P0 | `writeEpisodeToRedis` 增加 skillNames + mcpCalls 记录 | 小 | 直接决定记忆质量 |
| P1 | `selectSkills` 增加 embedding 门控 | 中 | skill 不再是冷加载 |
| P1 | buildMcpToolCatalog 加 TTL 缓存 | 小 | 热路径性能 |
| P1 | 新增 `recordMcpEpisode`（仿 `recordDebateEpisode`） | 小 | MCP 知识进入记忆 |
| P2 | `detectClusterCandidate` 增加 mcp-augmented 识别 | 小 | 项目记忆覆盖 MCP |
| P2 | reflection 证据增加 mcpCalls + skillNames | 中 | crystal 方法提取覆盖工具场景 |
| P3 | session.recentMessagesFor 从 buildPrompt 热路径移除，由 Redis ring buffer 替代 | 大 | 彻底无 session 化 |

## 7. 关于 ioredis 的附注

DESIGN.md 已经标注了 ioredis 不兼容 bun compile 的风险。如果 session 降级为纯审计（SQLite），Redis 的负载会更纯粹：只有 `ff:ep`、`ff:ctx`、`ff:cq`、`ff:act`、`ff:dream` 五类 key。此时如果 ioredis 真的出了问题，替换为 Bun 原生 RESP 实现的成本更低——因为需要兼容的操作更少了（没有 session 相关的复杂查询）。
