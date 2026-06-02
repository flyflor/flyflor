Confirmed the misdiagnosis correction: `boundToolGroups` (analyzer:384-385) filters investigate to read-only groups in the **main turn**, but the investigate **worker profile** (config.service.ts:319) has `shell` and resolves tools via `resolveWorkerTools(profile)` (worker.service.ts:335/364-365), bypassing `boundToolGroups` entirely. Also confirmed `profile.model`/`provider` is dead config — `streamWorkerStep` hardcodes `getActiveModelName()` at :399. Master-plan T0-T11 structure confirmed.

I have everything I need. Writing the report now.

# flyflor 重构主诊断报告

面向 owner · 中文 · 整合 investigation / subagents / summarization / knowledge-tree / (工具调用横切) 五领域对抗式复核结论

---

## 0. 阅读说明

本报告整合五领域诊断，并对每条断言标注复核结论。被复核判为 `misdiagnosed`/`stale` 的断言已显式剔除或纠正（见各领域"复核纠正"小节）。所有根因均已用 `file:line` 在 HEAD 复核，关键项我已重新核验：

- agent-*.md 缺 `.zh.cn.md` 副本：**确认**（`ls prompts/agent-*.zh.cn.md` → no matches；system/intent/clarify-default/context-render/tool-loop-* 均有 zh 镜像）。
- worker 槽泄漏（`worker.service.ts:309` `if(timeoutFired) return` 在 :312-313 槽释放之前）：**确认**。
- `guard.spawn` 零 `@Subscribe`、kernel 零 `@Subscribe`：**确认**。
- 4 维 `vec0(embedding float[4])`（memory.component.ts:88）+ `enableSqliteVec ?? true`（config.service.ts:245）走生产路径：**确认**。
- scope payload 不匹配（runtime emit `{conversationId,turnId,chunk}` vs `onMemoryStore` 读 `payload.content`，scope.service.ts:174）：**确认**。
- investigate **主回路** 被 `boundToolGroups`（analyzer:384-385）砍到只读，但 investigate **worker profile** 含 `shell`（config.service.ts:319）且经 `resolveWorkerTools`（worker.service.ts:335/364）绕过 boundToolGroups：**确认**（即原"主回路矛盾 agent-investigate.md"的因果链是误诊，已纠正）。

---

## 1. 执行摘要：与"能干活的 coding 内核 + 无 session 生命体"的最大差距

按影响排序，5 条结构性差距同时拖垮两条北极星：

1. **语义记忆内核是空壳（红线级）。** `memory.component.ts:837 embed()` 是 4 维 charCode 玩具向量，`vec0(embedding float[4])`（:88）维度写死，`config.embeddingDimensions ?? 4`（config.service.ts:244）是**死配置**（无任何运行时消费）。`enableSqliteVec` 默认 true，**玩具向量在生产 store/recall 路径上**。结果：所有向量召回 ≈ 噪声，唯一真信号是 lexical `overlap*2`。无 session 生命体赖以"按语义重建记忆"的能力不存在 —— 它实际是一个滑动窗口缓存。直接违反"禁 4 维玩具 embedding"红线。

2. **多步工具回路在压缩点会产生协议 400（正确性硬伤）。** mid-turn 护栏 `guardMidTurnContextBudget` 在工具 for 循环体内被调用（agent.runtime.service.ts:321），按位置 `slice(1,-tailCount)` 折叠（:709），`compactContextMessages` 丢弃 `assistant.toolCalls`。当**单 step 内 ≥2 个 tool_calls + 上下文溢出**时，留在 tail 的 `{role:"tool",toolCallId}` 失去配对 assistant，`normalizeMessages`（model.provider.ts:267-268）仍发原生 `tool_call_id` → 孤儿 → provider 400 → 整轮崩。这是 coding 内核"工具回路能干活"的直接阻断点，优先级最高。（复核纠正：触发条件是**多工具并发**而非任意 mid-turn 折叠。）

3. **子代理委派一旦超时即死锁，且被取消的子代理仍在改文件（可用性 + 安全）。** worker `finally` 在 `if(timeoutFired) return`（:309-311）于槽释放（:312-313 `running.delete`/`activeWorkers--`/`drainQueue`）之前 return；`completeWorkerWithError`（:482-501）从不碰这三者。默认 `maxConcurrent=4`，**4 次超时后 handleSpawn 永远入队、永不执行**。全链路无 AbortController（ModelRequest 无 signal、ToolContext 无 signal、`cancel()` 只改账本），超时/取消都停不下在飞的循环，被"取消"的 worker 继续以 `guardPolicy:"auto"`（:460）执行 mutating 工具。

4. **侦查者（guard）对 spawn 这一 privilege-escalating 动作被静默放行（安全红线）。** `spawn.agent.tool.ts:40` 发 `ask("guard.spawn")`，但全仓**零 `@Subscribe("guard.spawn")`**，SandboxGuard 只订 `guard.ask`。落入 SignalBus 无-responder 分支（signal.bus.service.ts:108-123）：先 emit `guard.unattended` 审计，再 `return autoApproveGuards`=true。从不经 `inspect()`/风险分级/ASK 升格。

