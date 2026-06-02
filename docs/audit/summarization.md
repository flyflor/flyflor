# summarization 诊断与重构方案

## 诊断

## 一句话定性

flyflor 的"压缩"在工程上是**多层互不知情的确定性字符截断 + 正则锚点抽取**，它既不是"流体智力蒸馏"（违背 coding 内核要真正能干活），又因为 checkpoint 单条快照 + 合成指针 + 4 维玩具 embedding 召回，使得"无 session 生命体"在多轮压缩后单调遗忘早期证据。两条北极星都被这一个子系统同时拉低。

## 错在哪、为什么共同致命

**1. 摘要端是确定性占位，与决策端"强制真模型"自相矛盾（P0，已核实）**
`context.compressor.component.ts:78` 对每条消息只做 `content.replace(/\s+/g," ").slice(0,360)`，`:91-105` 用约 10 条正则抽 ≤24 个 anchor，`compact()`/`compactContextMessages()` 是**同步方法、零 await、零 ModelProvider 调用**。类 JSDoc（`:8`）自承"deterministic checkpoint text; model distillation can replace internals behind the same contract"——即设计上就预留了真模型缝，但从未填。这与 intent 决策侧"no mock provider route and no deterministic parser"形成同红线两套标准。后果：任何超预算上下文（pre-turn 与 mid-turn）的语义、因果、跨消息推理全部被替换成"前 360 字硬截断 + 关键词"，coding 内核拿到的是被砍断的句子，无法据此续作。

**2. mid-turn 折叠破坏 OpenAI 原生 tool 配对，直接 400（P1，已核实，并定位到触发点）**
工具循环在 `agent.runtime.service.ts:310-321` 内：每执行一个 toolCall 就 append 一条 `{role:"tool",toolCallId}`，**紧接着在 for 循环体内（`:321`）调用 `guardMidTurnContextBudget`**。该护栏按位置切片：`first=messages[0]`、`tail=messages.slice(-2)`、`compacted=messages.slice(1,-2)`（`:706-709`），把中间全部折叠成一条 `{role:"system"}` 文本（`:721-728`），**丢弃 assistant 的 toolCalls 字段**。`model.provider.ts:267-268` 对 `{role:"tool",toolCallId}` 会发出原生 `tool_call_id`，而其配对的 `assistant.tool_calls` 已被折进 system 文本——下一次 streamModelStep 发出孤儿 tool 消息，provider 返回 400，整轮失败。这违背 `docs/context-memory-compaction.md` 明列的"Compaction must preserve tool call/result pairs"。这是正确性硬伤，优先级最高。

**3. checkpoint 单条快照 + 无链，早期证据在模型可见上下文永久消失（P1，已核实）**
`memory-schema.sql:21-26` 的 `context_checkpoints` 只有 `id/conversation_id/summary/created_at`，无 `parent_id/superseded_by`。`memory.component.ts:809-816` `latestCheckpoint` 用 `order by created_at desc limit 1` 只取最新一条。`context.builder.service.ts:49-54` 只注入 `latestCheckpoint`，并仅用其 `sourceMessageIds` 过滤 tail；`recentMessages` 只拉 `recentTurns*2` 条窗口（`:53`）。第二次压缩产生新 checkpoint 后，旧 checkpoint 不再被注入，其覆盖的更早消息既不在新 checkpoint 的 sources 里、也超出 recent 窗口——模型侧等同永久丢失。brain.db 仍有全保真审计（registry 的 upsertToolCall/recordMessage），但"在可继续工作的上下文里保留早期要点"这一生命体目标被违反：摘要随压缩次数单调遗忘。

**4. checkpoint 指针是合成下标，回溯断链（P2，已核实）**
`agent.runtime.service.ts:713` 用 `sourceMessageIds = compacted.map((_,i)=>`${turnId}:model-context:${i}`)`，纯位置序号，不对应 messages 表 id、也不对应 brain_tool_calls.id；缺失时 `context.compressor.component.ts:53` 进一步退化为 `context:${i}`。这些 id 原样写进 `context_checkpoints.summary`（`memory.component.ts:793-796`）。结果：checkpoint→brain 原文的指针指不回去，rebuildCriticalIndexesFromBrain 无从用它定位。"原文先入 brain"红线在审计存在性上满足，但压缩侧的"可回放"实际不可用。

