# 生命体重构（Life-form Architecture）

> Status: **active — phase R0 (docs & boundaries) 进行中**。本文档与 `TODO.md` 「生命体重构」章节、`docs/boundaries.md` §11.1 联动。

## 一句话定位

把 Flyflor 从「带记忆的智能体」推进为「在时间里持续活着的生命体」：

**单文件大脑 + 会提问 + 显式代号 + 幽灵上下文 + 主动校正 = 持续连续、可被纠错的对等认知体。**

## 兑现「生命体」的五件事

| # | 维度 | 工程实现 |
| --- | --- | --- |
| 1 | 单文件大脑 | `~/.flyflor/brain.db`：event/state 分离、append-only、单库 + 时间字段 + 索引；月级冷归档可选 |
| 2 | 显式协作 | Ask 是一等公民：模型在不确定时**中断式**反问；reply / ask 在同轮二选一 |
| 3 | 思维边界 | Codename：用户显式 `@代号` 锚点；频次 + 衰减自然上浮为常驻；可升格为 Project |
| 4 | 不丢失的未完事项 | Ghost Context：Ask 中断时落 brain.db 的一种特殊 episode；用户可见、可主动 resume、自然衰减 |
| 5 | 死亡 = 失忆而非删除 | AtomScore 衰减至阈值下；原文不删；可被重新激活 |

## 核心决策

| ID | 决策 | 备注 |
| --- | --- | --- |
| D1 | 完全删除 session 概念 | 协议 / 存储 / 提示词禁用 `sessionId / sessionKey / sessionScope / legacySessionKey` |
| D2 | **brain.db 单库**（取代按天 journal） | 单文件 + 时间字段 + 索引 + summary 表 + event/state 分离；月级冷归档为可选优化 |
| D3 | Atom 作为 episode 的视图字段 | 热相由模型同轮结构化输出派生；**取消冷相离线 refine** |
| D4 | Codename 接管"工作上下文边界" | 显式 `@xxx` 强绑定；无 `@` 但多候选 → Ask；频次上浮为常驻；可升格 Project |
| D5 | Ask 一等公民 + 中断模型 | reply / ask 同轮互斥；ask 必须得到答复或被用户新输入显式 cancel |
| D6 | Ghost Context 作为未完事项快照 | 复用 episode + AtomScore 框架；用户可见、可 resume / drop / pin |
| D7 | identity 自写：直接 append + 可 revert | `revert.log.jsonl` 是契约，不是日志 |
| D8 | `RuntimeMode.Dormant` | 无输入 10min 进入；gateway 监听不停（行为契约，不可配） |
| D9 | Dream 只放大、不创造修正 | 候选选择只用已记录的 negative 信号；无信号源时 pass 0 写操作 |

> 与上一版差异：旧 D2「按天 journal 分文件」**作废**，按 ChatGPT 与作者 2026-05-13 对话结论改为单库结构进化；旧 D3 冷相离线 refine **作废**，由 summary 表 + 同轮结构化输出替代。

## 配置块（`memory.tuning.*`）

```jsonc
{
  "memory": {
    "tuning": {
      "identity":       { "appendDailyLimitPerFile": 3, "appendOverflowQueue": "dream" },
      "summary":        { "trigger": "rolling", "rollingWindowDays": 7, "minIntervalHours": 24 },
      "reconsolidation":{ "embeddingDriftThreshold": 0.25, "driftHitCount": 2 },
      "inbox":          { "decayMultiplier": 2.0, "ttlDays": 7 },
      "dormant":        { "idleMinutes": 10, "_keepGatewayListening": true },
      "atomScore":      { "weights": { "recency": 0.35, "access": 0.15, "successPrior": 0.35, "fanout": 0.15 },
                          "visibilityThreshold": 0.65 },
      "ghost":          { "maxChainDepth": 5, "pinHalflifeMultiplier": 3.0 },
      "brainDb":        { "archiveAfterMonths": 3, "vacuumIntervalDays": 14 }
    }
  }
}
```

- 全部走 `~/.flyflor/config.jsonc`，**禁走环境变量**（AGENTS.md 红线）。
- `_keepGatewayListening` 是审计字段，编辑无效（merge 后强制为 `true`）。
- AtomScore 权重 / brainDb / ghost 调参属内部参数，**不在 CLI / README 文档化**，避免误调。
- 缺字段静默 fallback；类型不正确时由 doctor 表「Memory tuning」一行高亮。

