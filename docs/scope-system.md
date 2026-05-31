# Scope 系统

## 目的

用户的"项目/事情"固化层。Scope 具有独立的宪法层记忆（scope.db），与 MemoryComponent（全局热记忆）分离。当用户提起 Scope 关键词，智能体通过向量范围动态装载 Scope 记忆，进入"回忆中"模式。用户频繁提起的项目/事情形成 codename 候选，经 ASK 确认后升格为正式 Scope。

参考：openhuman 的知识树向量召回、Source Tree + Topic Tree 双层结构。

## 与 MemoryComponent 的关系

Scope **不拥有自己的 recall 路径**。Scope 记忆写入 MemoryComponent（走 B 路径），利用现有 treeRecall 自然召回。Scope 的职责是：

1. **检测**关键词 → 激活"回忆中"模式
2. **管理** scope.db（Scope 专属向量索引 + 宪法数据）
3. **提名** codename 候选 → 达到阈值触发 ASK
4. **注入** Scope 上下文到知识树线索包

```
用户输入 "flyflor 的模块结构"
  → IntentAnalyzer 分析意图（正常流程）
  → ScopeService 检测到 "flyflor" 是已注册 Scope 关键词
  → emit('scope.activated', { scopeId, scopeName })
  → MemoryComponent.treeRecall("flyflor 模块结构") // 走正常 recall
  → Scope 相关记忆因 namespace='scope:flyflor' 自然排在前面
  → 进入"回忆中"模式标记
```

## 模块结构

```
src/scope/
  index.ts
  scope.module.ts
  scope.types.ts
  scope.service.ts           # @Service() ScopeService
  scope.store.component.ts   # @Component() scope.db 管理
```

## scope.db Schema

scope.db 是独立的 SQLite 数据库（带 sqlite-vec），存储 Scope 专属的宪法层数据。

```sql
-- scope.db 表结构

create table if not exists scopes (
  id text primary key,
  name text not null,
  codename text not null unique,
  namespace text not null,
  keywords text not null,       -- JSON array of trigger keywords
  constitution text not null,   -- Markdown 宪法定义
  status text not null,         -- 'active' | 'archived'
  created_at integer not null,
  updated_at integer not null
);

create table if not exists scope_vectors (
  rowid integer primary key,
  embedding blob not null       -- 4-dim float vector (复用 MemoryComponent.embed)
);
-- 通过 sqlite-vec 的 vec0 虚拟表实现

create virtual table if not exists scope_vec_index using vec0(
  embedding float[4]
);

create table if not exists scope_recall_log (
  id text primary key,
  scope_id text not null,
  query text not null,
  result_ids text not null,
  created_at integer not null
);

create index if not exists idx_scope_recall_scope
  on scope_recall_log(scope_id, created_at);
```

## 信号契约

### 发射

| 信号 | payload | 说明 |
|------|---------|------|
| `scope.detected` | `{ conversationId, turnId, keywords, matchedScopeIds }` | 检测到 Scope 关键词 |
| `scope.activated` | `{ conversationId, scopeId, scopeName, loadedAt }` | 进入回忆模式 |
| `scope.deactivated` | `{ conversationId, scopeId, reason }` | 退出回忆模式 |
| `scope.candidate.nominated` | `{ namespace, codename, mentionCount, firstMentionedAt, lastMentionedAt }` | 新 codename 候选 |
| `scope.created` | `{ scopeId, codename, namespace, dbPath, createdAt }` | Scope 正式创建 |
| `scope.recall_mode.started` | `{ conversationId, scopeId, scopeName }` | 回忆中指示器 |
| `scope.recall_mode.ended` | `{ conversationId, scopeId }` | 回忆结束 |

### 订阅

| 信号 | 用途 |
|------|------|
| `chat.message` | 扫描用户每条消息中的 Scope 关键词 |
| `context.intent` | 当 ContextPolicy 允许时注入 Scope 上下文 |
| `memory.store` | 将带 scope namespace 的记忆镜像到 scope.db |
| `memory.recall` | 回忆模式激活时增强全局召回 |
| `crystal.ask.answered` | 用户确认 Scope 创建后执行 |
| `turn.decision.completed` | 当决策定位到已知 Scope 时注入 |

## Codename 候选 → 升格流程

```
用户频繁提起某个项目/事情
         │
         ▼
ScopeService 追踪提及频率
         │
    ┌────┴────┐
    │ 达到阈值？ │ ← 默认 30 天内提及 ≥5 次
    └────┬────┘
   是    │    否 → 继续追踪
         ▼
emit('scope.candidate.nominated', { codename, mentionCount })
         │
         ▼
发射 crystal.ask.created（由 CrystalService 处理）
  ASK: "检测到你频繁提到「XXX」，是否创建为独立 Scope？"
         │
    ┌────┴────┐
    │ 用户确认  │
    └────┬────┘
   是    │    否 → 标记为 dismissed
         ▼
Scope 正式创建
  1. 创建 scope.db 记录
  2. 初始化 scope_vectors 表
  3. 将历史相关 memory chunks 镜像写入 scope.db
  4. emit('scope.created')
```

## 回忆中模式

```
检测到 Scope 关键词
         │
         ▼
emit('scope.activated')
emit('scope.recall_mode.started')
         │
         ▼
后续 N 个 turn（默认 3 个 turn 或用户主动退出）
  ContextBuilder 注入 Scope 宪法摘要
  MemoryRecall 偏好 scope namespace
         │
         ▼
3 turns 后或话题切换 → emit('scope.recall_mode.ended')
```

## 内核改动

无需修改 `AgentRuntimeService`。ScopeService 是独立 `@Service()`。

唯一内核相关改动：
- `SocketServerService.attachRuntimeBroadcasts()` 添加 `scope.*` 信号
- `KernelModule` 导入 `ScopeModule`
- `ConfigPaths` 添加 `scopeDir: './.config/scope'`

## 红线确认

- Scope 记忆写入 MemoryComponent，走现有 recall 路径 ✅
- scope.db 独立管理宪法层数据，不与 memory.db 混淆 ✅
- sqlite-vec 复用 SqliteVecLoader ✅
- 所有事件通过 SignalBus ✅
- 不修改 AgentRuntimeService ✅
- OOP class 封装 Scope 逻辑 ✅
- 配置路径相对项目根 ✅