**5. 只削条数不裁单条体量，无收敛保证（P2，已核实）**
pre-turn 固定保留最后 2 条 verbatim（`:652`），mid-turn 固定 `tail=slice(-2)`（`:707`），且 `first=messages[0]`（含全部模板 + SYSTEM + RUNTIME + RECALL + 知识树 chunk，每条 chunk 700 字 `context.builder.service.ts:132`）整段从不被压缩。若 system 段或保留的 2 条本身就超 `maxContextChars`(默认 90000，`config.service.ts:251`)，护栏 return 后仍超限；mid-turn 可能反复折叠却降不到阈值，唯一兜底是 `messages.length<=1`。

**6. （审计未列、本次新发现，红线级）召回端是 4 维玩具 embedding，且已接入生产路径**
`memory.component.ts:88` `create virtual table memory_vectors using vec0(embedding float[4])`，`:189-191` 在 `store()` 里用 `this.embed(content)` 写入，`:837-845` 的 `embed()` 就是把 charCode 摊进 4 个桶再归一化的确定性玩具向量（JSDoc 自称"suitable for local smoke tests"）。这不只是测试 helper——它在**真实 store/recall 路径**上。这对压缩子系统是致命放大器：压缩后早期原文要靠 `memory_recall`（`context.builder.service.ts:39-44`）重新浮现，而召回靠 4 维向量，语义分辨率近乎为零。即使修好 checkpoint 链，被折叠证据的"第二条召回通道"仍然瞎。这直接违反红线"禁止 4 维玩具 embedding，必须真 embedding"。

## 为什么这六点共同让双北极星失守

- **coding 内核失守**：内核要真正 read/grep/edit/git 干活，依赖长工具结果与跨步推理留在上下文里。但工具结果被多处裸 `.slice()` 截断且无 re-run 标记（`adapters.ts:146/169/190/221`、`file.tools.ts:222/226` 硬编码 8000 绕过 budget），随后又被 360 字正则摘要二次砍——内核拿到的是"截断的截断"，且 mid-turn 折叠还会直接 400 让整轮崩溃。
- **生命体失守**：生命体靠"每轮从本地状态重建 + 记忆环绕"续命。但 checkpoint 单条无链 + 合成指针 + 玩具 embedding，三者叠加使"越压越久 → 早期要点单调遗忘 + 回不到原文 + 召回又瞎"。brain 审计在、可见上下文里的连续性记忆名存实亡。

## 真实根因

- 根因1（架构性，最高影响）：没有单一裁剪闸门与有序升级。压缩决策散落在至少四个互不知情的字符级层——per-tool `.slice(context.budget.outputChars)`（adapters.ts/rtk.command.filter.component.ts）、GrepTool 硬编码 `.slice(0,8000)` 绕过 budget（file.tools.ts:222/226）、pre-turn 字符护栏、mid-turn 字符护栏（agent.runtime.service.ts:646/695）。全部基于字符而非真实 provider token，无共享判定、无 cheap→expensive 升级顺序、无熔断。这是所有正确性与遗忘问题的共同温床。
- 根因2（正确性，最先修）：mid-turn 按位置 slice 而非按 tool_call/tool_result 配对单元切，且折叠时丢 assistant.toolCalls。这同时造成 P1 协议 400（破坏原生配对）与 P2 审计断链（合成 sourceMessageId），是两个缺陷的同一个根。
- 根因3（合规，违背 P0 红线）：ContextCompressorComponent 从未接 ModelProvider，摘要被实现为正则字符串处理；ContextCheckpoint 契约（context.types.ts:328-332）只有 summary:string，没有给模型蒸馏留入口（无 confidence/coverage/previousSummary）。
- 根因4（生命体记忆衰减）：checkpoint 被设计成无状态单条快照（schema 4 列 + 读取 limit 1），没有链式/累积 rolling summary，新 checkpoint 不引用不合并旧 checkpoint。多次压缩单调遗忘。
- 根因5（召回端红线违规，放大遗忘）：vec0(float[4]) + 确定性 embed() 在生产 store/recall 路径上。被折叠证据的第二召回通道（memory_recall）因 4 维玩具向量而失效，使 checkpoint 修复也救不回早期语义检索。
- 根因6（无收敛/无保护集合）：固定保留近 2 条与未压缩 system 段，无对超大单条的裁剪、无逐项剥离重试、无'user 原话/计划必须 verbatim 保留'的保护白名单、无失败熔断。