## 目录契约（生平）

```
~/.flyflor/
  brain.db                          # 单文件大脑（R2）
  archive/
    brain.YYYY-MM.db                # 月级冷归档（read-only，ATTACH 按需）
  identity/
    soul.md                         # 人格画像（人 + agent 共写，agent 仅 append）
    user.md                         # 用户偏好
    revert.log.jsonl                # R3：每条 append 的 revert handle
  projects/
    <projectId>/
      PROJECT.md                    # Codename 升格后落地
      RETROSPECTIVE.md
  graph/                            # SurrealDB：晶体层（gem / gem_snapshot / skill）
  activation/                       # Redis 持久化快照
```

> 与上一版差异：删除 `journal/<yyyy>/W<ww>/day_*.db` 目录契约，回归单文件大脑。

## brain.db Schema（核心表）

```sql
-- 事件层：append-only，所有"发生过的事"
CREATE TABLE memory_events (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  codename_id   TEXT,
  user_id       TEXT NOT NULL,
  channel_id    TEXT,
  type          TEXT NOT NULL,        -- 'event' | 'thought' | 'action' | 'reflection' | 'ghost-context' | 'ask-answer-pair'
  role          TEXT,                 -- 'user' | 'assistant' | 'system' | 'tool'
  content       TEXT,                 -- JSON：含 atom view 字段 / ghost snapshot / ask 内容
  parent_id     TEXT,                 -- ghost 链 / ask-answer 关联
  embedding_id  TEXT,
  importance    REAL DEFAULT 0.5,
  time_bucket   TEXT NOT NULL,        -- 'YYYY-MM-DD' / 'YYYY-Www'
  FOREIGN KEY (parent_id) REFERENCES memory_events(id)
);
CREATE INDEX idx_events_time      ON memory_events(ts);
CREATE INDEX idx_events_bucket    ON memory_events(time_bucket);
CREATE INDEX idx_events_codename  ON memory_events(codename_id, ts);
CREATE INDEX idx_events_type      ON memory_events(type, ts);

-- 状态层：可变，召回 / 衰减 / 计数
CREATE TABLE memory_state (
  event_id        TEXT PRIMARY KEY,
  activation      REAL,
  decay_score     REAL,
  access_count    INTEGER DEFAULT 0,
  last_accessed   INTEGER,
  resumed_at      INTEGER,            -- ghost 专用
  status          TEXT,                -- 'live' | 'resumed' | 'abandoned' | 'archived'
  FOREIGN KEY (event_id) REFERENCES memory_events(id)
);

-- 摘要层：替代旧 weekly summary 文件
CREATE TABLE memory_summary (
  id            TEXT PRIMARY KEY,
  time_range    TEXT,                 -- 'day' | 'week'
  bucket_key    TEXT,                 -- 'YYYY-MM-DD' / 'YYYY-Www'
  content       TEXT,
  embedding_id  TEXT,
  created_at    INTEGER
);

-- 关联层：dream / reflection 形成的隐含链接
CREATE TABLE memory_links (
  id            TEXT PRIMARY KEY,
  from_id       TEXT,
  to_id         TEXT,
  strength      REAL,
  type          TEXT                   -- 'similarity' | 'causal' | 'derived' | 'contradicts'
);

-- 代号锚点
CREATE TABLE codenames (
  id            TEXT PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  working_dir   TEXT,
  description   TEXT,                  -- 模型同轮生成的一句话摘要
  user_id       TEXT NOT NULL,
  created_at    INTEGER,
  last_used_at  INTEGER,
  use_count     INTEGER DEFAULT 0,
  project_id    TEXT                   -- 升格后绑定 projects/<projectId>/
);
CREATE INDEX idx_codename_user_used ON codenames(user_id, last_used_at DESC);
```

> 关键点：
> - **Ghost 不是新概念，是 `memory_events.type = 'ghost-context'`** 的一种。复用 AtomScore / decay / 召回 / gem 升格通路，零新机制。
> - **Ask-Answer pair 也是 events**，`type = 'ask-answer-pair'`，`parent_id` 指向触发它的 ghost。
> - 冷归档：超过 `archiveAfterMonths` 的 `memory_events` 行批量 `INSERT OR REPLACE INTO archive.memory_events` + 主库 `DELETE`。读路径通过 `ATTACH DATABASE archive.brain.YYYY-MM.db` 按需挂载。