5. **遗忘 = 物理删除 + 删后重写，且证据账本/scope 召回从未落地（生命体记忆衰减）。** `forgetChunk`（memory.component.ts:331）硬删 chunk + 图关系；`compactAgedChunks`（forgetting.service.ts:507）先删原文再写 500 字截断摘要（memory.db 侧 durable chunk 原文审计链断裂）；`fadeChunks` 的 newImportance、`driftGems` 的 newSummary **从不持久化**（无 `updateChunkImportance`/`updateGemSummary`）。Scope 第二套召回引擎全链路 dead（`recallFromScope` 零外部调用、`context.builder.build()` 零 scope 引用），且写入侧 `onMemoryStore` 读 `payload.content`（scope.service.ts:174）与 runtime emit 的 `{chunk}` 包裹体不匹配 —— 有 active scope 时 100% 抛 TypeError。investigation 的"可重建证据账本 / repo_overview"在代码中也根本不存在（docs 超前于代码）。

**附加红线违规（跨领域）：** 所有 `agent-*.md`（investigate/explore/code/discuss/general）缺 `.zh.cn.md` 人维副本，且 `.md` 本身为中文 —— 违反"每个 name.md 必须有 name.zh.cn.md，runtime 只加载 .md"。任何动到这些提示词的重构必须先补齐双副本。

---

## 2. 五领域逐项诊断（根因 → 重构 → 参考机制移植）

### 2.1 调查（investigation）→ 主落 T4，补强 T5

**真实根因（已复核）**

| # | 根因 | 复核 |
|---|------|------|
| R1 | 缺统一可重建证据账本：host 预跑 `inspectProject`（agent.runtime.service.ts:1052-1170）与模型 in-loop 回路（:287-328）两套证据只活在本轮 `modelMessages`，turn 结束即蒸发，recovery point 只存 `loopToolResults.length` 计数（:349）。docs `investigation-evidence-loop.md:20-28` 承诺的 evidence ledger / repo_overview 在 src 中零引用。 | confirmed |
| R2 | host 在回路外预跑动态探查，僭越模型 in-loop 职责，无法"据上一条结果决定下一条"。 | confirmed |
| R3 | `inspectProject`/`pickProjectFiles`/`looksLikeProjectFile` 硬编码 Node/TS 单体仓假设（glob `src\|app/*.ts(x)`、grep `TODO\|FIXME`、扩展名白名单）；对 Python/Go/Rust 或非 src/app 布局返回空、read 阶段零文件、host 预跑近似空操作。 | confirmed |
| R4 | `worker.result.injected`（worker.service.ts:297）唯一订阅者是 socket 转发，无 kernel 消费者；background spawn 结论回不到任何父轮。 | confirmed |
| R5 | 证据注入扁平文本拼进每轮重建的 system 前缀且硬截断（30000/8000），无分页/优先级，大仓库证据无声丢失，破坏可缓存稳定前缀。 | confirmed |

**已剔除/纠正的断言：** ~~"investigate 主回路砍 shell 与 agent-investigate.md:13 矛盾"~~ → **misdiagnosed，已拆为两条独立事实**：(a) `boundToolGroups`（analyzer:384-385）确实把**主对话轮** investigate 限制为只读（真实，但与该 prompt 无关）；(b) investigate **子代理** 经 worker profile（config.service.ts:319 含 `shell`）+ `resolveWorkerTools` 加载，**拿得到 shell**，故"读 agent-investigate.md 的子代理拿不到 shell"不成立。另：`agent-investigate.md:6` 写 `bash` 但仓库无 bash 工具、实际名为 `shell`（prompt/工具名不一致，真实但属另一缺陷）。`!includes(":")` 措辞微调：主要用于剔除 ripgrep `path:line:match` 行，非语言白名单。

**推荐重构**

- **退化 inspectProject 为纯静态环境片段**：删除 `inspectProject`/`pickProjectFiles`/`looksLikeProjectFile`（:1052-1170）的动态探查；新增 `EnvironmentContextComponent`（src/context/）只渲染 cwd/shell/git branch/current_date/workspaceRoots，带稳定 `<environment_context>` marker；新增 `ProjectInstructionsComponent` 沿 `.git` 根→cwd 分层发现 AGENTS.md（带 max-bytes 预算）。`requiresProjectInspection` 语义改为"是否暴露 read_only 工具组"，复用现成 in-loop 回路。
- **investigate 解锁只读 shell/workmux**：修改 `boundToolGroups` 对 investigate 额外保留只读 `shell`+`workmux`；只读性靠 `validateModelToolTarget` + guard.* ask 阻断 mutating，而非工具组保证。统一 `intent.md:34,43` 与 `agent-investigate.md` 的矛盾世界观（先补齐 agent-*.md 双副本）。
- **新增 EvidenceComponent**：经 SignalBus `@Subscribe("evidence.collected")` 沉淀工具结果进 memory.db 证据账本（`sourceKind="evidence"`、provenance、去重）；下轮经 `contextSourcesToInject` 作动态段召回。落地 docs:26 的 rebuildable ledger。
- **worker.result.injected 真回灌**：`AgentRuntimeService` 新增 `@Subscribe("worker.result.injected")`（kernel 唯一允许的订阅式接入），background worker summary 写 EvidenceComponent，下轮 build 召回。
- **证据注入分层 + 截断改造**：稳定前缀段（core/SYSTEM/RUNTIME）/ 动态证据段（MEMORY/FACTS/KNOWLEDGE TREE/EVIDENCE）物理分离；30000/8000 硬截断改优先级排序 + 分页，超限 emit `evidence.truncated`（守"禁静默 fallback"）。

**参考机制移植**

