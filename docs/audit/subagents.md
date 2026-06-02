# subagents 诊断与重构方案

## 诊断

## 子系统现状：前台一条腿能走，但生命周期、取消、安全边界三处骨折

我已逐条对照 HEAD 源码验证，确认审计结论属实，并修正了 ISSUES.md 的过时描述。**先肯定已修的**：spawn_agent 是普通模型工具（spawn.agent.tool.ts:30），前台路径 await `waitForSettled` 后把 `<worker>summary</worker>` 作为返回值（spawn.agent.tool.ts:67-81），kernel 在同一父 turn 内把它渲染成原生 `role:"tool"`+`toolCallId` 消息回喂模型（agent.runtime.service.ts:310-320, renderSingleToolResult:1197）。worker 内循环也用原生 tool 协议（worker.service.ts:234-258）并把真实 JSON-schema 透传上线（streamWorkerStep:398-408）。所以 memory 里"压平协议/schema 丢弃"两项**确属已修**，前台同轮回注**确实成立**。

但内核要"真正能干活"、记忆要"环绕内核而非吞掉结果"，下面四组缺陷共同让两个北极星都达不到：

### 1. 生命周期不闭环（破坏"无 session 生命体"的状态诚实性）
`runWorker` 有**三个互不协调的终态发射点**：成功体 (worker.service.ts:284-290)、catch (300-304)、setTimeout 回调 (200-207)。setTimeout 只置 `timeoutFired=true` 并发 `worker.failed/settled(failed)`，**不中断仍在 await 的循环**。循环最终正常返回时又发 `worker.completed/settled(completed)/result.injected`（284-297）。于是一个 worker 发出两套矛盾终态，且 `memoryComponent.store`（263-268）与 `brainComponent.recordEvent` 各跑两次——**热记忆里被写入两条相互矛盾的 worker 事实**，brain 审计流里出现"先 failed 后 completed"的不一致。前台 `waitForSettled` 在首个 settled 即 unsubscribe（spawn.agent.tool.ts:90），只是把这个 bug 对调用方**遮住**而非修掉，socket/brain 下游仍收双发。

### 2. 并发槽确定性泄漏 → maxConcurrent 次超时后整个子系统死锁
`finally` 在超时分支 `if (timeoutFired) return;`（worker.service.ts:309-311）**在 `activeWorkers -= 1`/`running.delete`/`drainQueue`（312-320）之前就 return**。`completeWorkerWithError`（482-501）又从不碰这三者。结果：每个超时 worker 永久占一个 slot 且永远留在 `running`，队列再不 drain。默认 `maxConcurrent=4`、`timeoutSeconds=300`（config 真实生效路径），**4 次超时后 handleSpawn 永远入队、永不执行**——这是会真实让 coding 内核"看起来卡死"的致命路径。这与 1 是同一根因：终态发射、槽释放、循环停止三件事没有收敛到一个幂等出口。

### 3. 无任何取消令牌（破坏"内核能干活"的可控性）
全链路无 AbortController：`ModelRequest`（model.provider.ts:9-15）无 signal 字段，`stream` 只有内部 `AbortSignal.timeout`（:108），`ToolContext` 不带 signal。`WorkerService.cancel`（141-156）只改账本不停循环——**假取消**：被"取消"的 worker 继续跑、继续以 `guardPolicy:"auto"`（460）执行 mutating 工具、最后照发 completed。父 turn loop（agent.runtime.service.ts:287-328）也无 abort，用户中断停不下在跑的 worker。一个父已超时/已取消的子代理还在改文件，这是副作用泄漏。