## AtomScore（不变）

```
AtomScore = w_recency · recencyDecay(now - ts)
          + w_access  · log(1 + accessCount)
          + w_prior   · (priorWeight + observedSuccessRate) / 2
          + w_fanout  · crossCodenameFanout
```

- 默认权重见配置块；调参走内部脚本。
- inbox / ghost / pinned 的 recency / decay 走不同参数化：
    - inbox：`recencyDecay × inbox.decayMultiplier`（淡出快）
    - ghost.pinned：`recencyDecay × (1 / ghost.pinHalflifeMultiplier)`（淡出慢）
- 召回必须先过阈值（R4）；唯一例外是显式调试 CLI，日志标注 `bypass-score: true`。

## Codename（D4）

### 触发与生命周期

1. **创建**：用户消息中包含工作目录绑定声明 → 模型同轮结构化输出 `codenameProposal: { name, workingDir, description }` → runtime 通过 Ask 询问"是否创建代号 `@xxx`？"，用户确认后落 `codenames` 表。
2. **使用**：消息中含 `@xxx` → 强绑定；不含 `@` 但有多候选 → 模型结构化 `codenameAmbiguity: { candidates, askForChoice: true }` → 走 Ask 出口。
3. **上浮**：`use_count` + `last_used_at` 进 AtomScore；高分代号在 prompt 中作为"当前可能上下文"提示给模型，不强制激活。
4. **升格 Project**：`use_count ≥ N` 或显式触发 → scaffolder 创建 `projects/<projectId>/PROJECT.md`，`codenames.project_id` 回填。
5. **遗忘**：长期未用 → activation 衰减 → 跌出 prompt 可见性阈值；不删行，可被显式召回。

### 与现有 Project / Inbox 的关系

| 现有概念 | 在新模型里的归宿 |
| --- | --- |
| inbox project | inbox = 未升格 codename 的容器；inbox 内 event 走加速衰减 |
| `pending_project_offer` | 退化为"等待升格 codename 的状态字段"，沿用 cluster sweeper 通路 |
| `ProjectScaffolder` | 入口由"用户显式 + cluster 自动"改为"codename 升格 + 用户显式"，scaffolder 本身不动 |
| RETROSPECTIVE.md | 不变 |

## Ask（D5）— 一等公民 + 中断模型

### 协议

```ts
enum AskReason {
  CodenameAmbiguity = 'codename-ambiguity',
  UserIntentUnclear = 'user-intent-unclear',
  BlackboardStalemate = 'blackboard-stalemate',
  CodenameCreate = 'codename-create',
}

interface AgentAsk {
  questionId: string;
  prompt: string;
  reason: AskReason;
  choices?: AskChoice[];     // 每个 choice 可携带 codename / gem 引用
  freeform: boolean;
}

interface ModelTurnOutput {
  kind: 'reply' | 'ask';      // 互斥
  reply?: { text: string; ... };
  ask?: AgentAsk;
}
```

### 触发面（零字符匹配）

完全由模型从 prompt + 上下文里自决。Runtime 不做规则判定。`AskReason` 枚举仅供测试断言、TUI 渲染分支、反馈数据归类。

### 中断语义

- Ask 是一次**正常 turn 输出**，不引入"暂停"状态机。
- 用户下一条消息 = 对该 ask 的回答。下一轮 prompt 在 system 顶部注入：
  ```
  [continuation]
  You previously asked: "<ask.prompt>"
  The user has now answered: <user.message>
  Resume the original request: <original.message>
  Pre-execution snapshot: <snapshot summary>
  ```
- 用户**任意新消息**都自动 cancel pending ask（标记 `abandoned`），不超时。
- 链深度硬上限：`ghost.maxChainDepth`（默认 5）；超过 → runtime 强制 reply + episode 标 `excessive_clarification_loop`，作为"模型问太多了"的反馈信号。

### 黑板与 Ask 的边界（澄清）

- **黑板内部 worker 之间的讨论与 Ask 无关**。worker 不能 ask 用户、不调工具、不写记忆。
- 黑板**收敛失败（5 轮硬顶）**后由 runtime 接管，复用 Ask 协议向用户求助（`reason: 'blackboard-stalemate'`）。旧 `flyflor-decision-form` 退役。