- codex `environment_context.rs`/`agents_md.rs`：host 只预注入元数据 fragment + AGENTS.md 分层发现（修正 master-plan 的"RepoOverviewTool"方向，避免重蹈 inspectProject 覆辙）。
- codex `shell_spec.rs`/`gpt-5.2-codex_prompt.md`：调查即工具回路、rg 优先（prompt 一句指导，非专用 host 工具）。
- openhuman `pipeline.rs`/`memory_loader.rs`：装配/递减解耦 + 稳定前缀/动态段分层保护 KV-cache。

---

### 2.2 子代理（subagents）→ 主落 T5，补强 T6

**已确认健康（保留，不动）：** spawn_agent 是普通模型工具（spawn.agent.tool.ts:30），前台 `waitForSettled` 把 `<worker>summary</worker>` 作为返回值，kernel 同轮渲染成原生 `role:"tool"`+`toolCallId`（agent.runtime.service.ts:310-320）。memory 里"压平协议/schema 丢弃"两项**确属已修**，前台同轮回注成立。

**真实根因（已复核）**

| # | 根因 | 复核 |
|---|------|------|
| A | 终态发射、槽释放、循环停止三件事无单一幂等出口：成功体(:284-290)/catch(:300-304)/setTimeout(:200-207) 三发射点，`finally` 的 `if(timeoutFired) return`(:309-311) 跳过槽释放。同时造成双发矛盾终态、brain 审计自相矛盾、确定性槽泄漏死锁、记录写成 `profileName:'unknown'`。 | confirmed |
| B | 全链路无 AbortSignal：ModelRequest/ToolContext 无 signal，`cancel()`(:141-156) 只改账本不停循环 —— 假取消，被取消的 worker 继续以 `guardPolicy:"auto"`(:460) 执行 mutating。 | confirmed |
| C | guard.spawn 是死信号，落入 SignalBus 无-responder autoApprove 分支(108-123)，从不经 inspect/分级/ASK。 | confirmed |
| D | worker.result.injected 名为"注入"实只接 UI 转发，background 结果回不到发起轮。 | confirmed |
| E | per-profile `model`/`provider` 死配置（`streamWorkerStep` 硬编 `getActiveModelName()`，worker.service.ts:399）；`worker.step` 声明却从不 emit。 | confirmed |

**复核纠正（必须并入综合）：** ~~"memory.store/brain.recordEvent 各执行两次"~~ → `memory.store`（:263-268）**只在正常完成路径执行一次**，`completeWorkerWithError` 不调用它；故超时场景 memory.store **仅 1 次**。`brain.recordEvent` 确跑两次，但是 `worker.failed`(484) 与 `worker.completed`(269) **两种不同事件类型**，非重复同一事件。矛盾双 settled 与 result.injected 误发的核心结论不变。另：死锁仅在 `timeoutSeconds>0` 时触发（默认 300>0，成立；设为 0 则不装定时器，泄漏不发生 —— 唯一缓解前置条件）。

**推荐重构**

- **R1 单一幂等 settle() + RAII 槽守卫**：`acquireSlot(workerId)` 返回幂等 release 闭包（`running.delete`+`activeWorkers=max(0,-1)`+`drainQueue`）；`settle(workerId, {status})` 用 `Set<workerId>` 闩锁，发恰好一个 `worker.completed` XOR `worker.failed` + 一个 `worker.settled` + 一次 memory/brain 写 + release()。**删除 `if(timeoutFired) return`**；`completeWorkerWithError` 退化为薄包装（带真实 profileName）。
- **R2 AbortSignal 贯穿**：`ModelRequest` 加 `signal?`，fetch 用 `AbortSignal.any([request.signal, AbortSignal.timeout(...)])`；`ToolContext` 加 `signal?` 透传；每 worker 持 AbortController，setTimeout 改为 `controller.abort()`，循环每步开头自查 `if(signal.aborted) settle(cancelled); break`；父 turn loop 引入 turn 级 controller。超时/cancel/用户中断三者统一 → abort → 单 settle()。
- **R3 spawn 走真侦查者 + 父权限下沉**：`ask("guard.spawn")` 改复用 `ask("guard.ask", {toolName:'spawn_agent', riskLevel:'medium'})`（少一条死命名空间），medium 命中 escalate→ASK；spawn 时把父 `guardPolicy` 作为 worker 下限（替换硬编 :460 `"auto"`）；默认从 worker profile 剔除 spawn_agent 防递归 fork。统一 SignalBus.autoApproveGuards 来源（消除构造默认 true vs SandboxGuard 读 config 的双源分歧）。
- **R4 背景结果结构化回注**：`<subagent_notification>` 片段，AgentRuntimeService `@Subscribe("worker.result.injected")` 以 synthetic user 消息入父历史（`trigger_turn=false`），回注前 char-cap。
- **R5 兑现配置/可观测**：`streamWorkerStep` 读 `profile.model ?? getActiveModelName()`；worker 循环每步 emit `worker.step`。

**参考机制移植**

- openhuman `run_subagent`（单 Result → 单终态事件，类型系统性质）+ codex `SpawnReservation`（RAII commit/Drop）→ R1。
- codex CancellationToken 子树 + openhuman InterruptFence + hermes 协作式 interrupt → R2。
- opencode `deriveSubagentSessionPermission`（父 deny 下沉 + 默认禁 todowrite/task）→ R3。
- codex `ContextualUserFragment`/`inject_without_turn` + opencode `inject()` + openhuman `max_result_chars` → R4。

---

### 2.3 摘要（summarization）→ 主落 T6，强制依赖 T7，正确性子项交叉 T3

**真实根因（已复核）**

