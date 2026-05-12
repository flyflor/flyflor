# Life-form 重构主线

> Status: **proposal — 进行中**。本文定义 Flyflor 从「带记忆的智能体」推进为「在时间里持续活着的生命体」的设计边界与迁移顺序。它是 LF 主线的稳定参照。

## 一句话定位

Flyflor 的下一阶段不是继续堆叠会话记忆，而是把系统改造成以时间为连续轴、以海马体 episode 为事实层、以晶体化 project 约束为长期边界、以 Memory Atom 为检索单元、以 append-only identity 为自我演化证据的长期运行体。

本文中的“无 session”不是“隐藏 session key”，而是系统哲学、协议、存储、事件、CLI、提示词里都不存在 session 概念。即使内部需要定位，也只能使用由生命体运行沉淀出来的 project constraint、focus、episode、turn 等审计标识；用户层不可感知这些标识，Runtime 也不得用它们模拟会话容器。

## 设计哲学

1. **时间大于会话**
   session 不是被替代的字段，而是被删除的旧抽象。新的连续轴是 `(userId, channelId, projectConstraint, ts)` + `FocusPointer` + hippocampus activation。
2. **协议大于自然语言**
   路由、记忆、反馈、黑板、Dream、Identity 写入都必须由结构化字段驱动；代码只校验 shape / enum / range。
3. **三层心智大于会话容器**
   LLM 负责当下流体智力，海马体负责时间事实与近期激活，晶体智力负责长期结构与 project 约束。连续性来自三层协同，不来自 session timeline。
4. **边界大于灵活性**
   Gateway 只归一化渠道，Runtime 只编排 turn，Blackboard 只协调讨论，Memory 只管召回和写回，Sandbox 只管副作用审批。
5. **可审计大于聪明**
   能写入长期状态的动作必须留下来源、时间、schema、证据链和可回滚路径。
6. **资源指标可以短路，业务语义不可以硬编码**
   token、TTL、cosine、cluster size、counter 可以做阈值；意图、分类、矛盾、固化触发不能写关键词规则。

## 已有骨架

- `src/protocol/contracts/memory.atom.ts` 已声明 `MemoryAtom`、`AtomScore`、`FocusPointer`、`IdentityAppendEntry`、`ReconsolidationCandidate`。
- `src/protocol/contracts/enums.ts` 已加入 `RuntimeMode.Dormant`。
- `src/config/index.ts` 已加入 `memory.tuning.*` 默认配置。
- `docs/boundaries.md` 已写入 R1-R4 红线。
- `TODO.md` 已把历史 P0/P1 缺口收束到 LF-P0 到 LF-P5。

这些内容说明 LF-P0 已经进入协议层。LF-P1 起必须把 journal 作为主事实层，并删除运行时中的旧 session 语义。

## 核心决策

### D1 — 无 Session

协议、提示词、存储、事件、日志、CLI 中不出现 `sessionId` / `sessionKey` / `sessionScope` / `legacySessionKey`。不设置旧会话兼容字段；需要审计定位时使用 `turnId`、`episodeId`、`projectConstraintId`、`FocusPointer`。

### D2 — Journal 是公开契约

长期生平落在：

```text
~/.flyflor/journal/<yyyy>/W<ww>/day_YYYY_MM_DD.db
```

日级 SQLite 是用户可 inspect 的事实层；周级 `week.index.surreal` 和 `week.summary.md` 是语义聚合层。不能为了性能把日记迁出、合并或压缩成不可读黑箱。

### D3 — Atom 是 Episode 的派生视图

`MemoryAtom` 不保存原始 transcript。原文保留在 journal / SQLite；Atom 保存可检索、可评分、可重构的语义视图。Atom schema 可以独立演化，不需要重写历史 episode。

### D4 — Project 是沉淀约束，不是会话

Project 不是用户手动打开的会话，也不是 session 的改名。Project 是系统从海马体 episode、晶体记忆、工具结果和用户确认中沉淀出的内部约束：目标、边界、偏好、对象、可复用方法。Blackboard lease、Confirmation lookup、Reflection sourceId、TUI 当前焦点都只能引用这种内部 project constraint；默认 UI 不暴露 project id。