### 与 Sandbox 的边界

- Ask 管语义澄清，Sandbox 管能力授权。两者**正交**，同一 turn 可同时出现一个 ask 和一个 sandbox approval。
- Sandbox approval 不走 Ask 协议（保持已有审批入口）。

## Ghost Context（D6）— 未完事项的可视副本

### 落地形态

Ghost = `memory_events.type = 'ghost-context'` 的一行，content 字段 JSON 携带：

```jsonc
{
  "reason": "ask" | "tool-failure" | "blackboard-cap" | "process-restart",
  "snapshot": {
    "originalUserMessage": "...",
    "assembledContextDigest": { /* skills / mcp catalog / memory prompt 摘要 */ },
    "blackboardTurnId": "...",
    "mcpCallProgress": [ ... ],
    "askedQuestion": { /* AgentAsk */ }
  },
  "userFacing": {
    "title": "...",          // 模型同轮生成
    "askPrompt": "...",
    "contextHint": "..."
  }
}
```

### 行为规则

- **可见**：TUI 侧栏按 codename 分组列出 ghost；CLI `flyflor ghost list / show / resume / drop / pin`；渠道 `/ghosts` 命令。
- **可见阈值**：复用 `atomScore.visibilityThreshold`，默认 0.65；`--all` 显示全部。
- **Fork / Fresh 自决**：用户来新消息时，若当前 codename 有高分 ghost，prompt 注入 `[ghost-hint]`；模型同轮 `kind: 'fork' | 'fresh'` 决定是否恢复。零字符匹配。
- **显式 resume**：用户 `flyflor ghost resume <id>` 或 TUI 点 [resume] → 跳过模型自决，强制 fork。
- **Pin**：`ghost pin` 把 `memory_state.decay_score` 半衰期 × `ghost.pinHalflifeMultiplier`（默认 3.0），**不冻结**，仍参与 gem 升格证据计算。
- **Resume 成功后保留**：标 `resumed_at`，`importance` 拉回峰值；多次成功 resume 的 ghost 是 gem 升格的高价值证据。
- **Abandoned 不进晶体**：被用户新消息 cancel 的 ask，对应 ghost 不参与 gem 升格，但 `abandoned` 计数进 dream 反馈面板。

### Evidence Weight 表（更新）

| sourceKind | weight |
| --- | --- |
| direct / unverified | 0.0 |
| blackboard-needs-user | 0.65 |
| blackboard-converged | 0.8 |
| ask-answered | 0.85 |
| explicit | 0.9 |
| continuation-completed | 0.75 |
| continuation-abandoned | 0.0 |

## Dream（D9）— 只放大、不创造

Dream 仍负责四类动作（drift-repair / recall-reinforce / contradiction-audit / reconsolidation），但有硬约束：

- 候选选择只用**已记录的 negative 信号**：用户显式纠正、连续工具失败、ghost abandoned 率、`contradicts` 链接计数。
- 无 negative 信号源时 Dream 一轮**写 0 条**。
- 不允许 Dream 基于"我觉得这两条 atom 应该合并"作出无证据的 merge。证据必须来自 `memory_links.type` ∈ {`contradicts`, `causal`, `derived`} 中已记录的链接。

## 阶段路线（依赖图，不含时间）

