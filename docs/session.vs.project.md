# Session vs Project：两层职责说明

> 适用范围：`src/agent/session/`、`src/agent/project/`、`src/neural/memory/sqlite.ts` 的 `session_*` 表。

## TL;DR

**Session 与 Project 是两个不同层级的概念，互不替代，没有冗余。**

| 维度 | Session | Project |
| --- | --- | --- |
| 时间尺度 | 短期（一次对话窗口） | 长期（跨多次对话） |
| 边界来源 | Gateway 路由元组 `(channel, accountId, chatId, threadId)` | 概念聚类 / 显式意图 / 技能升格 |
| 触发方式 | 自动（每条消息进入即归属一个 session） | 三路径触发（A 显式 / B cluster / C skill） |
| 存储位置 | SQLite 表：`sessions` / `session_messages` / `session_history` | `~/.flyflor/workspace/projects/{projectId}/{README,TODO,DESIGN}.md` + SurrealDB `projectRef` 反向标记 |
| LLM 介入 | 无（纯结构化索引） | 有（cluster 评分 + 决策表单确认） |
| 数量级 | 多（每个聊天窗口一个） | 少（高价值聚类才创建） |
| 是否可删 | 否（runtime 与 memory 都依赖） | 否（已是单独模块） |

## Session 的真实职责

`SessionModule`（`src/agent/session/session.module.ts`，58 行）只做四件事，**全部是结构化索引层，不涉及 LLM 调用**：

1. **`keyFor(message)`** — 把 gateway message 折叠为稳定的 scope 字符串。
   `(channel, accountId, chatId, threadId)` → `"stdio::chat-a:thread-a"`。
   这个 key 在 SQLite 是主键，在 Markdown / Crystal 都用作分区键。

2. **`recordTurn(message, reply, context)`** — 把一轮 (user, assistant) 写入 `session_messages` 表。
   - 给 `inspect:sessions` 工具提供原始 transcript；
   - 给 reflection / project trigger 提供"这条 episode 来自哪个会话"的反查；
   - 对 Markdown `MEMORY.md` 提供 turn-level 时间序。

3. **`recentMessagesFor(message, limit)`** — 从 SQLite 拉最近 N 条消息。
   被两处调用：
   - `MemoryModule.buildPrompt` 把 recent messages 注入主模型 system prompt（短期对话上下文）；
   - `MemoryModule.classifyAndApplyFeedback` 反查上一轮 assistant 文本，用于反馈四分类（A/B/C/D）。
   **如果删掉 session，反馈通道就拿不到前一轮 assistant 文本。**

4. **`consolidate(sessionKey, now)`** — 当 live message 数超过 `maxLiveMessages` 时，把老消息压缩成 `session_history` 摘要条目，避免 SQLite 无限膨胀。

> Session 不存储 LLM 摘要、不参与召回评分、不做语义匹配。它只是 SQLite 的轻量薄包装。

## Project 的真实职责

`src/agent/project/index.ts`（202 行）+ `scaffolder.ts`（114 行）做两件事：

1. **触发器（`detectExplicitIntent` / `detectClusterCandidate` / `detectSkillPromotion`）** — 三条独立路径判定"这堆 episode 是否值得固化为一个长期项目"。判定全部走数值（intent score / cluster size / converged 比例 / support / confidence），**零字符串匹配**。

2. **Scaffolder（`ProjectScaffolder.scaffold`）** — 触发命中后，在 `~/.flyflor/workspace/projects/{projectId}/` 创建 `README.md`、`TODO.md`、`DESIGN.md`（来自 `templates/projects/`），并发布 `ProjectScaffolded` 事件。幂等：projectId 由 stable hash 决定，重复触发只会 skip。

> Project 不知道 session 是什么，只通过 `EpisodeRecord.episodeId` 间接关联。

## 为什么不能合并？

- **粒度不同**：一个用户在一天内可能开 20 个 session（来自不同 channel / chat 窗口），但只产生 0–2 个真正值得 scaffold 的 project。如果 session = project，每条聊天都会触发 README 生成，workspace 会爆炸。
- **生命周期不同**：session 随 channel 自然存在，关闭聊天窗口就不再活跃；project 是用户/agent 主动认定的"我要持续推进的事情"，会跨越多个 session。
- **存储介质不同**：session 是 SQLite 索引（高频读写），project 是 Markdown 文件 + SurrealDB 节点（低频读写、人可读）。
- **LLM 成本不同**：session 路径 0 LLM 调用；project 路径要 LLM 评估 cluster 证据，所以不能让每个 message 都走 project trigger。

## 代码地图

```
src/agent/session/
├─ index.ts            # 仅做 re-export，3 行
├─ scope.ts            # scopeFor() / sessionIdentityFor() 纯函数（21 行）
├─ session.module.ts   # SessionModule 类，4 个方法（58 行）
└─ types.ts            # SessionIdentity / SessionMessageRecord / SessionSummary / HistoryEntry（48 行）

src/agent/project/
├─ index.ts            # 三路径触发器纯函数（202 行）
└─ scaffolder.ts       # workspace 文件 scaffold 类（114 行）

src/neural/memory/sqlite.ts
└─ SQLiteMemoryStore   # 实现 SessionStore 接口（recordTurn / recentMessages / sessionMessages / listSessions / consolidateSession）
```

依赖方向：

```
runtime.module     ─┐                        ┌─→ markdown.ts (按 session key 写 MEMORY.md)
                    ├─→ MemoryModule.buildPrompt      ─→ session.recentMessagesFor
neural/memory/index ┤                                   ↓
                    ├─→ MemoryModule.rememberTurn    ─→ session.recordTurn ─→ sqlite.recordTurn
                    │                                                       └─→ project.detectExplicitIntent
                    │                                                            └─→ ProjectScaffolder.scaffold
                    └─→ MemoryModule.classifyAndApplyFeedback ─→ session.recentMessagesFor

scripts/session.inspect.ts ─→ session.list / session.timeline
```

## 没有冗余，但容易混淆的几处命名

- `MemoryModule.session` 字段 — 是 `SessionModule` 实例，不是"会话本身"。
- `RuntimeContext.requestId` ≠ `SessionIdentity.key` — 前者是单次 turn 的 trace id，后者是跨 turn 的会话锚。
- `session_history` 表行 ≠ `MEMORY.md` 行 — 前者是 SQLite 内部摘要（用于 prompt 截断），后者是用户可读的 Markdown 历史记录。

## 维护建议

- **不要把 project 触发器搬进 SessionModule**：那会把"短期会话索引"和"长期主题判定"耦合，违反 boundaries.md 的层级隔离。
- **不要让 SessionModule 调 LLM**：它是结构化层，一旦引入 LLM 调用就和 ConsolidationWorker / DreamWorker 职责重叠。
- **如果未来要共享 session ↔ project 的反向链接**：在 SurrealDB 加 `session_in_project` 边即可，不要修改 SessionModule 接口。