### 4. spawn 绕过侦查者 + 背景结果回不到本轮（破坏 guard 红线 + 委派闭环）
- **guard.spawn 是死信号**：SpawnAgentTool 发 `ask("guard.spawn")`（40），但全仓**无任何 `@Subscribe("guard.spawn")`**（grep 确认），SandboxGuard 只订 `guard.ask`（sandbox.guard.service.ts:84）。SignalModule 用默认构造（autoApproveGuards=true）DI 注入 SignalBus，故走 ask 的"无 responder"分支（signal.bus.service.ts:108-123）直接 `return autoApproveGuards`=true。一个 riskLevel='medium'、能 spawn 出会改文件的自治子代理的动作，**只留一条 guard.unattended 审计就被放行，从不经 inspect()/风险分级/ASK 升格**；strict 模式下则变成硬拒（return false）而非升格——两种模式都到不了"分级或 ASK"的预期路径。注意 SignalBus 的 autoApprove 取构造默认值，而 SandboxGuard 取 config（:76-77），二者来源不一致，是隐患。
- **背景委派发射后不管**：`worker.result.injected`（worker.service.ts:292-297）**唯一订阅者是 socket.server.service.ts:215 的 UI 转发**，AgentRuntimeService 零 @Subscribe。background spawn（spawn.agent.tool.ts:59-65）返回 `state="running"` 占位即结束父工具调用，真实结论只落 memory（263-268）供**未来轮** recall——本轮父模型永远看不到背景子代理的产出。

### 5. 次级缺陷（侵蚀可观测性/信任）
- per-profile `model`/`provider` 是死配置：`AgentProfileConfig.model/provider`（config.types.ts:323-324）有声明，但 streamWorkerStep 硬编 `getActiveModelName()`（399）+ 共享父 provider，profile.model 全仓无读取。运营者以为给 explore 配了便宜模型，实际全走父模型——静默忽略文档配置。
- `worker.step` 在 worker.types.ts:29 声明、被 socket 转发列表（socket.server.service.ts）包含，但 **WorkerService 从不 emit**——worker 内循环对外完全黑盒。
- 超时 worker 记录被 `completeWorkerWithError` 写成 `profileName:'unknown', status:'failed'`（495-500），叠加 finally 早退后该记录永不清理，诊断里"已失败"与"仍占槽"同时成立。
- 残留死代码 `createModelProvider()`（536-538）与双头构造器（50-76），是 modelProvider 就地打补丁而非重构的痕迹。

### 为什么这些错共同让双北极星都达不到
- **coding 内核干不了活**：取消缺失 + 槽泄漏死锁意味着委派一旦超时就拖垮整个 worker 子系统，且被取消的子代理还在 mutating；背景委派结果回不到本轮，父无法在同一推理回路里基于子结果继续——委派对 coding 主线实际不可用。
- **生命体记忆没"环绕"而是被污染**：双发终态让 memory.db 写入矛盾的 worker 事实、brain.db 审计流自相矛盾；背景结果只进 memory 不回本轮，记忆从"环绕内核的增益"退化成"唯一但滞后的出口"。
- **guard 血管层被短路**：spawn 这一privilege-escalating 动作走死信号被橡皮图章放行，侦查者形同虚设。

## 真实根因

- 根因A（最高影响，统摄缺陷1+2+5超时记录）：终态发射、并发槽释放、循环停止三件事没有收敛到唯一幂等出口。当前有成功体/catch/setTimeout 三个发射点，finally 的 `if(timeoutFired) return`（worker.service.ts:309-311）又把槽释放跳过。一个 bug 同时造成双发终态、记忆/审计双写矛盾、确定性槽泄漏死锁、记录与槽状态不一致。这是 openhuman『单 Result 出口→单终态事件』与 codex『RAII SpawnReservation』要解决的同一问题。
- 根因B（结构性，统摄缺陷3）：整条 worker/kernel 链路无 AbortSignal——ModelRequest 无 signal、ToolContext 无 signal、cancel() 是假取消。超时和 cancel 都只能『发信号/改账本』而无法中断在飞的模型流与工具循环，因此既停不下子代理的副作用，也无法实现父子级联取消。这是 codex CancellationToken 子树 / openhuman InterruptFence / hermes 协作式 interrupt 共同的缺口。
- 根因C（安全红线，缺陷4前半）：spawn 审批被路由到一个无人订阅的 guard.spawn 命名空间，落入 SignalBus『无 responder→autoApprove』兜底（signal.bus.service.ts:108-123），从未经 SandboxGuard 风险分级/ASK 升格。privilege escalation 被静默放行。对标 opencode 的『父权限下沉+默认收紧』与 flyflor 自身既有的 guard.ask 链。
- 根因D（委派闭环断裂，缺陷4后半）：worker.result.injected 名为『注入』实则只接到 UI 转发，无 kernel 消费者。background 委派结果回不到发起轮，只能靠未来轮 recall。对标 opencode inject()/codex inject_without_turn/hermes summary 回灌。
- 根因E（信任/可观测性，缺陷5）：per-profile model/provider 死配置、worker.step 从不 emit——文档与配置承诺的能力静默缺失，运营者据此做出的隔离/成本/观测假设全部落空。

