# 生命体重构（Life-form Architecture）

> Status: **active — phase 0 in progress**。本文档与 `TODO.md` 的「生命体重构」章节、`docs/boundaries.md` 的 R1-R4 章节联动。

## 一句话定位

把 Flyflor 从「带记忆的智能体」推进为「在时间里持续活着的生命体」：删 session、按天分文件、atom 视图化、project 接管语义边界、identity 可自写、Dormant 常驻态。

## 兑现「生命体」的五件事

| # | 维度 | 工程实现 |
| --- | --- | --- |
| 1 | 时间唯一连续轴 | 删 session；`journal/<yyyy>/W<ww>/day_YYYY_MM_DD.db` |
| 2 | 常驻激活场 | Redis spreading activation 永不熄；`flyflor:focus:<userId>:<channelId>` |
| 3 | 睡眠机制 | Dream worker SWR 回放（已有）+ `RuntimeMode.Dormant` |
| 4 | 自我塑造 | `identity/{soul.md,user.md}` 自动 append + `revert.log.jsonl` |
| 5 | 死亡=失忆而非删除 | AtomScore 衰减至阈值下；原文不删；可重新结晶 |

## 决策（D1-D7）

| ID | 决策 | 备注 |
| --- | --- | --- |
| D1 | 完全删除 session 概念 | 协议/存储/提示词禁用 `sessionKey`；过渡期保留 `legacySessionKey` |
| D2 | SQLite 按天分文件 + 周级索引 | `journal/<yyyy>/W<ww>/`；`week.index.surreal` + `week.summary.md` |
| D3 | Atom 作为 episode 的 derived view | schema 可演化；不重写历史 |
| D4 | Project 接管 session 语义边界 | 黑板 lease / Confirmation / Reflection sourceId / TUI 切换 |
| D5 | inbox project 7 天加速衰减 | `decayMultiplier = 2.0`，自然淡出 |
| D6 | identity 自写：直接 append + 可 revert | `revert.log.jsonl` 是契约，不是日志 |
| D7 | 新增 `RuntimeMode.Dormant` | 无输入 10min 进入；gateway 监听不停（行为契约，不可配） |

## 配置块（`memory.tuning.*`，详见 `src/config/index.ts`）

```jsonc
{
  "memory": {
    "tuning": {
      "identity": { "appendDailyLimitPerFile": 3, "appendOverflowQueue": "dream" },
      "summary":  { "trigger": "rolling", "rollingWindowDays": 7, "minIntervalHours": 24 },
      "session":  { "legacyDoubleWriteDays": 30 },
      "reconsolidation": { "embeddingDriftThreshold": 0.25, "driftHitCount": 2 },
      "inbox":    { "decayMultiplier": 2.0, "ttlDays": 7 },
      "dormant":  { "idleMinutes": 10, "_keepGatewayListening": true },
      "atomScore":{ "weights": { "recency": 0.35, "access": 0.15, "successPrior": 0.35, "fanout": 0.15 } }
    }
  }
}
```

- 全部走 `~/.flyflor/config.jsonc`，**禁走环境变量**（AGENTS.md 红线）。
- `_keepGatewayListening` 是审计字段，编辑无效（merge 后强制为 `true`）。
- AtomScore 权重虽可配但不在 CLI / README 文档化，避免误调毁掉记忆系统。
- 缺字段静默 fallback；类型不正确时由 doctor 表 `Memory tuning` 一行高亮（不报错）。

## 目录契约（生平）

```
~/.flyflor/
  identity/
    soul.md                  # 人格画像（人 + agent 共写，agent 仅 append）
    user.md                  # 用户偏好
    revert.log.jsonl         # R3：每条 append 的 revert handle
  projects/
    <projectId>/
      PROJECT.md
      RETROSPECTIVE.md
  journal/
    <yyyy>/W<ww>/
      day_YYYY_MM_DD.db      # 原始 episode + atom view（append-only）
      week.index.surreal     # 周聚合：atom embedding + cluster + skill candidate
      week.summary.md        # agent 周自述（人可读，可 revert）
  graph/                     # SurrealDB：晶体层（gem / gem_snapshot / skill）
  activation/                # Redis 持久化快照（spreading activation）
```

## Memory Atom（`MemoryAtom` 类型，详见 `src/protocol/contracts/memory.atom.ts`）