| # | 根因 | 复核 |
|---|------|------|
| 1 | `ContextCompressorComponent` 是 100% 确定性正则：`renderSummary` slice(0,360)（:78）+ `extractAnchors` ≤24 锚点（:104），`compact()`/`compactContextMessages()` 同步零 ModelProvider。与决策侧"强制真模型"自相矛盾。 | confirmed |
| 2 | mid-turn 折叠破坏原生 tool 配对 → provider 400（见执行摘要 #2）。 | confirmed（机制精确化见下） |
| 3 | checkpoint 单条快照无链：schema 仅 4 列无 `parent_id`（memory-schema.sql:21-26），`latestCheckpoint` limit 1，builder 只注入最新一条；多次压缩后早期被折叠消息在模型可见上下文永久消失。 | confirmed |
| 4 | checkpoint `sourceMessageIds` 是合成下标 `${turnId}:model-context:${i}`（:713），不指向真实 brain 行，回溯断链。 | confirmed |
| 5 | 只削条数不裁单条体量，无收敛保证（固定保留近 2 条 + 未压缩 system 段）。 | confirmed |
| 6 | 4 维玩具 embedding 在生产 store/recall 路径（见 2.4），是压缩后"第二召回通道"失效的放大器。 | confirmed |

**复核纠正：** claim #2 机制精确化 —— **不是任意 mid-turn 折叠都产生孤儿**。单 tool_call 时 `tail=slice(-2)` 恰好把携带 native tool_calls 的 assistant 与其 tool 结果一起留在 tail，配对保留，不会 400。真正稳定触发 400 的是**单 step 内 ≥2 个 tool_calls + 溢出**：第二个 tool 追加后折叠，assistant(含 tool_calls) 被挤出 tail 折成 system 文本，≥2 条 `{role:tool}` 留在 tail 失去配对。综合引用时应表述为"多工具并发 + 溢出"。行号微调：mid-turn 护栏主体应引 695-753（全函数），调用点在 for 循环 :321。

**已剔除断言（master-plan:27 的过时描述）：** ~~"压缩删 chunk 不保证 brain 留原文（违反不可删审计）"~~ → **部分有误**：`registry.execute` 已在执行阶段把全量 output 入 `brain_tool_calls`、user/assistant 入 `brain_messages`，审计存在性满足。真正缺陷在 checkpoint 合成指针使"原文可回放"不可用 + 模型可见上下文层早期证据丢失。T6 验收标准应改为"checkpoint 指针可回放到真实 brain 行"，而非"原文是否入 brain"。

**推荐重构（一个闸门 + 有序升级 + 真模型蒸馏）**

- **阶段1（最低风险先做，归 T3）**：新建 `tool.result.budget.ts`，UTF-8 安全裁剪 + 自描述 re-run 标记，替换 `adapters.ts:146/169/190/221`、`file.tools.ts:222/226` 的裸 `.slice()` 与魔数 8000/4000，统一 `ContextConfig.toolResultBudgetBytes`。
- **阶段2**：`ContextGuardComponent`（soft 0.90/hard 0.95，消费真实 provider token usage；token 未通前用 estimatedChars stopgap 并标注）+ 3-strike 熔断，连续失败 → 显式 turn-abort + brain + SignalBus warning（绝不静默返回超限）。
- **阶段3**：microcompact 中间档 —— 保留最近 N 条 tool 结果 verbatim，旧 tool body 原位占位替换（保信封不破配对，幂等）。
- **阶段4**：`ContextCompressorComponent` 背后加 `async distill()`，prompt 落 `prompts/compaction.md` + `prompts/compaction.zh.cn.md`（runtime 只加载 .md）；no-partial-mutation 契约（蒸馏成功非空才替换，失败显式 + brain + warning，绝不静默回退正则）。
- **阶段5**：mid-turn 折叠改**按 tool_call/tool_result 配对单元切**（`_align_boundary_backward`）+ 折叠后 `sanitizeToolPairs`（删孤儿/插 stub），修 #2+#4 同根；checkpoint 加 `parent_id` 做 rolling summary，`sourceMessageIds` 改真实 brain id；逐字保留最近真实 user 消息/计划。
- **阶段6（红线，与 T7 协同）**：替换 4 维玩具 embedding（见 2.4）。

**参考机制移植**

- openhuman `pipeline.rs`/`guard.rs`/`tool_result_budget.rs`/`microcompact.rs`：单闸门 + 有序升级 + 3-strike 熔断 + 字节预算 re-run 标记。
- codex `compact.rs` + hermes 12-section 模板 + openhuman 防注入前缀：真模型蒸馏。
- hermes `_align_boundary_backward`/`_sanitize_tool_pairs` + codex `build_compacted_history`：配对安全切分 + 逐字保留 user。

---

### 2.4 知识树（knowledge-tree）→ 主落 T7，部分落 T6，少量触 T3

**真实根因（已复核）**