## 推荐重构

## 总原则
不改对外 SignalBus 信号名（worker.queued/started/step/completed/failed/settled/result.injected）与 maxConcurrent 语义；只整顿内部所有权与控制流。kernel 仍纯编排，所有横切经 SignalBus + @Subscribe 接入。

## R1 —【根因A】单一幂等 settle() 出口 + RAII 槽守卫（移植 openhuman『单 Result→单终态』+ codex SpawnReservation）
文件：`src/worker/worker.service.ts`
1. 新增 `private readonly settled = new Set<string>()` 与一个 `private acquireSlot(workerId): () => void` 守卫：acquire 时 `activeWorkers+=1`、`running.add`、写 running 记录；返回的 release 闭包**幂等**地 `running.delete` + `activeWorkers=max(0,-1)` + `drainQueue()`。
2. 新增 `private settle(workerId, profileName, payload: {status:'completed'|'failed'|'cancelled', summary?, error?, ...})`：开头 `if(this.settled.has(workerId)) return;` 一次性闩锁；内部按 status 发 `worker.completed` XOR `worker.failed`，再发 `worker.settled`，再发 `worker.result.injected`（仅 completed），并写**一次** memory.store / brain.recordEvent，最后调 release()。
3. `runWorker` 改写：`const release = this.acquireSlot(...)`; `try { ...loop...; this.settle(id, profile, {status:'completed', summary}) } catch(e){ this.settle(id, profile, {status:'failed', error}) } finally { clearTimeout }`。**删除 `if(timeoutFired) return`**。`completeWorkerWithError` 退化为薄包装只调 settle()，不再自行 records.set/发事件，从而带上真实 profileName（修复 'unknown' 记录）。
4. 超时不再直接发终态：见 R2。
数据流：无论成功/异常/超时/取消，唯一经 settle()→唯一终态事件 + 唯一 memory/brain 写 + 唯一槽释放。死锁与双写根除。

## R2 —【根因B】AbortSignal 贯穿 worker 与 kernel（移植 codex 协作取消有序流水线 + openhuman 边界自查 + hermes 协作式中断）
文件：`src/kernel/model.provider.ts`、`src/tools/tool.types.ts`、`src/worker/worker.service.ts`、`src/kernel/agent.runtime.service.ts`
1. `ModelRequest` 增 `readonly signal?: AbortSignal`；`OpenAICompatibleModelProvider.stream` 的 fetch 把外部 signal 与内部 timeout 用 `AbortSignal.any([request.signal, AbortSignal.timeout(...)])` 合并（保留 timeout 兜底）。
2. `ToolContext` 增 `readonly signal?: AbortSignal`；executeWorkerTool/executeModelToolCall 透传给工具。
3. 每个 worker 持一个 `AbortController` 挂在 WorkerRecord 上。runWorker 的 for 循环每步开头 `if(controller.signal.aborted) { this.settle(id, profile, {status:'cancelled'}); break; }`，并把 signal 传入 streamWorkerStep。
4. setTimeout 回调改为 `controller.abort()`（不再直接发终态）——超时变成"触发 abort→循环下个边界观察到→走 settle(cancelled/failed)"，与 cancel() 同一路径。`cancel(workerId)` 改为 `record.controller.abort()`（真取消）。
5. 父 turn loop（agent.runtime.service.ts:287）引入 turn 级 AbortController，贯穿 streamModelStep/executeModelToolCall；用户中断时 abort。
数据流：超时/cancel/用户中断三者统一→abort→边界自查→单 settle()。