## 推荐重构

## 总体形状：一个闸门 + 有序升级 + 真模型蒸馏（移植 openhuman 单管线 + codex/hermes 蒸馏 + hermes 配对自愈）

引入 **`ContextPipelineService`（@Service，src/context/）** 作为唯一裁剪入口，所有压缩决策经它；新增 **`ContextGuardComponent`（@Component）** 给单一判定。kernel 退回纯编排：`agent.runtime.service.ts` 不再 imperative 调两个字符护栏，而是发 `context.budget.check` 信号 / 或调用 pipeline 的单一 `runBeforeProvider(messages)`，结果经 SignalBus 广播 `context.compacted`。

### 阶段1（最低风险、先做）：集中工具结果预算 + re-run 标记 —— 移植 openhuman tool_result_budget.rs
- 新建 `src/context/tool.result.budget.ts` 的 `applyToolResultBudget(content, budgetBytes)`：UTF-8 安全边界裁剪 + 追加自描述标记 `[… N bytes truncated by tool_result_budget — re-run with a narrower query …]` + 返回 `{originalBytes,finalBytes,truncated}` 供 brain 事件。
- 用它替换 `adapters.ts:146/169/190/221`、`rtk.command.filter.component.ts:58/95`、`file.tools.ts:222/226`、`worker.service.ts:461` 的全部裸 `.slice()`；删除魔数 8000/4000，统一为 `ContextConfig.toolResultBudgetBytes`（config.types.ts/config.service.ts）。直接服务 coding 内核：模型知道被截断且知道如何 re-run 取回。

### 阶段2：ContextGuard + 熔断 —— 移植 openhuman guard.rs
- `ContextGuardComponent.check(usage)`：消费**真实 provider token usage**（model.provider.ts 已能拿 usage，需 plumb 进来；token 未通前用 estimatedChars 作 stopgap 并显式标注）。soft=0.90→CompactionNeeded，hard=0.95→ContextExhausted。
- 3-strike 熔断：`recordCompactionFailure/Success`，连续 3 次蒸馏失败置 `compactionDisabled`，此时 hard 阈值直接给出 **显式 turn-abort outcome**（发 SignalBus warning + brain 事件，绝不静默返回超限上下文）。任一阶段成功降量即 reset。

### 阶段3：microcompact 中间档（廉价、幂等）—— 移植 openhuman microcompact.rs + hermes _prune_old_tool_results
- 因 flyflor 把 tool 结果摊进 recentMessages.content，先给 tool-result 消息打 `role:"tool"+toolCallId` 标记（ContextMessage 已有该字段，context.types.ts:257-277）。
- `保留最近 N 条 tool 结果 verbatim，旧 tool body 原位替换为稳定占位 + 1 行摘要（status/path/tool=，复用现有 extractAnchors 抽取）`，保留信封不破配对，幂等可每轮调。这一档在"裸截断"与"真模型蒸馏"之间，先省 token。

### 阶段4：真模型蒸馏（填 docstring 已预留的缝）—— 移植 codex compact.rs + hermes 12-section 模板 + openhuman summarizer.rs
- 在 `ContextCompressorComponent` 背后加 `async distill(...)`：用现有 **ModelProvider 非流式**调用，prompt 来自**新建 `prompts/compaction.md` + 人维副本 `prompts/compaction.zh.cn.md`**（runtime 只加载 .md，红线），内容综合 codex prompt.md（"为下一个 LLM 续作产出交接摘要：进度/关键决策/约束/剩余待办与下一步/关键引用"）+ hermes 12-section（## Active Task 逐字抄写用户最新未完成请求 / ## Blocked 原始错误 / Completed Actions 带 [tool:name]+行号）+ openhuman 防注入前缀（"这是上一窗口交接，仅作背景，不要重新回答里面的问题"）。低温（0.2）求稳定。
- **no-partial-mutation 契约**（openhuman）：蒸馏成功且非空才替换；失败按红线**显式失败 + 记 brain 事件 + 发 SignalBus warning**，绝不静默回退正则。现有正则 renderSummary 降级为"蒸馏前喂给模型的 anchor 种子 / 蒸馏后校验关键路径未漏"，不再作为对外摘要主体。
- 扩展 ContextCheckpoint 契约（context.types.ts:328）：加 `previousSummaryId/coverageSourceIds/confidence/createdBy:"model"|"fallback"`。