| 阶段 | 交付 |
| --- | --- |
| **R0 文档 + 红线** | ✅ done — 重写 `life.form.md`；`boundaries.md` §11.1 替换 R2、新增 R5/R6/R7；`TODO.md` 主线重排 |
| R1 brain.db 单库 | ✅ done<br>① ✅ 协议类型 `src/protocol/contracts/brain.ts`（`MemoryEventType` / `MemoryEventStatus` / `MemoryLinkType` / `SummaryRange` 枚举 + 5 个 Record 接口）<br>② ✅ `src/neural/memory/brain.store.ts` `BrainStore` 骨架 + 5 张表 schema + 单测（5/5）<br>③ ✅ `MemoryModule` 双写：warmup `brain.open()` / dispose `close()` / `persistJournal` 后台 `dualWriteBrainEvent` + 2 个事件类型 `MemoryBrainEventWritten` / `MemoryBrainWriteFailed`（brain 缺失静默降级，不影响 journal）<br>④ ✅ `flyflor doctor` 表新增 `Brain.db` 行：显示主文件大小 + archive 文件数<br>⑤ ✅ 月级冷归档脚本 `scripts/brain.archive.ts`：把 `status='archived'` 且月份 < cutoff 的 events / states / 当月 summaries 搬到 `archive/brain.YYYY-MM.db`，admin 工具不受 R7 Dream 删除禁令约束（1/1 集成测试）<br>⑥ ✅ 召回 shadow read：`buildPrompt` 与 journal 召回并行查 brain，发 `MemoryBrainShadowRecall` 事件携 `userId`/`hits`/`sinceTs`，journal 保持权威路径，brain 仅用于灰度校验（1/1 集成测试）<br>⑦ ✅ 旧 `journal/` read-only 60 天 grace：`JournalStore.legacyGraceDays`（默认 60）+ `JournalWriteRejectedError`，`MemoryModule.persistJournal` 捕获后发 `MemoryJournalRejectedLegacy` 事件并继续 brain 双写（3/3 单测） |
| R2 Codename 接管 | 🚧 in-progress<br>① ✅ `MemoryAction.codename` 字段 + 同轮模型结构化输出（零字符匹配，2/2 单测）<br>② ✅ `MemoryModule.persistCodenamesFromActions` 双写 brain.codenames + `useCount` 自增 + `memory_events.codename_id` tagging + `MemoryCodenameCreated`/`MemoryCodenameTouched` 事件（1/1 集成测试）<br>③ ✅ CLI `flyflor codename list [--user --limit --json]`（`handlers/codename.handler.ts`）<br>④ ✅ 提示词模板（zh + en）追加 codename 字段说明与"绝不要从对话里猜代号"红线<br>⑤ ✅ 升格 ProjectScaffolder：`detectCodenamePromotion`（useCount + age 阈值，零字符匹配）+ `promoteCodename` helper（`agent/project/codename.promote.ts`）+ `MemoryModule.promoteCodename` + 自动 touch 路径触发 + 事件 `MemoryCodenamePromoted` / `MemoryCodenamePromotionFailed`（8/8 单测）<br>⑥ ✅ AtomScore 上浮：`journalAtomFromAction` 增 `codenameUseCount` 入参，`min(1, log2(1+useCount)/4)` 加到 `score_total`，explain 含说明（仅资源指标，零字符匹配）<br>⑦ ✅ CLI 子命令补齐：`flyflor codename promote <name> [--force --json]` + `flyflor codename use <name>`（写 `~/.flyflor/state/active-codename.json` 提示文件，runtime 后续接入）<br>⑧ pending：多候选 → Ask（依赖 R3）、inbox project 容器收口 |
| R3 Ask 一等公民 | ✅ done<br>① ✅ 协议 `src/protocol/contracts/ask.ts`（`AgentAsk` / `AskReason` × 6 / `AskEventContent` / `AskAnswerPairContent`）<br>② ✅ 解析器 `src/neural/memory/ask.ts`：`<flyflor_agent_ask>` 块只取首个、reason 在枚举内、prompt 非空，dropped 计数（零字符匹配，5/5 单测）<br>③ ✅ `BrainStore.getLatestPendingAsk`（`NOT EXISTS ask-answer-pair` 子事件判定 pending）+ `countAskChainDepth`（沿 `parent_id` 反追，硬上限 32 跳）<br>④ ✅ `MemoryModule.rememberTurn` 第 6 参 `ask?: AgentAsk`，顺序 pendingAskBefore → ask-answer-pair（state=resumed）→ journal → 新 ask 事件（chainDepth = parent+1）；新增 `MemoryModule.peekActiveAsk` 公开方法供 runtime 做 cap 强制<br>⑤ ✅ `buildPrompt` 注入 `[continuation]` 块到 nudges 顶部<br>⑥ ✅ 配置 `tuning.ghost.maxChainDepth=5`；超 cap 发 `MemoryAskChainCapped` 事件<br>⑦ ✅ 4 个新事件 `MemoryAskRecorded` / `MemoryAskAnswered` / `MemoryAskChainCapped` / `MemoryAskMutexViolation`<br>⑧ ✅ `RuntimeModule.generateTurnReply`：解析 ask、`renderAskReplyText`、`reply.metadata.kind: 'ask'\|'reply'`、ask 透传 memory<br>⑨ ✅ **slice D**：`buildBlackboardStalemateAsk`（黑板 NeedsUser → `AgentAsk(reason=blackboard-stalemate)`，仅消费 status + decisions 两个结构化资源指标）+ `replyFromAsk` 短路 LLM、跳过 mcp/memory_actions；`returnDecisionToUser` 不再写 `flyflor-decision-form` 系统消息（只保留结构化 decisions[]），`renderDecisionForm` / `isDecisionFormMessage` 删除；runtime 用户面 cap 强制：模型 ask 而 chainDepth+1 > maxChainDepth 时抛弃 ask 改走 reply、发 `MemoryAskChainCapped` action=`dropped-by-runtime`<br>⑩ ✅ 集成测试 `tests/ask.parse.test.ts`（5/5）+ `tests/ask.wire.test.ts`（3/3）+ `tests/ask.cap.runtime.test.ts`（1/1，runtime cap 强制）；blackboard / memory boundaries 改写为短路 ask 行为（5 测全过）|
| R4 Ghost Context | ✅ done<br>① 协议 `src/protocol/contracts/ghost.ts`：`GhostContextReason` 枚举 4 值 + `GhostUserFacing` / `GhostSnapshot` / `GhostContextEventContent`（含 `continuationCompleted` / `lastKind`）+ `GhostDecisionKind` 枚举 + `GhostDecision`；`AgentAsk.ghostHint?: { title?, contextHint? }`<br>② `BrainStore.listActiveGhosts` + `hasAskBeenAnswered` + `patchGhostContent`<br>③ `MemoryModule.recordAskEvent` 自动 sibling ghost；公开 `listActiveGhosts/getGhost/resumeGhost/dropGhost/pinGhost/recordGhostFromReason/applyGhostDecisions`<br>④ 5 个事件 `MemoryGhostRecorded/Resumed/Dropped/Pinned/DecisionApplied`<br>⑤ `GhostTuningConfig.pinHalflifeMultiplier=3.0` + `evidenceWeight={askAnswered:0.85, continuationCompleted:0.75, abandoned:0, default:1}`<br>⑥ CLI `flyflor ghost list/show/resume/drop/pin`<br>⑦ **Prompt 注入**：`templates/prompts/ask.schema.md`(en+zh)，`buildPrompt` 注入 `[ghost-hint]` 块（高分 ghost top-3 + `evidence=` 标签）<br>⑧ **Runtime triggers**：(a) tool-failure：`runtime.persistTurn` 扫 `mcpCallProvenance` 失败聚合；(b) blackboard-cap：enum→enum 映射；(c) process-restart：`InFlightTracker` sentinel + `warmup.recoverProcessRestartGhosts`<br>⑨ **TUI 侧栏**：`Ghosts` 页（按 codename 分组 + reason 着色）<br>⑩ **Evidence weight**：4 档（abandoned > continuation-completed > ask-answered > default）参与 `decayScore` 重排序<br>⑪ **Fork/Fresh hint**：`<flyflor_ghost_decisions>` 结构化块 + `parseGhostDecisions`（dedupe / maxDecisions=8 / 非法 kind 丢弃）+ `applyGhostDecisions`（resume → resumeGhost；fork/fresh → patchGhostContent 写 continuationCompleted=true 切换 evidence 权重 0.75）；runtime `prepareTurn` 解析顺序 memoryActions → ghostDecisions → ask 逐层剥离<br>**测试**：`tests/ghost.wire.test.ts` 13/13 + `tests/ghost.decisions.parse.test.ts` 6/6 + `tests/inflight.tracker.test.ts` 4/4 + `tests/process.restart.ghost.test.ts` 1/1 + `tests/ghost.list.handler.test.ts` 2/2 + `tests/ask.parse.test.ts` 6/6 |
| R5 生命体能力 | ✅ done<br>**slice A identity 自写 + revert** ✅：协议/parser/MemoryModule API/BrainStore/事件/buildPrompt 注入/CLI/Prompt 模板/runtime parse 链/测试 7+5。<br>**slice B summary worker** ✅：`summary.worker.ts` 纯结构化聚合（type/role/codenameId/ask reason/ghost reason/identityAppends + firstTs/lastTs）；daily=`YYYY-MM-DD` + weekly rolling=`rolling-…-Nd` / calendar=`YYYY-Www`；`minIntervalHours` 资源指标短路；`MemoryModule.runSummaryOnce`；`BackgroundScheduler.summarySweeper` 6h；事件 `MemorySummaryWritten`；测试 6+2。<br>**slice C Dream reconsolidation** ✅：`DreamActionKind.Reconsolidation` 第 4 类动作（winner=left/right/merge + mergedSummary/Symbols/scopeNote）；`SurrealGraphStore.applyReconsolidation`（winner UPDATE → loser `supersededBy` → RELATE `supersedes`）；资源指标短路（contradictionCount≥1 或 cosine≥0.85）；事件 `MemoryReconsolidated`；Prompt 模板 (en+zh) 同步；测试 16。<br>**slice D Dormant 实装** ✅：① `src/neural/memory/dormant.supervisor.ts`：per-user `lastInputAt` + `mode` 状态机；`touch()` 注册/唤醒、`sweepOnce()` 把超过 `idleMinutes` 的 Chat 用户切到 Dormant；零字符匹配，只用 `now - lastInputAt` 资源指标；② `MemoryModule.dormant` 实例 + `rememberTurn` 调 `touch`；公开 `runtimeModeOf` / `sweepDormantOnce` / `dormantSnapshot`；③ `BackgroundScheduler.dormantSweeper` + `dormantIntervalMs`（默认 60s）+ unref + stop 清理；④ 事件 `RuntimeModeEntered` / `RuntimeModeAwakened`；⑤ 测试 `tests/dormant.supervisor.test.ts` 5/5 + `tests/dormant.wire.test.ts` 2/2；全套 610 pass / 1 baseline。 |
| R6 Dream 收紧 | ✅ done — `DreamWorkerImpl.runOnce` candidates.length===0 短路（0 LLM、0 graph 写）；候选源已资源指标分桶（drift-repair / recall extremes / contradiction-pair cosine≥0.78 / reconsolidation contradictionCount≥1 或 cosine≥0.85）；新增 `tests/dream.zero.write.test.ts` 3 项覆盖 |
| R7 清理 | ✅ done — `legacySessionKey` 字段 / 旧 `journal/` 读路径已无代码引用；`MemoryTuningConfig.session` 字段已删；`status.ts` / `tests/config.memory.tuning.test.ts` 引用清掉；删废弃 `src/command/tui/native/cli.entry.ts` + 导出；注释 (`memory.atom.ts`) 提及"旧 journal 分文件路径"统一改为"brain.db 单库"；614 pass / 0 fail / 0 typecheck error；解锁 EQ-01 |