## R3 —【根因C】spawn 走真实侦查者链 + 父权限下沉（移植 opencode deriveSubagentSessionPermission，复用 flyflor 既有 guard.ask）
文件：`src/tools/spawn.agent.tool.ts`、`src/sandbox/sandbox.guard.service.ts`、`src/worker/worker.service.ts`
1. SpawnAgentTool 把 `ask("guard.spawn", ...)` 改为复用既有 `ask("guard.ask", {toolName:'spawn_agent', riskLevel:'medium', ...})`，使其经 SandboxGuard.handleGuardAsk 真正 inspect/分级；medium 命中 escalate→ASK 升格（>Confirm），有 WS responder 时阻断等待。**或**保留 guard.spawn 名但在 SandboxGuard 新增 `@Subscribe("guard.spawn")` 委托 inspect()。推荐前者（少一条死命名空间）。
2. 父权限下沉：spawn 时把父 `context.guardPolicy` 作为 worker 的下限传入 WorkerSpawnPayload；buildWorkerContext 据此设 toolContext.guardPolicy——父若 manual/只读，子不得降级为 auto（替换 worker.service.ts:460 硬编 'auto'）。
3. 默认从 worker profile 工具集中剔除 spawn_agent（防递归 fork 炸弹），除非 profile 显式声明。
4. 统一 SignalBus.autoApproveGuards 来源：SignalModule 用 factory 从 config.runtime.autoApproveGuards 构造，消除与 SandboxGuard 的双源分歧。

## R4 —【根因D】背景结果结构化回注本轮（移植 codex ContextualUserFragment + inject_without_turn / opencode inject）
文件：`src/kernel/agent.runtime.service.ts`（新增唯一一处 @Subscribe）、`src/worker/worker.types.ts`
1. 定义结构化片段 `<subagent_notification workerId profile status>summary</subagent_notification>` 统一前台/背景格式。
2. AgentRuntimeService 新增 `@Subscribe("worker.result.injected")`：把片段作为 synthetic user 消息（标 synthetic 避免污染真实对话）`appendMessage` 入父 conversation 历史**而不强行起新 turn**（trigger_turn=false 语义），父空闲下一轮自然消费。这是 kernel 唯一允许的订阅式接入，仍是编排而非 imperative 调 worker。
3. 回注前对 summary 做 UTF-8 边界 char-cap（移植 openhuman max_result_chars）+ '[...truncated]'，防背景子代理胀爆父上下文。settle() 幂等保证回注恰好一次。

## R5 —【根因E】兑现配置/可观测承诺
文件：`src/worker/worker.service.ts`
1. streamWorkerStep 读 `profile.model ?? getActiveModelName()`；若 profile.provider 指定，按名解析对应 provider 实例（而非共享父）。
2. worker 内循环每步 emit `worker.step`（workerId, step, toolName）兑现 socket 已声明的转发。

## 改完后的统一控制流
spawn_agent → guard.ask 真分级/ASK → worker.spawn → acquireSlot → 持 AbortController 的循环（每步查 abort + emit worker.step）→ 唯一 settle()（成功/失败/取消/超时统一）→ 单终态事件 + 单 memory/brain 写 + 单 result.injected → 前台作为 tool result 回本轮；背景经 kernel @Subscribe 以 synthetic 片段入父历史。这同时让 coding 内核委派可控可用、记忆诚实环绕内核。

## 参考映射