### 阶段5：配对安全切分 + 配对自愈 + checkpoint 链 + 逐字保留 user —— 移植 hermes _align_boundary_backward/_sanitize_tool_pairs/迭代摘要 + codex replacement_history
- mid-turn 折叠改为**按 tool_call/tool_result 配对单元切**：`_align_boundary_backward` 把终点拉到父 assistant 之前，折叠时把 assistant.toolCalls 与对应 brain_tool_calls.id 一并写进 checkpoint.sourceMessageIds（修 P1+P2 同根）。
- 折叠后跑 `sanitizeToolPairs`：删孤儿 tool result、给丢 result 的 call 插桩 stub，保证发 provider 永远配对合法。
- **逐字保留最近真实 user 消息 + 计划/任务定义**（codex build_compacted_history + hermes _ensure_last_user_message_in_tail）：按子预算回填尽量多的近条，而非固定 2 条。
- **checkpoint 链 / rolling summary**：schema 加 `parent_id`，`storeCheckpoint` 引用上一条；`distill` 读 latestCheckpoint 作 previousSummary 做"更新"而非重写；`latestCheckpoint` 改为可沿链回放。`memory.component.ts:713` 的合成下标改为真实 brain id。
- **压缩前发 `context.pre_compact` SignalBus 事件**给 forgetting/scope/crystal 子系统先抽取（hermes on_pre_compress），契合现有横切订阅模型。

### 阶段6（红线修复，与 T7 协同）：替换 4 维玩具 embedding 为真 embedding
- `memory.component.ts:88` vec0 维度改为真模型维度，`:837` embed() 改走配置的真实 embedding provider（与 intent 同源 provider 体系），删除确定性 4 维实现。这是召回端修复，使压缩后被折叠证据能经 memory_recall 真正被语义召回。

## 改完后的数据/控制流
1. 工具执行：output 经 `applyToolResultBudget` 一次性裁到字节预算（带 re-run 标记），原文仍全量入 brain_tool_calls。
2. 每次发 provider 前：kernel 调 `ContextPipelineService.runBeforeProvider` → ContextGuard 用真实 token 给单一判定 → 有序升级：tool-budget → microcompact → 真模型蒸馏，cheap 档降够就停。
3. 蒸馏：读 previousSummary 做 rolling 更新，按配对单元折叠，sanitizeToolPairs 保配对，checkpoint 沿链落库 + sourceMessageIds 指真实 brain id，逐字保留近 user/计划。
4. 失败：熔断计数，3 连败→显式 turn-abort + brain + SignalBus warning。
5. 下一轮重建：ContextBuilder 沿 checkpoint 链注入累积摘要 + 真 embedding 召回补回早期证据。

## 参考映射