## 与上一版的作废清单

| 旧 ID | 旧描述 | 处置 |
| --- | --- | --- |
| LF-P1 | journal 按天 SQLite + 周索引 | **superseded by R1**（brain.db 单库），旧实现读路径保留 60 天 |
| LF-P3.2 | 冷相每日本地模型 refine atom | **砍掉**。Atom 字段由模型同轮结构化输出派生；跨日汇总由 `memory_summary` 表替代 |
| LF-P3.5 | Gate A/B/C 接 cluster sweeper | **沿用**，搬到 R4 之后做（依赖 brain.db schema） |
| pending\_project\_offer 自动 propose | 自动 propose 弱化为"等待 codename 升格"，触发面改由用户显式 + cluster 双轨 |
| flyflor-decision-form | **退役**，由 Ask `reason='blackboard-stalemate'` 接管 |

## 风险记录

1. **brain.db 单文件膨胀**：依赖 R1 月级冷归档 + 周级 vacuum；首批 30 天观测增长曲线，doctor 表新增 `brain.db size`。
2. **Ghost 链深度爆炸**：硬上限 `ghost.maxChainDepth=5` 兜底；超过时落 `excessive_clarification_loop` 反馈给 Dream。
3. **Ask 触发过频 → 用户疲劳**：不设硬预算，仅在连续 N 轮无任务推进时事件告警 `AskLoopSuspected`；用户主动反馈是最终校正。
4. **identity 自写漂移**：每条 append 必须带 `atomIds` 证据链，Dream reconsolidation 必须能复盘合并 / 收回 identity 行。
5. **codename 命名混乱**：`description` 字段强制由模型生成；CLI `codename list` 展示"最近使用 + 一句话描述 + 工作目录"。
