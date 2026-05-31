# Crystal 晶体智力

## 目的

LLM 处理问题遇到无法决策时，通过提示词工程生成结构化 ASK JSON 向用户抛出 1-n 个问题。用户选择后事件继续，形成**结晶候选**。同类型候选命中一定次数后，由 LLM 自我总结升格为**晶体智力 Gem**（类似于 SKILL 的做事方式），存入 CrystalComponent 向量数据库供后续匹配复用。

参考：hermes-agent 的 clarify tool（阻塞式 ASK）、openhuman 的 entity hotness 评分。

## ASK 由 LLM 生成，不走代码硬编码

ASK JSON 格式由 `prompts/ask.schema.md` 定义（见 Prompts 协议层文档）。LLM 根据提示词工程自行判断何时输出 ASK，不通过代码规则触发。

## 模块结构

```
src/crystal/
  index.ts
  crystal.module.ts
  crystal.types.ts
  crystal.service.ts         # @Service() CrystalService
  crystal.store.component.ts  # @Component() CrystalStore (crystal.db)
```

## crystal.db Schema

Gem 向量数据库，独立于 memory.db 和 scope.db。

```sql
create table if not exists crystal_candidates (
  id text primary key,
  pattern_key text not null,          -- 模式标识（namespace+predicate 的 hash）
  ask_context text not null,           -- 触发 ASK 的上下文摘要
  resolution text not null,            -- 用户选择的答案
  hit_count integer not null default 1,
  first_hit_at integer not null,
  last_hit_at integer not null,
  status text not null default 'candidate'  -- 'candidate' | 'ready' | 'elevated' | 'replaced'
);

create table if not exists crystal_gems (
  id text primary key,
  name text not null,
  summary text not null,              -- LLM 自我总结的做事方式
  pattern_key text not null,
  prompt_template text not null,      -- 可注入上下文的 prompt 模板
  confidence real not null default 1,
  hit_count integer not null default 0,
  last_matched_at integer,
  created_at integer not null,
  updated_at integer not null,
  status text not null default 'active' -- 'active' | 'stale' | 'archived'
);

create table if not exists crystal_vectors (
  rowid integer primary key,
  embedding blob not null
);

create virtual table if not exists crystal_vec_index using vec0(
  embedding float[4]
);

create table if not exists crystal_ask_log (
  id text primary key,
  ask json not null,                   -- 完整 ASK JSON
  answer json,                         -- 用户回答
  turn_id text not null,
  created_at integer not null
);
```

## 信号契约

### 发射

| 信号 | payload | 说明 |
|------|---------|------|
| `crystal.ask.created` | `{ askId, conversationId, turnId, questions }` | ASK 已生成 |
| `crystal.ask.answered` | `{ askId, questionId, selectedOptionId }` | 用户已回答 |
| `crystal.ask.resolved` | `{ askId, resolution, crystallized }` | ASK 已解决 |
| `crystal.ask.timeout` | `{ askId, timeoutAt }` | ASK 超时未回答 |
| `crystal.candidate.formed` | `{ candidateId, patternKey, askContext, resolution, hitCount }` | 新结晶候选 |
| `crystal.candidate.reinforced` | `{ candidateId, hitCount, lastHitAt }` | 候选再次命中 |
| `crystal.candidate.ready` | `{ candidateId, patternKey, totalHits }` | 候选达到升格阈值 |
| `crystal.gem.elevated` | `{ gemId, gemName, summary, elevatedAt }` | 候选升格为 Gem |
| `crystal.gem.loaded` | `{ gemId, gemName, matchScore }` | Gem 被加载到上下文 |
| `crystal.gem.applied` | `{ gemId, gemName, turnId, outcome }` | Gem 成功应用于当前场景 |
| `crystal.gem.expired` | `{ gemId, gemName, reason }` | Gem 漂移过大标记为过期 |
| `crystal.eq.adjusted` | `{ dimension, previousWeight, newWeight, reason }` | EQ 权重调整 |

### 订阅

| 信号 | 用途 |
|------|------|
| `chat.message` | 扫描用户消息中的 ASK 回答 |
| `context.intent` | 检查当前意图是否匹配已知 Gem |
| `turn.decision.completed` | 记录决策用于候选模式匹配 |
| `model.reasoning` | 检测 LLM 不确定性信号（不用于触发 ASK） |
| `sandbox.escalated` | Sandbox 无法判断的请求，升格为 ASK |
| `agent.error` | 捕获需要用户决策的失败场景 |
| `crystal.ask.answered` | 处理用户回答 → 形成候选 |

## 结晶候选 → Gem 升格流程

```
ASK 被用户回答
       │
       ▼
CrystalService 提取 pattern_key
  (namespace:subject:predicate → sha256)
       │
  ┌────┴────┐
  │ 已有候选  │
  └────┬────┘
  是   │    否 → 创建新候选
       │         emit('crystal.candidate.formed')
       ▼
  增加 hit_count
  emit('crystal.candidate.reinforced')
       │
  ┌────┴────┐
  │ hit >= 阈值? │ → 默认 3 次
  └────┬────┘
  是   │    否 → 继续观察
       ▼
  emit('crystal.candidate.ready')
       │
       ▼
  LLM 自我总结
  （使用 prompts/crystal-gem-summarize.md）
  生成 Gem 定义：
    - name: 简短名称
    - summary: 做事方式描述
    - prompt_template: 可注入的 prompt
       │
       ▼
  存储到 crystal.db
  emit('crystal.gem.elevated')
       │
       ▼
  同一 pattern 的新 ASK → 自动匹配 Gem
  emit('crystal.gem.loaded')
```

## Gem 匹配

每个 turn 开始时，CrystalService 将当前意图与 crystal.db 中的 Gem 进行向量匹配：

```
ContextIntentDecision
  → CrystalService 提取意图特征
  → embed(意图特征) → 在 crystal_vec_index 中搜索
  → 返回 top-K 匹配 Gem
  → 将匹配 Gem 的 prompt_template 注入 ContextBuilder
```

## EQ 机制

EQ 是一个数值调节维度，用于控制 ASK 的主动性。

| 维度 | 范围 | 说明 |
|------|------|------|
| `ask_frequency` | 0-1 | ASK 频率倾向（高=更主动问、低=更独立） |
| `clarify_before_act` | 0-1 | 操作前澄清倾向 |
| `delegate_to_worker` | 0-1 | 委托 Worker 的倾向 |

EQ 权重随时间调整：用户频繁拒绝 ASK → 降低 ask_frequency；用户频繁接受 → 提高。调整通过 `crystal.eq.adjusted` 信号发出。

## 内核改动

无需修改 `AgentRuntimeService`。CrystalService 是独立 `@Service()`。

唯一内核相关改动：
- `SocketServerService.attachRuntimeBroadcasts()` 添加 `crystal.*` 信号
- `KernelModule` 导入 `CrystalModule`
- `ConfigPaths` 添加 `crystalDb: './.config/crystal/crystal.db'`

## 红线确认

- ASK 由 LLM 通过提示词工程生成 JSON，不硬编码 ✅
- crystal.db 独立于 memory.db，使用 sqlite-vec ✅
- Gem 是 LLM 自我总结，不等同于硬编码规则 ✅
- 所有事件通过 SignalBus ✅
- OOP class 封装 ✅
- 不修改 AgentRuntimeService ✅
- 配置路径相对项目根 ✅