- **单一 ContextGuard 判定 + 单一 ContextPipeline 有序升级（cheap→expensive，token 阈值 soft0.90/hard0.95），消灭多层互不知情截断** ← openhuman (context/pipeline.rs:192-253, guard.rs:80-111) → 新建 src/context/context.pipeline.service.ts(@Service) + context.guard.component.ts(@Component)；kernel agent.runtime.service.ts 删除 buildContextWithBudgetGuard/guardMidTurnContextBudget 的独立决策，改为单一 runBeforeProvider 调用
- **工具结果插入时字节预算 + 自描述 re-run 标记 + outcome 遥测（cache-safe 最便宜档）** ← openhuman (context/tool_result_budget.rs:63-108) → 新建 src/context/tool.result.budget.ts；替换 adapters.ts:146/169/190/221、file.tools.ts:222/226、rtk.command.filter.component.ts:58/95、worker.service.ts:461 的裸 slice；统一 ContextConfig.toolResultBudgetBytes
- **microcompact：保留最近 N 条 tool 结果 verbatim，旧 tool body 原位占位替换，保信封不破配对，幂等** ← openhuman (context/microcompact.rs:59-100) + hermes (_prune_old_tool_results, context_compressor.py:640-806) → ContextPipelineService 中间档；先给 ContextMessage tool 结果打 role:'tool'+toolCallId 标记（context.types.ts:257-277 已有字段）
- **真模型蒸馏（非流式 LLM 调用），12-section 结构化模板（Active Task 逐字 / Blocked 原始错误 / Completed Actions 带 tool+行号），防注入前缀，低温 0.2** ← codex (compact.rs:171-263, templates/compact/prompt.md) + hermes (context_compressor.py:914-1085, SUMMARY_PREFIX) + openhuman (summarizer.rs:48-55,148-240) → ContextCompressorComponent 新增 async distill()，调现有 ModelProvider；prompt 落 prompts/compaction.md + prompts/compaction.zh.cn.md；正则 renderSummary 降为种子/校验
- **配对安全切分 _align_boundary_backward + 配对自愈 _sanitize_tool_pairs（删孤儿 result、给丢 result 的 call 插 stub）** ← hermes (context_compressor.py:1239-1297,1299-1351) + openhuman (summarizer.rs snap_split_forward:242-272) → 重写 agent.runtime.service.ts:706-752 mid-turn 折叠为按配对单元切；折叠后跑 sanitizeToolPairs 再发 model.provider.ts:251 normalizeMessages
- **逐字保留最近真实 user 消息 + 计划/任务定义（按子预算回填），蒸馏只换 assistant/tool 中间过程；最新 user 必须锚在尾部** ← codex (build_compacted_history_with_limit:466-530, COMPACT_USER_MESSAGE_MAX_TOKENS) + hermes (_ensure_last_user_message_in_tail:1366) → agent.runtime.service.ts pre-turn 段（替换 :652 固定 slice(0,len-2)）+ context.builder.service.ts:51-55 tail 选择
- **checkpoint 链 / 迭代 rolling summary（新 checkpoint 引用并更新旧 summary，可沿链回放）+ 指针指向真实 brain 审计行** ← hermes (迭代摘要 context_compressor.py:1020-1034,1576) + codex (replacement_history/reference_context_item, history.rs:50-51,187-190) → memory-schema.sql:21 加 parent_id；memory.component.ts:785-816 storeCheckpoint/latestCheckpoint 支持链；agent.runtime.service.ts:713 合成下标改真实 brain_messages/brain_tool_calls id；context.types.ts:328 扩展契约
- **3-strike 压缩熔断 + soft/hard 双阈值 + 显式 turn-abort（不静默返回超限）+ 成功反馈跨档 reset** ← openhuman (guard.rs:113-137,89-111, pipeline.rs:199-204) → ContextGuardComponent；ContextExhausted 接现有 brain context.* 事件 + SignalBus warning
- **压缩前通知记忆/遗忘子系统先抽取（on_pre_compress）** ← hermes (conversation_compression.py:309) → 压缩前发 SignalBus 事件 context.pre_compact，由现有 forgetting/scope/crystal @Subscribe 订阅，不让 kernel imperative 调用
- **手动 /compress + focusTopic 引导 + noop/前后 token 对比反馈 + 失败可见（aux 坏了仍告知）** ← hermes (manual_compression_feedback.py:8-49, context_compressor.py:1048-1054) → 经 SignalBus/socket chat 面暴露手动压缩；summarize 反馈纯函数附在 context.compacted 事件；失败按红线显式 audited
- **真 embedding 替换 4 维玩具向量（与 T7 协同，修复压缩后召回通道）** ← codex/hermes/openhuman 均用真 provider（无玩具 embedding） → memory.component.ts:88 vec0(float[4])→真维度；:837 embed() 走真实 embedding provider；删确定性实现

## 红线核对

逐条对照：

- **无 session（每轮从本地状态重建）**：满足。蒸馏只改"喂给模型的可见上下文"，每轮仍由 ContextBuilderService 从 memory.db 重建；checkpoint 链与真 embedding 召回都是本地持久状态。模型供应商不作连续性来源。

- **双北极星**：满足且强化。阶段1（工具预算 re-run 标记）+ 阶段5（配对自愈不再 400）直接让 coding 内核工具回路真正能干活；阶段4/5（真蒸馏 + checkpoint 链 + 真 embedding 召回）让生命体记忆不再单调遗忘。

- **brain.db 不可删 / collapse 前原文先入 brain**：严格遵守。压缩只 rewrite model-facing context 与 memory.db checkpoint，绝不触 brain。原文在 registry.execute 阶段已 upsertToolCall/recordMessage 入 brain（审计存在性已满足）；本方案进一步把 checkpoint.sourceMessageIds 改为指向真实 brain 行，使"压缩点→原文"可回放——是加强而非削弱。