| # | 根因 | 复核 |
|---|------|------|
| R1 | 语义层是占位：`embed()` 4 维 charCode 玩具（:837），`vec0(float[4])` 写死（:88），`embeddingDimensions` 死配置；所有向量召回 ≈ 噪声，唯一真信号 lexical `overlap*2`。`recordRetrievalTrace` 却标 `strategy="tree+vector+lexical+fact+graph"` 冒充语义。 | confirmed |
| R2 | "知识树"名不副实：`treeRecall` 对 memory_chunks 取最近 500 行多路打分 + 一次图扩展，无 L0→L1 桶封存、无 SummaryNode、无 scope/global 双树、无摄取管线（`store()` 是裸 autoincrement INSERT，无确定性 ID/幂等闸门）。红线"双树=Scope树+全文树"无对应实现。 | confirmed |
| R3 | 遗忘扫描不完整的真机制：`chunkRecallCandidates` 硬编码 SQL `limit 500` + `treeRecall` 末尾 `slice(limit)`，衰减只作用于最近 ~500 行；应改全表 SQL 游标。 | confirmed |
| R4 | 遗忘=删除：`forgetChunk` 硬删（连图关系）；`compactAgedChunks` 先删原文再写截断摘要；`fadeChunks` newImportance、`driftGems` newSummary 从不持久化（无 `updateChunkImportance`/`updateGemSummary`）。 | confirmed |
| R5 | Scope 第二套召回引擎全链路 dead + 写入侧 `onMemoryStore`(:174) 在有 active scope 时 100% 抛 TypeError（payload 契约不一致）。 | confirmed |
| R6 | 召回非单遍：`intent.analyzer`(:86) + `recall`(builder:40) + `recallFacts`(builder:46) 每轮对同一扁平树跑 3 次全量 limit-500 重排，recencyBoost 时间漂移致结果可能不一致。 | confirmed |
| R7 | 学习层无统一 stability：结晶升格是裸 `hitCount>=3`（crystal.service.ts:397），与遗忘独立 Ebbinghaus 不耦合；无 class 半衰期、无 user_state(pinned/forgotten)、无 post-turn 反思。 | confirmed |
| R8 | recency-boost 死功能：LAST_RECALL_KEY/LAST_STORE_KEY 只写不读；docs 公式幂律 `1/(1+t/24)` 与代码指数 `exp(-t/24)`(:222) 不一致。 | confirmed |

**复核纠正：** claim #4 措辞收紧 —— "衰减不落库"**仅对 chunk importance 与 gem summary 成立**；fact confidence 经 `ageFacts` upsert 会落库，gem 非漂移分支经 `updateGemConfidence`(crystal.store:366) 落库。准确表述："chunk 的 newImportance 与 gem 的 newSummary 从不持久化"。claim #5 定级提升 —— `onMemoryStore` 是**真实运行时 P0 崩溃**（有 active scope 即 TypeError），严重性高于 `recallFromScope` 纯死代码。claim #1 与 #3/#4 合并 —— "遗忘扫描不完整"与"召回扫描不完整"是同一根因（`treeRecall` 无全表游标），不应计为两个独立缺陷。

**已剔除断言（来自 investigation/summarization 共识）：** ~~"treeRecall('') 过滤器丢弃绝大多数行"~~ → 过滤器（`score>importance`，:903）在空查询下因 `recencyBoost>0` 几乎恒真，**大多数 chunk 能通过过滤器**；整改应是全表游标遍历而非修过滤器/调阈值。

**推荐重构**

- **A. 真 embedding（T7 第一优先）**：新建 `src/memory/embedding/{embedding.provider.ts, ollama.provider.ts, openai.provider.ts, factory.ts}`；`memory.component.ts:88` vec0 改 `float[${dims}]`；新增 `store_meta` 表记 dims+signature，开库比对不符即 throw；`embed()` 改 `await provider.embedOne()`，**store/recall/treeRecall 改 async**；factory 未知名 throw 不静默降级；`InertEmbeddingProvider` 仅测试用。
- **B. 分层知识树 + 摄取管线**：新增 `memory_trees/memory_summaries/memory_buffers`，`tree.kind='scope'|'global'`（落地双树）；`appendLeaf+cascadeSeals+shouldSeal` 双闸门 + 单事务封存；`store()` 改摄取管线（`确定性 chunk_id=sha256(...)前32hex` 是最高优先零风险项，立得重放幂等）。
- **C. 全表遗忘游标 + 模糊不删**：`fadeChunks/ageFacts/compactAgedChunks` 停调 `treeRecall("")`，改 `scanAllChunksCursor`（`ORDER BY id LIMIT ? OFFSET ?`）；新增 `updateChunkImportance`/`updateGemSummary` 落库；`forgetChunk → archiveChunk`（加 status 列，archived 不进召回但保留行+原文）；`compactAgedChunks` collapse 前 `brainComponent.recordEvent` 记**原始全文**（修审计断裂）。
- **D. 复活 Scope 召回**：统一 `MemoryStorePayload` 为单一形状（平铺 chunk 字段）；`context.builder.build()` 注入 scope 召回（ScopeService `@Subscribe("scope.activated")` 自持活跃 scope）；写 `scope_recall_log`。
- **E. 召回单遍**：runtime 一轮调一次 `treeRecall`，经 intent payload 传入 build，`recall`/`recallFacts` 改从已算结果取字段；recall 改两段式（倒排粗筛 ≤200 → embed 一次 → cosine rerank，确定性 id ASC tie-break）。
- **F. 统一 crystal stability（shadow 先行）**：升格闸门从 `hitCount>=3` 改 `stability >= τ`（class 分级半衰期）；加 `user_state(auto/pinned/forgotten)` 列，衰减前短路（pinned 永不衰减、forgotten 归档阻止复活）；补 post-turn 反思钩子。

**参考机制移植**