### D5 — Inbox 自然淡出

没有明确 Project 的内容进入 inbox project。inbox 内 atom 的 recency 衰减乘以 `memory.tuning.inbox.decayMultiplier`，默认 2.0，让 7 天内未强化的内容自然淡出。

### D6 — Identity 自写必须可回滚

Agent 可以 append `identity/{soul.md,user.md}`，但每次必须写 `revert.log.jsonl`，包含 `beforeHash`、`afterHash`、`appendedText`、`atomIds`。禁止覆盖式重写。

### D7 — Dormant 是常驻态

无用户输入超过 `memory.tuning.dormant.idleMinutes` 后进入 `RuntimeMode.Dormant`。Dormant 期间 gateway 监听不停，后台 worker 继续节拍；任意入站消息立即回到 Chat。

## 阶段计划

### LF-P0 — 协议 + 边界 + 配置

目标：只定义协议和红线，不改变运行时行为。

- 声明 `MemoryAtom` / `AtomScore` / `FocusPointer`。
- 加入 `RuntimeMode.Dormant`。
- 固化 `memory.tuning.*` 默认值。
- 将 R1-R4 写入 `docs/boundaries.md`。
- 补齐本文。

### LF-P1 — Journal 主链路

目标：把按天 journal 变成记忆事实层主链路。

- 新增 journal 目录布局，并作为 turn 结束写入入口。
- 写按天 SQLite writer：`journal_episode` 保存事实，`memory_atom` 保存 derived view。
- 写 `week.index.surreal` 和 `week.summary.md` 的周级聚合入口。
- 先写 `journal.smoke.ts` 验证 Bun SQLite 多文件 open 行为。
- 不再把 `memory.sqlite` 的 session 表作为主链路。

### LF-P2 — Session 删除

目标：删除旧 session 语义，而不是兼容旧 session。

- 删除 `SessionModule`、`scopeFor`、`sessionKey`、`session_*` 表、`flyflor session *`。
- Blackboard lease 主键改为内部 project constraint + requestId / turnId tie-breaker。
- Reflection `sourceId` 改为 `<projectConstraintId>/<turnId>` 或 `<episodeId>`。
- Confirmation lookup 改造为 project constraint 范围。

### LF-P3 — Atom 抽取与评分

目标：让 Atom 成为召回和固化的主入口。

- 热相：turn 结束零额外 LLM，生成最小 atom。
- 冷相：每日离线本地模型，补 outcome / success / refined text。
- `AtomScore` 替换现有 evidence gate。
- Gate A 量、Gate B 质、Gate C 信接入 project / skill sweeper。

### LF-P4 — 生命体能力

目标：让系统真正具备长期自维护行为。

- Identity append-only 自写。
- `flyflor identity revert <entryId>`。
- rolling 7d weekly summary worker。
- Dream worker 增加 reconsolidation 动作。
- 实装 `RuntimeMode.Dormant`。

### LF-P5 — 清理与收束

目标：删除过渡层，更新所有文档和 CLI。

- 删除所有 session 语义文档，不保留 legacy 说明作为产品概念。
- 全量更新 docs / CLI / tests。
- 解锁 EQ 模块。

## 迁移原则

- 新代码不得新增 session 语义依赖。
- 不做旧会话并行写入；如需迁移旧数据，迁移脚本必须从旧数据读出 episode / atom / project constraint 后写入 journal。
- 每个阶段结束时必须能解释旧 session 残留是否仍在正常路径中；答案必须趋向 0。
- 所有长期写入必须可审计、可回放、可删除。
- 所有模型驱动决策必须能追溯到模板和结构化字段。

## 当前判断

项目已经完成大部分运行时基础设施和 LF-P0 的协议骨架。接下来的重点不是增加新能力，而是按 `LF-P1 -> LF-P5` 串行迁移：journal 成为主事实层，海马体驱动近期激活，晶体智力沉淀 project 约束，旧 session 语义从核心层清零。