- **memory.db = 热记忆**：满足。checkpoint 链、rolling summary、向量召回都落 memory.db，可由 brain 重建（符合 docs 的 critical rebuild）。

- **kernel 纯编排 / 横切经 SignalBus @Subscribe 自持状态**：满足且改善。当前 kernel imperative 调 buildContextWithBudgetGuard/guardMidTurnContextBudget 违反此红线；本方案把压缩决策移入 ContextPipelineService，kernel 只发 context.budget.check / 调单一 runBeforeProvider；压缩前 context.pre_compact 经 SignalBus 给 forgetting/scope/crystal 订阅，不 imperative 调它们。

- **SignalBus = 血管层；guard.* ask 必须有 responder（ASK>Confirm）**：不冲突。本子系统不引入新的 mutating/spawn；压缩失败/熔断/反馈均经 SignalBus 广播，不绕过侦查者。

- **WS 只对接 guard/db/chat，其余 SignalBus 广播订阅显示**：满足。手动 /compress 经 chat 面，压缩进度/反馈作为 context.compacted 广播被订阅显示，不新增 WS 直连面。

- **禁止 mock/deterministic 模型供应商；禁止静默 fallback**：满足且为修复重点。蒸馏走配置的真实 ModelProvider；蒸馏失败显式失败 + brain 事件 + SignalBus warning，绝不静默回退正则或丢中段（明确不照搬 hermes 的静态占位回退）。正则只作"蒸馏前种子/蒸馏后校验"，不再是对外摘要主体。

- **禁止 4 维玩具 embedding，必须真 embedding**：本方案阶段6 直接修复当前 memory.component.ts:88/837 的 vec0(float[4]) + 确定性 embed() 违规，换真 embedding provider。

- **提示词双副本，runtime 只加载 .md，不内嵌 TS**：满足。新增 prompts/compaction.md + prompts/compaction.zh.cn.md，经 TemplateLoaderComponent 加载，蒸馏 prompt 不内嵌 TS（现状正则在 TS 内是缺陷，本方案外移）。

## 轨道映射

主要落 **T6（摘要）**，并强制依赖/协同 **T7（知识树/真 embedding）**，正确性子项与 **T3（工具调用硬化）** 交叉。

与 master-plan（docs/refactor-master-plan.md:46-47,57）对照：
- master-plan T6 已写"ContextCompactionService 模型蒸馏、checkpoint 链、collapse 前先入 brain"——本方案与之一致，但**补强三处计划未显式拆出的关键点**：(a) mid-turn 按配对单元切 + sanitizeToolPairs 是 P1 协议正确性硬伤，应作为 T6 第一优先（甚至前置到 T3，因它直接 400 让工具回路崩）；(b) 单一 ContextPipeline + ContextGuard 熔断（openhuman 单闸门）是计划未提的架构骨架，建议作为 T6 的承载结构；(c) 工具结果字节预算 + re-run 标记（统一 8000/4000 魔数）属 T3 工具硬化范畴，应在 T6 之前先做（最低风险、消除二次截断）。
- master-plan 已在缺陷清单（:27-28）记录"正则截断/checkpoint 单条丢历史/4 维玩具 embedding"——本审计**新增并核实**：4 维 embedding 不只在测试、而在生产 store/recall 路径（memory.component.ts:189），它是压缩后召回通道失效的放大器，应把 T7"真 embedding"标为 T6 完整生效的硬前置依赖，而非并行轨。
- **差异提醒**：master-plan:27 称"压缩删 chunk 不保证 brain 留原文（违反不可删审计）"——本审计核实该描述**部分有误**：registry.execute 已在执行阶段把全量 output 入 brain_tool_calls、user/assistant 入 brain_messages，审计存在性满足。真正缺陷在 checkpoint 合成指针使"原文可回放"不可用，以及模型可见上下文层早期证据丢失。T6 验收标准应据此修正为"checkpoint 指针可回放到真实 brain 行"，而非"原文是否入 brain"。

## 复核结论