- openhuman `embeddings/{provider_trait,factory,openai,ollama}.rs`：EmbeddingProvider trait + factory + signature 分桶 + 写时阻断 → A。
- openhuman `tree_source/{types,bucket_seal}.rs`/`ingest.rs`：分层树 + 双闸门封存 + 确定性 chunk_id → B。
- openhuman `retrieval/topic.rs:173-233`：单遍倒排粗筛 + embed 一次 + cosine rerank → E。
- openhuman `learning/stability_detector.rs`/`profile.rs`：统一 stability + user_state 短路 → F。
- hermes `holographic.py`（HRR 相位编码）：可选零依赖过渡（**终态仍是真模型 embedding**）。

---

## 3. 跨领域依赖与顺序

### 3.1 共享地基（必须先做，被多领域复用）

| 地基 | 轨道 | 被谁复用 | 状态 |
|------|------|---------|------|
| **DI 急切引导 + 信号 require-responder + 侦查者接线** | T1 | guard.spawn(T5)、压缩熔断 warning(T6)、scope.activated 消费(T7) | master-plan 已列；是 ASK>Confirm 与所有 `@Subscribe` 生效的前提 |
| **原生 tool 协议往返**（`ContextMessage.toolCalls?/toolCallId?`、`normalizeMessages` 发原生、`registry.execute(...,providerCallId)`） | T2 | T3/T4/T5（worker 回路）、T6（配对自愈依赖结构化消息） | master-plan 已列；**T6 的 sanitizeToolPairs、T5 的 settle 回注均依赖它** |
| **WorkspaceAllowlistComponent** | T3 | T4（environment 片段 + in-loop 只读 shell 的边界） | master-plan 已列 |
| **真 embedding（EmbeddingProvider + factory + vec0 参数化）** | T7-A | **T6 压缩后召回通道**、T4 EvidenceComponent 向量化、scope/crystal 三库 | 是 T6 完整生效的**硬前置依赖**，应标为 T7 第一子项而非并行 |
| **SignalBus guard.* 接线（responder）** | T1 | T5 guard.spawn 真分级、T4 evidence.collected、worker.result.injected 回灌 | guard.spawn 当前死信号 |

### 3.2 执行顺序（依赖链）

```
T0(红线/文档) ──┬─→ T1(DI+guard 脊柱) ──┬─→ T3(工具硬化: tool.result.budget) ──→ T4(调查单回路: Env片段+Evidence)
                │                        │                                          └─→ T5(子代理: settle+abort+guard.spawn+回注)
                └─→ T2(原生 tool 协议) ──┴─→ T6(摘要: 配对切分+蒸馏+checkpoint链)
                                              └─→ T7(知识树: 真embedding→分层树→全表游标→scope复活→单遍召回→stability)

正确性紧急插队: T6 的「mid-turn 按配对单元切 + sanitizeToolPairs」应前置到 T3 之后立即做
                （它直接 400 让工具回路崩，是 release 门槛 #2）。
```

**可并行：** T4 与 T5 在 T2/T3 就绪后可并行（不同子系统）；T7-A（真 embedding）可与 T5 并行启动，但 T7-B/C/E 依赖 A 完成（store/recall 改 async）。

### 3.3 对现有 master-plan 的补强

master-plan（docs/refactor-master-plan.md）方向**高度一致**，本报告逐条用 file:line 坐实并补强 6 处计划未显式拆出的项：

1. **T6 应把"mid-turn 按配对单元切 + sanitizeToolPairs"列为第一优先**（master-plan:26 提及但未给修法，且这是 provider 400 硬伤）。
2. **T6 验收标准修正**：master-plan:27 的"压缩删 chunk 违反不可删审计"**部分有误**（审计存在性已满足），改为"checkpoint 指针可回放到真实 brain 行"。
3. **T7 真 embedding 应标为 T6 硬前置**（master-plan 把 T7 当并行轨；4 维 embedding 在生产路径，是压缩后召回失效的放大器）。
4. **T5 补 R5**：per-profile model/provider 死配置、worker.step 从不 emit（master-plan 未列）；父权限下沉（opencode）是新增安全增强。
5. **T7 补细项**：`embeddingDimensions` 死配置、`fadeChunks/driftGems` 不落库、recency-boost 死功能、docs/code 衰减公式漂移。
6. **新增 T7.5 学习闭环**：crystal stability 统一升格/遗忘 + USER 宪法硬覆盖（pinned/forgotten）+ post-turn 反思 —— 把 crystal 与 forgetting 两个互不相干标量打通，是"生命体"一极关键，未在 12 轨单列。
7. **全局红线项**：agent-*.md 补齐 `.zh.cn.md` 双副本（master-plan:59 已列双副本验收，但未点名 agent-* 系列空缺）。

---

## 4. 优先级路线图

### P0 —— release 门槛级、阻断双北极星核心能力