- **run_subagent 是纯函数恰好两个出口，caller 把单 Result 映射为恰好一个 SubagentCompleted XOR SubagentFailed——终态唯一性是类型系统性质** ← openhuman → R1：WorkerService 新增幂等 settle()（Set<workerId> 闩锁），成功体/catch/超时/取消全部路由经它；runWorker 改为返回判别式结果思路，消除三发射点
- **RAII SpawnReservation（commit/Drop）+ 原子计数，任何 early-return/panic 路径都由 Drop 归还槽，释放点唯一** ← codex → R1：acquireSlot() 返回幂等 release 闭包，finally 无条件 release，删除 if(timeoutFired) return；completeWorkerWithError 不再负责释放
- **CancellationToken 父子树 + child_token 级联取消 + handle_task_abort『信号→优雅等待→硬abort→标记→事件』有序流水线，全程 100ms/500ms 兜底无无限等待** ← codex → R2：ModelRequest/ToolContext 增 AbortSignal，每 worker 持 AbortController，setTimeout 改为 abort()，cancel() 真中断；父 turn loop 引入 turn 级 controller
- **InterruptFence 共享原子 flag 在 loop/tool/spawn 边界自查，转 Err 折叠进同一单出口；StopHook 同理** ← openhuman → R2：runWorker 每步开头 if(signal.aborted) → settle(cancelled) → break，与正常完成共用 settle 出口
- **协作式线程作用域 interrupt（不硬杀）+ 超时诊断 dump + budget 耗尽剥工具做一次 to-less 总结调用形成收敛闭环** ← hermes → R2：worker 边界协作式自查；超时时用 artifactWriter/Brain 落诊断 artifact（profile/工具数/已用 step/最后事件）保审计
- **ContextualUserFragment（<subagent_notification>{path,status}）+ inject_user_message_without_turn / trigger_turn=false 把『有结果可读』与『立刻起turn』解耦** ← codex → R4：定义 <subagent_notification> 结构化片段，AgentRuntimeService @Subscribe('worker.result.injected') 以 synthetic user 消息入父历史不起新 turn
- **task 工具 inject() 完成后以父 sessionID 发回灌驱动父续跑；前台/背景共用同一 runTask 仅在等不等上分叉** ← opencode → R4：背景 worker 完成经 kernel 订阅统一回注；前台/背景共用同一 settle()/回注片段格式
- **子 summary 经 max_result_chars 在 UTF-8 边界截断后才返回父，父上下文增长有界** ← openhuman → R4：回注前对 summary char-cap + [...truncated] 标记
- **deriveSubagentSessionPermission 把父 deny（含 Plan Mode 只读）下沉子会话 + 默认禁 todowrite/task 防递归 spawn；tools 级双层兜底** ← opencode → R3：spawn 时父 guardPolicy 作为 worker 下限下沉（替换硬编 'auto'）；默认从 worker profile 剔除 spawn_agent
- **delegate 子 summary 标注为 SELF-REPORTS 需复核 + 跨 agent 文件 staleness re-read 提醒 + 子成本上卷父 turn** ← hermes → R4 增强（可选）：spawn_agent 描述加『worker summary 为自述、外部副作用需返回可验证 handle 由父复核』；后续接 BrainComponent 文件读注册表做 re-read 提醒
- **额度耗尽 → CrystalService 结晶（tool.loop.exhausted 当前无人订阅）** ← hermes → 超出本子系统但相邻：T6 时给 CrystalService 加 @Subscribe('tool.loop.exhausted')，本报告仅标注为 openQuestion 不纳入 worker 重构

## 红线核对

