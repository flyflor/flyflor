# TODO

仅记录**未完成 / 进行中**的工作。已完成条目转入 git log + 对应文档「变更记录」小节，不在本文件留痕。

新增缺口请直接补到对应章节，并在相关文档的「风险点 / 已知缺口」同步描述。

## 优先级口径

- **P0**：阻碍主用例（chat / gateway / memory）正常运行
- **P1**：影响生产稳定性 / 多副本部署 / 长期演进
- **P2**：功能增强 / 体验 / 二级路径

---

## 主线：生命体重构（Life-form）

> 把架构从「带记忆的智能体」推进为「在时间里持续活着的生命体」。完整设计见 `docs/proposals/life.form.md`。

### 核心决策（已固化）

- D1 完全删除 session 概念，时间成为唯一连续轴
- D2 SQLite 按天分文件 + 周级语义索引（`journal/<yyyy>/W<ww>/`）
- D3 Memory Atom 作为 episode 的 derived view（schema 可独立演化）
- D4 Project 接管原 session 的语义边界（黑板 lease / Confirmation / Reflection sourceId / 焦点指针）
- D5 inbox project 7 天加速衰减（×2）→ 自然淡出
- D6 identity 自写：agent 直接 append + 用户可 revert（`revert.log.jsonl`）
- D7 新增 `RuntimeMode.Dormant`，无输入 10min 进入；gateway 监听不停（行为契约，不可配）

### 红线（已写入 `docs/boundaries.md` §11.1）

- R1 无 session：协议 / 提示词 / 存储禁用 `sessionId / sessionKey`
- R2 journal 目录是公开契约，不得为性能合并 `day.db`
- R3 identity append-only + revert，禁覆盖式重写，必须带证据链
- R4 分数决定可见性：召回必须先过 AtomScore 阈值，绕过 = 边界违规

### 阶段进度

| ID | 描述 | 状态 |
| --- | --- | --- |
| LF-P0 | 协议 + 边界 + 配置 schema：MemoryAtom / AtomScore / FocusPointer 类型；`RuntimeMode.Dormant`；`memory.tuning.*` 默认值；`boundaries.md` R1-R4；`docs/proposals/life.form.md`；不改运行时行为 | ✅ done (`d225801`) |
| LF-P1 | 存储重构（向下兼容） | 🟡 进行中（拆分见下） |
| LF-P2 | Session 溶解 | pending |
| LF-P3 | Atom 抽取 + 三层漏斗 | pending |
| LF-P4 | 生命体能力（identity 自写 / weekly summary / reconsolidation / Dormant 实装） | pending |
| LF-P5 | 清理（删过渡字段 / 文档全量更新 / EQ-01 解锁前置） | pending |

---

### LF-P1：存储重构（向下兼容）

> 目标：journal 目录布局落地，按天 SQLite + 周级 Surreal 索引可用，旧路径仍可写（双写）。

| ID | 子任务 | 验收 |
| --- | --- | --- |
| LF-P1.1 | `scripts/journal.smoke.ts`：bun sqlite 多文件 open 行为压测（并发开关 30 个 daily DB + 跨日切换 + WAL checkpoint），输出 P50/P95 延迟与 fd 上限观测 | smoke 在本机跑通，报告写入 `docs/proposals/life.form.md` 附录 |
| LF-P1.2 | `src/neural/memory/journal/paths.ts`：路径解析（`<memoryDir>/journal/<yyyy>/W<ww>/<yyyy-mm-dd>.db`），周号统一 ISO-8601 | 单测覆盖跨年周（W01/W52/W53） |
| LF-P1.3 | `journal.writer.module.ts`：按 `at: Date` 路由到当日 DB，含 schema migration（`episodes` / `atoms_view`）、open cache（LRU N=14）、graceful close | 写入 -> 立即读 + 跨日写两条 + 重启后读取一致 |
| LF-P1.4 | `journal.reader.service.ts`：跨日范围查询（`[from,to)`），返回流式游标，按 day DB 顺序 merge | 7 天 / 30 天范围查询单测 |
| LF-P1.5 | `week.index.surreal.ts`：周级语义索引表（`week_index` 含 `weekKey / atomIds[] / centroid / topics[]`），写入由 LF-P3 cold pass 驱动，本阶段只建表 + 健康检查 | doctor 表新增 `Journal index` 行 |
| LF-P1.6 | Redis activation key：`ff:journal:active:<userId>` 记录当前活跃 day key + 焦点指针；与 fast.route 共享连接 | 单测覆盖断连降级 |
| LF-P1.7 | 双写桥：旧 `episodes` 表 + 新 journal 同时写，读以新路径优先，旧路径仅查询保留 | 配置 `memory.session.legacyDoubleWriteDays` 控制时长 |

### LF-P2：Session 溶解

> 目标：彻底删除 `sessionId / sessionKey` 在协议层与运行时的存在；Project 接管所有语义边界。

| ID | 子任务 | 验收 |
| --- | --- | --- |
| LF-P2.1 | 协议侧：从 `MemoryCandidate / CrystalTurnInput / MemorySearchRequest / BlackboardLease / ReflectionSource` 移除 sessionId 字段，新增 `focusPointer: FocusPointer`；旧字段标 `@deprecated` 仅做反序列化兼容 | tsc + 既有测试全绿（候选删除时 fallback 到 projectId+userId） |
| LF-P2.2 | Blackboard lease 主键改造：`(userId, projectId)` + `requestId` tie-breaker；并发抢锁单测 | 多并发请求只一份 lease |
| LF-P2.3 | Reflection `sourceId` 重构：`<projectId>/<turnId>`；旧 sourceId 在 LF-P1.7 双写窗口内仍可读 | reflection.boundaries.test 更新 |
| LF-P2.4 | Confirmation lookup：从「按 sessionKey 取 previousAssistantText」改为「按 `focusPointer.turnId` 直接 read journal」 | feedback.wire.test 更新 |
| LF-P2.5 | `legacySessionKey?: string` 过渡字段进 `MemoryAtom`，LF-P5 删除 | merge 测试覆盖 |
| LF-P2.6 | 提示词模板审查：grep `session` 出现处，全部换 `project` / `focus` | naming.boundaries 扩 case |