| 项 | 轨道 | 为什么先做 | 完成判据 |
|----|------|-----------|---------|
| **P0-1 DI 引导 + guard.* require-responder + 侦查者接线** | T1 | 所有 `@Subscribe` 在 `--serve` 真正生效的前提；当前 guard.spawn 死信号、kernel 零 @Subscribe 都依赖它 | `--serve` 下 SandboxGuard 真订阅生效；guard.* 无 responder → `guard.unattended`+拒绝（非 autoApprove）；ASK>Confirm 成立 |
| **P0-2 原生 tool 协议往返** | T2 | T3/T4/T5/T6 全部复用；多步回路协议保真的地基 | 带 `tool_calls` 的 assistant 入历史；`tool_call_id` 结构化往返；多步工具回路无协议错 |
| **P0-3 mid-turn 配对安全切分 + sanitizeToolPairs** | T6(前置) | 多工具并发+溢出时直接 provider 400 让整轮崩，coding 内核工具回路不可用 | 构造 ≥2 tool_calls + 溢出场景，压缩后发 provider 无孤儿 tool、无 400 |
| **P0-4 worker 单一幂等 settle() + RAII 槽守卫 + AbortSignal** | T5 | 4 次超时即死锁让委派整体不可用；被取消的 worker 仍 mutating 是副作用泄漏 | 超时/取消/失败/成功统一经 settle()；槽必释放；`maxConcurrent` 次超时后仍能 spawn；cancel() 真中断在飞循环 |
| **P0-5 真 embedding 替换 4 维玩具** | T7-A | 红线违规；语义召回 ≈ 噪声使无 session 生命体的记忆重建失效；T6 召回通道依赖它 | vec0 维度=真模型维度；factory 未知名 throw；store_meta 维度门禁开库报错；召回基于真 embedding |
| **P0-6 guard.spawn 走真侦查者链** | T5 | privilege-escalating 动作被静默放行违反 guard 红线 | spawn 经 guard.ask 真 inspect/分级；medium→ASK 升格；有 responder 时阻断等待 |

### P1 —— 生命体记忆正确性、委派闭环

| 项 | 轨道 | 为什么 | 完成判据 |
|----|------|--------|---------|
| **P1-1 EvidenceComponent + worker.result.injected 回灌** | T4/T5 | 证据 turn 结束即蒸发、background 结论回不到父轮，跨轮调查无法累积 | 工具结果经 evidence.collected 沉淀 memory.db；下轮 build 召回；background worker summary 下轮可见 |
| **P1-2 真模型蒸馏 + checkpoint 链 + 指针指真实 brain id** | T6 | 正则截断丢语义；单条 checkpoint 多次压缩单调遗忘；合成下标回溯断链 | distill 走真 ModelProvider（prompt 双副本）；checkpoint 有 parent_id 做 rolling；sourceMessageIds 指真实 brain 行 |
| **P1-3 遗忘全表游标 + archive 不删 + collapse 前原文入 brain** | T7/T6 | 衰减只作用最近 500 行；硬删违反"遗忘≠删除"；compactAgedChunks 原文审计断裂 | 全表游标遍历无 500 上限；forgetChunk→archiveChunk；collapse 前 brain 记原始全文；newImportance/newSummary 落库 |
| **P1-4 复活 Scope 召回（修 payload 崩溃 + build 注入）** | T7 | 有 active scope 时 onMemoryStore 100% TypeError；scope 召回引擎全 dead | runtime→scope 端到端测试绿；context.builder 注入 `## SCOPE RECALL`；scope_recall_log 有 INSERT |
| **P1-5 investigate 解锁只读 shell + 统一提示词矛盾** | T4 | investigate 主回路无法跑测试/git log 验证假设 | boundToolGroups 允许只读 shell/workmux（边界靠 guard）；intent.md 与 agent-investigate.md 一致 |
| **P1-6 agent-*.md 补齐 .zh.cn.md 双副本** | T0/T4 | 红线违规；任何动这些 prompt 的重构前置 | 5 个 agent-*.md 各有 .zh.cn.md；runtime 只加载 .md |

### P2 —— 质量、可观测、收敛

| 项 | 轨道 | 为什么 | 完成判据 |
|----|------|--------|---------|
| **P2-1 召回单遍复用** | T7 | 每轮 3 遍全量重排，recencyBoost 漂移致结果不一致 | 一轮一次 treeRecall，intent/builder 复用 |
| **P2-2 工具结果字节预算统一 + re-run 标记** | T3 | 多层裸 slice/魔数 8000，二次截断 | 统一 toolResultBudgetBytes；超限带 re-run 标记 + evidence.truncated |
| **P2-3 crystal 统一 stability + user_state + 反思（shadow 先行）** | T7.5 | 升格/遗忘两套标量不耦合；无用户主权 | stability 闸门 shadow 验证不劣于 hitCount>=3 后切换；pinned/forgotten 短路生效 |
| **P2-4 per-profile model/provider + worker.step emit** | T5 | 死配置静默忽略；worker 内循环黑盒 | profile.model/provider 生效（未配硬失败）；worker.step 每步 emit |
| **P2-5 docs/code 衰减公式对齐** | T7 | 幂律 vs 指数漂移影响老记忆存活 | 二选一对齐，消除漂移 |

---

## 5. 红线与双北极星核对

**双北极星：**
- **底层 coding 内核真正能干活**：P0-3（配对自愈不再 400）让工具回路在压缩点不崩；P1-5（investigate 解锁只读 shell）+ P0-2（原生协议）让 read/grep/glob/git/codegraph/只读 shell 在调查路径可达；P0-4（abort + settle）让委派可控可用；P0-5（真 embedding）让"关于这个仓库我以前知道什么"的语义召回可信。✔
- **无 session 智能生命体（记忆环绕内核）**：所有组件（EnvironmentContext/AGENTS.md/EvidenceComponent/checkpoint 链/真 embedding 召回）每轮从本地持久态（config/.git/memory.db/brain.db）重建，模型供应商永不作连续性来源；worker 回灌走"同轮写 memory.db、下轮 build 召回"。✔

**逐条红线核对：**