- Atom 是 episode 上的语义视图，`episodeIds` 至少 1 项；schema 可独立演化。
- **热相**（turn 结束）：模型同轮结构化字段，零额外 LLM 调用。
- **冷相**（每日离线）：跨 turn 重抽，补 `outcome / success`，**本地模型默认**；用户可 `--model premium` backfill。
- 三阶段压缩：`raw`（0–3d）/ `compressed`（3–7d）/ `fuzzy`（7+d）。原文保留 SQLite。

## AtomScore（R4）

```
AtomScore = w_recency · recencyDecay(now - ts)
          + w_access  · log(1 + accessCount)
          + w_prior   · (priorWeight + observedSuccessRate) / 2
          + w_fanout  · crossProjectFanout
```

- 默认权重见配置块；调参走内部脚本，不入用户配置文档。
- inbox 内 atom：`recencyDecay` × `inbox.decayMultiplier`。
- 召回必须先过阈值（R4）；唯一例外是显式调试 CLI，必须在日志标注 `bypass-score: true`。

## 结晶三层漏斗（替换现 evidence gate）

1. **候选生成（LLM）**：cluster sweeper 触发；复用 project-offer / skill-offer 框架。
2. **硬验证（系统）**：
    - Gate A 量：cluster 内 atom ≥ 2，且分布于 ≥ 2 project 或跨 ≥ 7 天
    - Gate B 质：mean(success) ≥ 0.7
    - Gate C 信：mean(confidence) ≥ 0.6
3. **结构化结晶（LLM）**：生成 skill descriptor JSON；LLM 不投票"是否升格"。

**Reconsolidation** = Dream worker 第 4 类动作：旧 gem + 新 atom → LLM 改写 → 系统再过三关 → 替换 / 保留双版本（写 `gem_snapshot`）。

## Project 接管点（D4）

| 原 session 角色 | Project 接管形态 |
| --- | --- |
| 黑板 lease 主键 | `(userId, projectId)` + `requestId` tie-breaker |
| Confirmation 上一条助理 | 按 `(userId, channelId, projectId)` 取最新 atom (role=assistant) |
| Reflection sourceId | `<projectId>/<turnId>` |
| TUI 清屏 / 新会话 | 不切上下文，只切显示窗口；`/focus <project>` 显式切换 |
| "现在在干嘛" | `FocusPointer` 存 Redis；超 `dormant.idleMinutes` 回落 inbox |

inbox project 永远存在；无归属 atom 先落 inbox；cluster detect 后 reassign。

## 阶段路线（依赖图，不含时间）

| 阶段 | 交付 |
| --- | --- |
| **P0 协议 + 边界**（本阶段） | `MemoryAtom` / `AtomScore` / `FocusPointer` 协议；`RuntimeMode.Dormant` + `AtomStage` + `IdentityFile` 枚举；`memory.tuning.*` 配置默认值；R1-R4 红线；本文档；不改运行时行为 |
| P1 存储重构 | `journal/` 目录、按天 SQLite writer、`week.index.surreal`、Redis activation key；先写 `journal.smoke.ts` 压测 bun sqlite 多文件 open |
| P2 Session 溶解 | blackboard lease 主键迁移、reflection sourceId、Confirmation lookup、`legacySessionKey` 30 天双写期 |
| P3 Atom + 三层漏斗 | 热相/冷相 worker、AtomScore 替换 evidence gate、Gate A/B/C cluster sweep |
| P4 生命体能力 | identity 自写 + revert、weekly summary worker（rolling 7d）、Dream reconsolidation、`Dormant` 实装 |
| P5 清理 | 删 `legacySessionKey` 字段、过渡表；文档全量更新；解锁 EQ-01 |

## 风险记录

1. **bun sqlite 多文件 open**：阶段 1 第一件事写 `journal.smoke.ts` 跑 90 天 × 10 万条写入 + cross-day query 基线。
2. **inbox 容易变垃圾堆**：7 天加速衰减（已固化）+ cluster sweeper 必须真能捞回有价值条目；阶段 3 加专项回归测试。
3. **M-07 / M-08 / SK-02 三个跑通闭环建立在 sessionKey 上**：阶段 2 必须有专门回归测试（每闭环至少 2 个用例）。
4. **identity 自写"直接写"激进**：`revert.log.jsonl` 100% 可靠是前置条件；CLI 入口 + doctor 显式提示。
5. **本地模型抽 atom 可能漏 outcome**：阶段 3 必须提供 `--model premium` backfill 入口；冷相默认本地。