- 无 session：方案不引入任何模型侧连续性；worker 仍每轮从 profile + 本地状态重建 context（buildWorkerContext）。背景回注用 synthetic 本地消息，非供应商记忆。✓
- 双北极星：R2/R3 让 read/grep/edit 等真实工具在 worker 内可控执行（真取消、不绕过 guard），coding 内核能干活；R1/R4 让 worker 结果以单一诚实终态环绕进 memory/brain 并回注本轮，记忆机制环绕内核。✓
- brain 不可删：所有改动只『减少重复写入』（settle 幂等使 recordEvent 恰好一次），从不删 brain；超时诊断为新增 writeTextArtifact，collapse 前原文照旧先入 brain（本子系统不触碰 collapse）。✓
- memory.db 热记忆：worker.store 仍写当前热记忆，且修复双写后不再有矛盾事实。✓
- kernel 纯编排：唯一新增 R4 的 `@Subscribe('worker.result.injected')` 是订阅式接入，kernel 不 imperative 调 WorkerService；spawn 仍由 WorkerService 拥有执行，kernel 只收事件回注。横切（worker/guard）全经 SignalBus。✓
- SignalBus 血管层 + guard.* 必有 responder + ASK>Confirm：R3 把 spawn 接入有 responder 的 guard.ask（或为 guard.spawn 补 responder），medium 风险走 escalate→ASK 升格，侦查者真正阻断 mutating/spawn。✓
- WS 只三面：不新增 WS 命令面；worker.step/result.injected 仍只作为 SignalBus 广播被 WS 订阅显示（socket.server.service.ts），WS 不命令 worker。✓
- 禁 mock/fake 供应商、禁玩具 embedding：方案不引入任何 mock provider；R5 的 profile.provider 解析仍指向真实 OpenAICompatible provider；不触碰 embedding。✓
- 禁静默 fallback：超时/取消/失败全部走显式 settle 事件 + brain 审计 + 诊断 artifact，可观测；profile.model 不再静默忽略；guard.spawn 不再静默 autoApprove（改为分级/ASK）。✓
- 提示词双副本：本子系统不新增运行时提示词；worker systemPrompt 仍经 promptRegistry.loadAndResolve 加载 .md（worker.service.ts:339），若新增任何 name.md 须配 name.zh.cn.md。✓

## 轨道映射

主体落在 **T5（子代理）**，与 master-plan 第45行『SpawnAgentTool 前台阻塞、WorkerRun+settle()、abort、结果回注、guard.spawn』完全对齐——本报告把这五项具体化：R1=WorkerRun+settle()（master-plan 已点名 settle()，本报告给出幂等闩锁+RAII 槽守卫的精确实现，补强了『槽泄漏死锁』这一 master-plan 第26行已提及但未给修法的点）；R2=abort（master-plan 仅列 abort，本报告补全 ModelRequest/ToolContext signal 贯穿 + setTimeout 改 abort + 父 turn 级 controller，并指出与 codex 有序流水线的差异：当前完全无取消令牌）；R3=guard.spawn（master-plan 列出但未指出它是死信号，本报告补强：必须接 responder/改走 guard.ask 才满足第57行『侦查者对 mutating/spawn 真正升格 ASK』）；R4=结果回注（对齐第57行『子代理前台结果回注本轮』，并补强 background 路径的 kernel @Subscribe 回注，master-plan 第26行已点名『发射后不管』）。

依赖：R2 的原生 tool 协议往返已由 **T2** 提供（ContextMessage.toolCalls/toolCallId 已就绪，master-plan 第33行），故 T5 可直接复用。

与现有计划的差异/补强：(1) master-plan 未显式列『per-profile model/provider 死配置』『worker.step 从不 emit』两项 P2/P3，本报告 R5 补入 T5；(2) 父权限下沉（opencode deriveSubagentSessionPermission）是 master-plan 未提及的安全增强，建议并入 T5 的 guard.spawn 工作项；(3) hermes 的 tool.loop.exhausted→CrystalService 结晶相邻但属 **T6（摘要）/结晶**，本报告仅标注，不纳入 T5。

## 复核结论