| 红线 | 核对 |
|------|------|
| 无 session | EvidenceComponent/checkpoint/真 embedding 召回/worker 回灌全部本地重建，不依赖 provider 连续性。✔ |
| brain 不可变月度全量审计 | 改动只"减少重复写入"（settle 幂等使 recordEvent 恰好一次）与"compactAgedChunks collapse 前记原始全文"（修审计断裂），绝不删 brain。✔（且修复现状违规） |
| memory.db 热记忆 | 证据账本/trees/summaries/buffers/scope_vectors/store_meta 全在 memory.db。✔ |
| kernel 纯编排 | 删除 inspectProject（现状 kernel imperative 调工具）反而更合规；新增唯一 `@Subscribe("worker.result.injected")` 是订阅式接入；压缩决策移入 ContextPipelineService；forgetting/scope/crystal 经周期 + @Subscribe 自持状态。✔ |
| SignalBus 血管层 + guard.* 有 responder + ASK>Confirm | P0-1/P0-6：spawn 与只读 shell 走 guard.ask 真分级/ASK；侦查者对 mutating/spawn 真阻断。✔ |
| WS 三面 | evidence.collected/worker.result.injected/scope.activated 仍只作 SignalBus 广播被订阅显示，不新增 WS 直连面。✔ |
| 禁 mock/fake 供应商 + 禁 4 维玩具 embedding + 禁静默 fallback | P0-5 真 HTTP embedding（未知名 throw、写时阻断、维度门禁）；蒸馏走真 ModelProvider，失败显式 + brain + warning；截断改 evidence.truncated 显式信号。✔ |
| 提示词双副本 | P1-6 补齐 agent-*.md 的 .zh.cn.md；新增 compaction.md/反思 prompt 同样双副本，runtime 只加载 .md。✔ |

---

## 6. 需 owner 拍板的开放问题

1. **真 embedding 部署形态**：本地 Ollama(bge-m3/nomic，零外网) 还是云 OpenAI 兼容端点？维度 768 还是 1024？决定 vec0 建表维度、store_meta signature、是否需要 HRR 离线过渡。**（阻塞 P0-5 与 T7 全链路。）**

2. **investigate 只读 shell 的 read-only 如何强制**：命令白名单(rg/cat/ls/git log/测试 runner) vs guard.* 逐条 ASK vs 沙箱只读挂载？涉及 ASK>Confirm 交互成本与 `boundToolGroups` 开口大小。

3. **intent.md（"跑 shell 用 code 模式"）vs agent-investigate.md（"用 bash 验证假设"）哪个是真相**：统一到"investigate 可只读 shell"，还是保持"investigate 纯静态、要验证就升级到 code/spawn investigate worker"？两条路对主回路 vs 子代理能力边界定义完全不同。

4. **background 子代理回注时机**：codex `trigger_turn=false`（仅入父历史、下轮消费，省 token 但有一轮延迟）vs opencode 主动 fork 父续跑（时延低但抢占）？是否需主动 emit"新证据可用"提示。

5. **embedding/store/recall 改 async 的破坏性影响**：需确认 T2/T3 工具回路与 context.builder 全链支持 await，且 forgetting 周期全表扫描需分批 yield 防阻塞 turn loop。

6. **遗忘 archive 后的最终归宿**：archived 行永久留 memory.db（库无界增长）vs 定期迁移 brain 月度库后从 memory 清理（清理是否算"删 memory 热记忆"而非"删 brain"，需确认不违反红线）。

7. **crystal stability 切换策略**：shadow 期多久、用什么指标判定新闸门不劣于 `hitCount>=3` 才正式切？已升格 Gem 是否按新公式回溯重算（迁移风险）。

8. **docs/code 衰减公式分歧**（幂律 `1/(1+t/24)` vs 指数 `exp(-t/24)`）以哪个为准 —— 改 code 贴 docs 长尾，还是改 docs 承认指数实现？影响老记忆实际存活时长，属产品语义取舍。

9. **per-profile provider 未配置时**：硬失败（红线倾向，显式不静默）还是 fallback 父 provider？需确认不破坏 general profile 零配置启动。

10. **蒸馏失败的 turn-abort 形态**：硬 abort 还是降级到"只发未压缩 system+最近 user+配对自愈后 tail"并显式告警？红线要求显式不静默，具体降级形态需拍板。

11. **是否引入 codex 式持久 goal + 自驱 continuation**：会显著改变 turn 边界与跨轮控制流，与 flyflor"host decider 每轮重新决策"范式冲突，属较大架构取舍（可能新轨或 T4 扩展）。

---

相关文件锚点（均为绝对路径）：
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/kernel/agent.runtime.service.ts`（inspectProject:1052-1170 / mid-turn 护栏:695-753 调用点:321 / memory.store emit:232）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/worker/worker.service.ts`（槽泄漏:309-321 / completeWorkerWithError:482-501 / getActiveModelName:399 / guardPolicy auto:460）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/tools/spawn.agent.tool.ts`（guard.spawn:40）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/signal/signal.bus.service.ts`（无-responder 分支:108-123）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/memory/memory.component.ts`（embed:837 / vec0:88 / forgetChunk:331 / treeRecall:217,229）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/scope/scope.service.ts`（onMemoryStore:167-174）/ `src/scope/scope.store.component.ts`（recallFromScope:239）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/context/context.compressor.component.ts`（renderSummary:78 / extractAnchors:104）/ `src/context/context.intent.analyzer.component.ts`（boundToolGroups:376-388）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/src/config/config.service.ts`（embeddingDimensions:244 / investigate profile:317-320）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/docs/refactor-master-plan.md`（T0-T11:40-51）
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor/prompts/`（agent-*.md 缺 .zh.cn.md 副本）