- 总体置信: high
  - [confirmed] 压缩管线 100% 确定性正则，零模型调用零 await：renderSummary slice(0,360)+extractAnchors ≤24 锚点，compact()/compactContextMessages() 同步 (src/context/context.compressor.component.ts:70-105)
    整文件已读 (1-121)。compact (:20)、compactContextMessages (:44)、renderSummary (:70)、extractAnchors (:91) 全部为同步方法，无 async/await、无 ModelProvider 注入。:78 `entry.content.replace(/\s+/g,' ').slice(0,360)` 确为每条消息截 360 字。:104 `[...new Set(anchors)].slice(0,24)` 确为 ≤24 锚点。:8 docstring 自承 'model distillation can replace internals behind the same contract'。组件无任何 @Inject 的 provider，纯正则 matchAll (:92-103)。断言准确。
  - [confirmed] mid-turn 护栏在工具 for 循环体内(:321)被调用，按位置折叠丢弃 assistant.toolCalls，normalizeMessages 仍对 tail 的 {role:tool,toolCallId} 发原生 tool_call_id → 孤儿 tool → provider 400 (src/kernel/agent.runtime.service.ts:310-321,695-753 + src/kernel/model.provider.ts:251-277)
    结论确实存在，但机制描述有一处需修正。guardMidTurnContextBudget 确在 for 循环体内 :321 每个 tool 追加后被调用。其折叠用 tail=messages.slice(-tailCount)（tailCount=2,见 :707-708），compactedMessages=messages.slice(1,-tailCount) (:709)，返回 [first, compactedContext(role:system), ...tail] (:752)。compactContextMessages (:50-54) 只映射 role+content，从不读 message.toolCalls，故被折叠的 assistant.tool_calls 永久丢弃——这部分准确。normalizeMessages (model.provider.ts:267-268) 仍把任何 {role:tool,toolCallId} 发为原生 {role:'tool',tool_call_id}，确认。
机制修正：claim 暗示单 tool 也会孤儿（'slice(1,-2)折叠 + tail 单 tool'）。实测（/tmp/trace3）单 tool 调用时 tail=slice(-2)=[assistant(含tool_calls), tool]，配对被保留在 tail 内，不产生孤儿。真正复现 400 的是【一个 step 内 ≥2 个 tool_calls】+ 上下文溢出：第二个 tool 追加后护栏触发，布局变成 [system, system-checkpoint, tool(T1), tool(T2)]，两条 tool 前面无携带匹配 tool_calls 的 assistant → normalizeMessages 发出两条孤儿 native tool 消息 → provider 400（实测 /tmp/trace4 orphans:[T1,T2]）。即缺陷真实存在且会触发 400，但触发条件是多 tool_call/step 而非任意 mid-turn 折叠，slice 常量本身不是直接因。
  - [confirmed] checkpoint 单条快照无链：schema 仅 4 列(无 parent_id)，latestCheckpoint limit 1，builder 只注入最新一条；多次压缩后早期被折叠消息永久消失 (sql/memory-schema.sql:21-26 + src/memory/memory.component.ts:809-816 + src/context/context.builder.service.ts:49-54)
    memory-schema.sql:21-26 context_checkpoints 确仅 4 列 (id, conversation_id, summary, created_at)，无 parent_id。grep 全仓 'parent_id|parentId|previousCheckpoint' 在 src/ 与 sql/ 零命中，确认无链。latestCheckpoint (:809-816) `order by created_at desc limit 1`——只取最新一条。builder.service.ts:49 `latestCheckpoint(...)` 单条注入，:50-54 用其 sourceMessageIds 把对应消息从 recentMessages 过滤掉。storeCheckpoint (:785-799) 每次新 randomUUID 插入，旧 checkpoint 不被其后的 checkpoint 引用。故第二次压缩生成的新 checkpoint summary 不含第一次 checkpoint 的内容，而第一次折叠掉的消息已被 sourceMessageIds 排除在 recentMessages 之外——早期被折叠内容在模型可见上下文确实永久消失。断言准确。
  - [confirmed] mid-turn checkpoint.sourceMessageIds 是合成位置下标 `${turnId}:model-context:${index}`，不指向真实 brain_messages/brain_tool_calls 行，回溯断链 (src/kernel/agent.runtime.service.ts:713 + src/context/context.compressor.component.ts:50-54)
    agent.runtime.service.ts:713 `const sourceMessageIds = compactedMessages.map((_, index) => `${turnId}:model-context:${index}`)`——确为合成位置下标，按数组 index 生成，与任何持久化行 id 无关。这些 id 随后存入 checkpoint (storeCheckpoint→context_checkpoints.summary JSON, memory.component.ts:796) 并在 :739/:750 事件中上报。brain_messages 的真实 id 形如 `${turnId}:user`/`${turnId}:assistant` (见 runTurn :156,:330)，brain_tool_calls 行也不用此格式，故 model-context:index 不指向任何真实行，回溯断链成立。compactContextMessages (:53) 对缺失 id 还回退 `context:${index}`，进一步证实其纯合成性质。断言准确。
  - [confirmed] 召回端用 4 维玩具 embedding 且接入生产 store/recall 路径：vec0(float[4]) 表 + store() 调 embed() + embed() charCode 摊 4 桶——违反禁止4维玩具embedding红线并放大遗忘 (src/memory/memory.component.ts:88,179-203,837-845)
    embed() (:837-845) 确为 charCode 摊 4 桶确定性实现：vector=[0,0,0,0]，bucket=index%4，charCodeAt/255 累加后 hypot 归一，返回 4 维向量。initialize() (:88) `create virtual table ... using vec0(embedding float[4])`——4 维 vec0 表。store() (:179-203) 是生产入口（runtime storeDurableFacts:788 与 MemoryStoreTool 都走它），:189 `this.embed(input.content)`，:190-192 当 vectorEnabled 时写入 memory_vectors。关键：config.service.ts:245 `enableSqliteVec: memory.enableSqliteVec ?? true`——默认开启，故 4 维 embedding 在生产路径生效而非仅测试。recall→treeRecall→chunkRecallCandidates 走同一索引。:835 docstring 自承 'suitable for local smoke tests'，与生产使用矛盾。断言准确，确为红线违规。