- 总体置信: high
  - [confirmed] 超时 worker 的 finally 在 if(timeoutFired) return 于槽释放前 return，completeWorkerWithError 从不碰 activeWorkers/running/drainQueue，故每个超时 worker 永久泄漏一个槽，maxConcurrent(默认4) 次超时后 handleSpawn 永远入队不执行（死锁）。 (src/worker/worker.service.ts:309-321, 482-501)
    finally 块 305-321：clearTimeout 后 309-311 为 `if (timeoutFired) { return; }`，直接 return，跳过 312 `this.running.delete`、313 `this.activeWorkers = Math.max(0, this.activeWorkers - 1)`、320 `this.drainQueue()`。completeWorkerWithError(482-501) 只调用 brainComponent.recordEvent(484)、signalBus.emit('worker.failed')(488)、emitWorkerSettled(489)、records.set(495)，确实从不触碰 activeWorkers/running/drainQueue。drainQueue(520-528) 仅由 cancel(152) 与非超时 finally(320) 调用——超时路径两者都不走。config 默认 maxConcurrent=4(config.service.ts:333)、timeoutSeconds=300(335)、timeoutSeconds>0 时才装定时器(199)。故 4 次超时后 activeWorkers 卡在>=4，handleSpawn(92) 永远走入队分支(93)，queue 再无人 drain。死锁断言成立。
  - [confirmed] 一个超时 worker 发出两套矛盾终态：先 worker.failed/settled(failed)，后循环正常返回→worker.completed/settled(completed)/result.injected，且 memory.store/brain.recordEvent 各执行两次；前台 waitForSettled 首个 settled 即 unsubscribe 只遮蔽不修复。 (src/worker/worker.service.ts:200-207,284-297)
    矛盾终态成立：setTimeout 回调(200-207)设 timeoutFired=true 并调用 completeWorkerWithError → emit worker.failed(488)+worker.settled status=failed(489-494)。但主循环(218-259)从不检查 timeoutFired，会继续跑到自然结束，随后 emit worker.completed(284)、worker.settled status=completed(285-290)、worker.result.injected(297)。spawn.agent.tool.ts:86-91 waitForSettled 在首个匹配 settled 即 subscription.unsubscribe()+resolve，确为遮蔽而非修复。但‘memory.store 各执行两次’有误：memory.store(263-268) 只在正常路径执行一次，completeWorkerWithError 完全不调用 memory.store，故 memory.store 仅 1 次。brainComponent.recordEvent 确实跑两次（completeWorkerWithError 的 worker.failed 一次 484 + 正常路径 worker.completed 一次 269），但两次是不同事件类型而非重复同一事件。结论：矛盾终态/双 settled 确凿，‘memory.store 两次’需修正为一次。
  - [confirmed] guard.spawn 全仓无任何 @Subscribe，SandboxGuard 只订 guard.ask，SignalBus 默认 autoApproveGuards=true，故 spawn 走 SignalBus 无-responder 分支(108-123)直接 autoApprove，从不经 inspect()/风险分级/ASK。 (src/tools/spawn.agent.tool.ts:40; src/sandbox/sandbox.guard.service.ts:84; src/signal/signal.bus.service.ts:108-123)
    grep 全仓 guard.spawn 唯一命中 spawn.agent.tool.ts:40 的 signalBus.ask('guard.spawn',...)，无任何 @Subscribe('guard.spawn')。SandboxGuard 仅 @Subscribe('guard.ask')(sandbox.guard.service.ts:84)，inspect()(143) 只在 handleGuardAsk 内调用，对 guard.spawn 永不触达。SignalBus 构造默认 autoApproveGuards=true(15)，DI container.ts:61 用 `new provider()` 无参实例化，故生产实例即 true。ask() 中 requireResponder = signal.startsWith('guard.') = true(87)，hasResponder = handlers.get('guard.spawn').size = 0 → false(88)；emit 无任何返回 boolean(因无订阅者)，故跳过 103-107，进入 108-123 分支：emit('guard.unattended')(113) 后 return this.autoApproveGuards = true(120-122)。确实绕过 inspect/风险分级/ASK 直接放行。
  - [confirmed] worker.result.injected 唯一订阅者是 socket.server.service.ts:215 的 UI 转发，AgentRuntimeService 零 @Subscribe，故 background spawn 结果永不回到发起轮，只落 memory 供未来轮 recall。 (src/worker/worker.service.ts:292-297; src/socket/socket.server.service.ts:215; src/kernel/agent.runtime.service.ts (no @Subscribe))
    grep worker.result.injected：唯一 emit 在 worker.service.ts:297，唯一订阅在 socket.server.service.ts:215（attachRuntimeBroadcasts 的 types 数组，249-251 仅 server.publish('runtime',...) 即 UI WebSocket 转发）。grep '@Subscribe' src/kernel/ 完全为空 → AgentRuntimeService 零 @Subscribe。background 分支(spawn.agent.tool.ts:59-66)立即返回 state=running 且不 waitForSettled，结果只经 memory.store(worker.service.ts:263-268)落库，发起轮无任何回收路径。断言成立。
  - [confirmed] 全链路无 AbortController：ModelRequest 无 signal 字段，stream 只用内部 AbortSignal.timeout，cancel() 只改账本不停循环——被取消/超时的 worker 继续以 guardPolicy:'auto' 执行 mutating 工具并最终发 completed。 (src/kernel/model.provider.ts:9-15,108; src/worker/worker.service.ts:141-156,460)
    ModelRequest 接口(model.provider.ts:9-15)仅 model/messages/userInput/recall/tools，无 signal 字段。stream/analyzeIntent/streamViaResponses/probe 全部用 `AbortSignal.timeout(...)`(82,108,151,226) 内部超时，外部无法注入取消。grep worker.service.ts 无 AbortController/abort 字样。cancel()(141-156)：仅 queue.splice/records.delete，或 running.delete+activeWorkers--+drainQueue()，不持有任何 abort 句柄，无法中断正在运行的 runWorker 循环或 model 流——runWorker 内也无对 cancel 的检查点。executeWorkerTool 的 toolContext.guardPolicy='auto'(460) 固定写死。故被取消/超时的 worker 继续执行 mutating 工具并最终自然 emit worker.completed(284)。断言成立。