### LF-P3：Atom 抽取 + 三层漏斗

> 目标：MemoryAtom 作为 episode 的 view 真正运转；AtomScore 替换现 evidence gate；Gate A/B/C 复用 cluster sweeper。

| ID | 子任务 | 验收 |
| --- | --- | --- |
| LF-P3.1 | 热相抽取（turn 结束零额外 LLM）：从 `BlackboardWorker` outcome + reflection 直接 derive atom（task/context/action/outcome 由黑板已有结构化字段拼接） | turn 流水线无额外延迟 |
| LF-P3.2 | 冷相抽取（每日离线本地模型）：`AtomColdPass` worker，扫 journal 当日新增 episode → 调本地 model 补 `problem / success / priorWeight` → 写回 atom view | 200 turn 数据集冷处理 < 60s（本地 7B 量级） |
| LF-P3.3 | `AtomScore` 计算器：`Σ weight × component`，weights 走 `memory.tuning.atomScore.weights`；inbox atom recency 分量额外乘 `decayMultiplier` | 数值单测覆盖 8 个边界值 |
| LF-P3.4 | 召回链路接 AtomScore：现 `MemoryModule.search` 候选先过 AtomScore 阈值再做 ANN | 既有 recall 行为不下降（基准用 chaos.fuzz 套件） |
| LF-P3.5 | Gate A 量 / B 质 / C 信 接入 cluster sweeper：复用 project-offer / skill-offer 框架，新增 `atom-cluster-offer` | 3 个新单测覆盖 promotion 全链路 |
| LF-P3.6 | `priorWeight` 表迁移：现 `evidence_weight` 表合入 atom view 字段 | 迁移脚本 + 幂等回滚 |

### LF-P4：生命体能力

> 目标：identity 自写、weekly summary、reconsolidation、Dormant 模式全部上线。

| ID | 子任务 | 验收 |
| --- | --- | --- |
| LF-P4.1 | identity 自写：`identity.append.service.ts`，agent 直接 append `soul.md / user.md / persona.md`，每文件每天最多 `appendDailyLimitPerFile`（默认 3）次，超限入 dream 队列 | append 配额单测 |
| LF-P4.2 | `revert.log.jsonl`：每次 append 同步写一条；`flyflor identity revert <id>` CLI 命令；revert 写一条「inverse append」而非删除 | revert + revert-of-revert 单测 |
| LF-P4.3 | weekly summary worker：默认 `rolling`（7d 滚动窗口），最短间隔 `minIntervalHours=24`；写 `<memoryDir>/summary/W<ww>.md` | rolling vs calendar 切换测试 |
| LF-P4.4 | Dream worker 新增第 4 类动作 reconsolidation：embedding cosine ≥ `embeddingDriftThreshold` 且命中 `driftHitCount` 次 → 合并/分裂 gem | dream.stress 扩用例 |
| LF-P4.5 | `RuntimeMode.Dormant` 实装：无 user 输入 `dormant.idleMinutes`（默认 10）进入；gateway 监听不停（`_keepGatewayListening: true` 硬约束）；进入/退出广播事件 | 状态机单测 + 任意入站立即切回 Chat |
| LF-P4.6 | inbox 加速衰减 ×2：在 AtomScore recency 分量打折，TTL 到期由 decay worker 移出 | 7 天后 inbox atom score 趋近 0 |

### LF-P5：清理

| ID | 子任务 | 验收 |
| --- | --- | --- |
| LF-P5.1 | 删 `legacySessionKey` / `sessionId` 反序列化兼容字段 | 全仓 grep 无残留 |
| LF-P5.2 | 删 LF-P1.7 双写桥 | journal 单写 |
| LF-P5.3 | 文档全量更新：`memory.system.md / project.session.md / runtime.turn.md / architecture.md` 与新模型对齐 | 文档 review |
| LF-P5.4 | 解锁 EQ-01：把 atom outcome / success 作为 EQ 模块输入接口暴露 | EQ 设计稿提 PR |

---

## 非主线（按需穿插，不阻塞 LF 推进）

### Gateway 长尾渠道

| ID | 描述 | 优先级 |
| --- | --- | --- |
| G-01 | DingTalk / Email / HomeAssistant / Line / Mattermost / Matrix / QQ / Signal / SMS / WeCom / WhatsApp / Zalo 仍走 `HttpPlatformAdapter` 占位，按需逐个补适配器（Slack / BlueBubbles / iMessage / Telegram 已闭环） | P2 |

### 未落地的设计稿

| ID | 描述 | 状态 |
| --- | --- | --- |
| EQ-01 | EQ 模块（情绪 / 情感建模） | proposal（`docs/proposals/eq.module.md`），前置依赖 **LF-P4 完成** |

---

## 工作建议

1. 主线串行：**LF-P1 → P2 → P3 → P4 → P5**，每阶段单独 commit + 通过既有测试。
2. LF-P1 第一刀是 `journal.smoke.ts`（LF-P1.1），bun sqlite 多文件 open 行为先验证再写正式 module。
3. G-01 长尾渠道按用户实际需求驱动，不预判优先级。
4. EQ-01 锁仓直到 LF-P4 完成。