- 修正: claim #2 (孤儿 tool → 400) 结论成立但机制需精确化：不是任意 mid-turn 折叠都产生孤儿。单 tool_call/step 时 tail=slice(-2) 恰好把携带 native tool_calls 的 assistant 与其 tool 结果一起留在 tail，配对被保留，不会 400（实测验证）。真正稳定触发 provider 400 的是【同一 step 内模型请求 ≥2 个 tool_calls】+ 上下文溢出触发护栏：第二个 tool 结果追加后折叠，assistant(含tool_calls) 被挤出 tail 折成 summary，而 ≥2 条 {role:tool,toolCallId} 留在 tail 失去配对 assistant，normalizeMessages 仍发原生 tool_call_id → 孤儿 → 400。根因是 compactContextMessages 丢弃 toolCalls + 折叠不保 assistant/tool 配对完整性，而非 slice(1,-2) 常量本身。综合报告引用此条时应改述触发条件为'多工具并发调用 + 溢出'，而非'任意 mid-turn 折叠'。
- 修正: claim #2 行号微调：mid-turn 护栏主体应引 695-753（guardMidTurnContextBudget 全函数），:706-752 为其内部；调用点在 for 循环 :321。其余四条行号与描述均与 HEAD 源码一致，无需修正。

## 开放问题

- Token 计量来源：ContextGuard 的 soft/hard 阈值要 plumb 真实 provider usage（model.provider.ts 的 usage 字段）还是先用 estimatedChars 作 stopgap？后者更快但不精确，需 owner 拍板是否阻塞 T6 上线。
- 蒸馏模型选择：用主 ModelProvider 还是配一个更便宜的 summary model（codex/openhuman/hermes 均支持 aux 模型）？涉及 ConfigService 是否新增 compaction model 配置，以及成本/质量取舍。
- 真 embedding provider 落地：是否在 T6 内一并替换 4 维玩具 embedding，还是严格依赖 T7 先完成？若 T6 先上而召回仍瞎，checkpoint 链的收益会被打折——需确认 T6/T7 排序。
- checkpoint 链的 rolling summary 上限：累积 summary 本身也会增长，需要二级压缩（压缩 summary 的 summary）吗？阈值与衰减策略由谁定。
- 手动 /compress + focusTopic 是否纳入本轮范围：它经 chat 面暴露契合 SignalBus 可观测，但属增量人因功能，可能延后；需 owner 确认优先级。
- 蒸馏失败的 turn-abort 行为对 coding 内核体验影响：硬 abort 还是降级到'只发未压缩 system+最近 user+配对自愈后的 tail'并显式告警？红线要求显式不静默，但具体降级形态需拍板。