- 修正: Claim 2 的‘memory.store/brain.recordEvent 各执行两次’需修正：memory.store 只在正常完成路径执行一次(worker.service.ts:263-268)，completeWorkerWithError 不调用 memory.store，故超时场景 memory.store 仅 1 次。brain.recordEvent 确实跑两次，但分别是 worker.failed(484) 与 worker.completed(269) 两种不同事件类型，并非同一事件重复写入。矛盾终态(双 settled: failed 后 completed)与 result.injected 误发的核心结论不受影响，仍然成立。
- 修正: Claim 3 表述精确化：guard.spawn 命中的是 signal.bus.service.ts 第 108-123 行的 requireResponder && !hasResponder 分支（先 emit('guard.unattended') 审计，再 return autoApproveGuards），而非 124-131 的 autoApprove 分支。两者最终都因 autoApproveGuards=true 放行，但走的具体分支是 108-123，与 claim 一致。
- 修正: 补充：claim 1 的死锁仅在 timeoutSeconds>0 时可触发（默认300>0，成立）；若运维将 timeoutSeconds 设为0则不装定时器、超时路径不存在，泄漏不发生——这是该缺陷的唯一缓解前置条件，综合报告可注明。

## 开放问题

- 背景委派回注的触发语义：采用 codex 的 trigger_turn=false（仅入父历史，父空闲下一轮消费）还是 opencode 的主动 fork 父续跑一轮？前者更省 token/不抢占，后者时延更低。需 owner 拍板是否允许背景结果主动唤醒一个新父 turn。
- guard.spawn 命名空间去留：是『复用 guard.ask 统一审批链（少一条死信号、与 shell/edit 一致）』还是『保留 guard.spawn 并为其补 @Subscribe responder（语义更清晰、便于 spawn 专属风险策略）』？影响 SandboxGuard 的分级逻辑与 socket 审批面。
- 父权限下沉的强度：worker 是否允许在父为 auto 时自行升格到更宽松策略？以及是否一律默认剔除 worker 的 spawn_agent（防递归），还是仅对非 orchestrator profile 剔除——取决于未来是否要支持嵌套 worker 树（当前不嵌套）。
- per-profile provider 解析：profile.provider 指定为未配置的 provider 名时应硬失败（显式不静默）还是 fallback 到父 provider？按红线倾向硬失败，但需确认是否会破坏现有 general profile 的零配置启动。
- 超时语义：保留 setTimeout 作为 abort 触发兜底，但 timeoutSeconds=300 是否对 explore 类轻任务过长？是否应 per-profile 配置 timeout（与 model/provider 同批补齐）。
- SignalBus.autoApproveGuards 双源（构造默认 true vs SandboxGuard 读 config）是否统一为单一 config 来源——这会改变非 DI/测试上下文的默认行为，需确认无回归。