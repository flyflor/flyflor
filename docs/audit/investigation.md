# investigation 诊断与重构方案

## 诊断

## 这个子系统现在到底错在哪

调查子系统的路由层（单模型 JSON 决策 analyzer.analyze→parseModelDecision）是健康的、必须保留。真正的病灶在「证据如何被采集、如何流动、如何沉淀」这条主轴上，由四个相互放大的缺陷构成，共同使两条北极星都达不到。

### 1. 两套割裂的证据采集路径，且都不沉淀（核心病）
HEAD 的证据收集由两段彼此不感知的逻辑拼成：
- **(A) host 预跑 `inspectProject`**（`agent.runtime.service.ts:1052-1068`）：在主模型看到 turn 之前，由 `executeInlineTools`（:934-955，触发条件 :937 `requiresProjectInspection && projectPath && visibleToolNames.has("glob")`）盲跑一条写死的链：`git status --short` + 8 个固定 glob（package.json/tsconfig.json/src|app 下 *.ts(x)）+ 固定 grep `TODO|FIXME|throw new Error|console\.error` + codegraph status + 读 `pickProjectFiles` 选中的文件。结果经 `renderToolResults`（:1179-1187）拼成**单条 role=tool 文本**追加进 modelMessages（:266-274）。
- **(B) 模型自身 in-loop 工具回路**（:287-328）：模型在 for 循环里用 read_only 组（read/glob/grep/git，:977-981）+ codegraph 自驱，每条结果 `renderSingleToolResult` 成独立 tool 消息追加（:313-320）。

这两路结果**只是同一 `modelMessages` 数组里的并列文本**：没有去重、没有归并、没有写入任何持久证据结构。inspectProject 已经 glob/grep/read 过的内容，模型完全不知情，会重复采集。turn 结束后两路证据全部蒸发，只有 `loopToolResults.length` 计数被记进 recovery point（:349）。`docs/investigation-evidence-loop.md:20-28` 宣称的 "rebuildable evidence ledger / repo_overview / 验证路径" **在代码里根本不存在**，仍是 "Later Phases"——文档超前于代码。

### 2. inspectProject 对仓库结构写死，对真实世界仓库近乎空操作
`inspectProject` 的 glob/grep（:1059/1062）、`pickProjectFiles`（:1144-1157，只挑 package.json/README.md/tsconfig.json 与 `^src/.*\.(ts|tsx)$`、`^app/.*\.(ts|tsx)$`）、`looksLikeProjectFile`（:1166-1170，扩展名只接受 ts/tsx/js/jsx/json/md，目录前缀限定 src|app|lib|packages|...，且 `!value.includes(":")` 会丢弃任何 `file:line` 风格输出）全部硬编码了 Node/TS 单体仓库假设。对 Python(.py)/Go(.go)/Rust(.rs)、源码在 cmd/internal/crates/ 或根目录、或深层 monorepo 的仓库，pickProjectFiles 返回空、read 阶段一个文件都不读，host 预跑等同空操作却仍消耗 git/glob 调用与审计噪声。

### 3. investigate 模式被砍掉 shell/workmux，无法验证假设、无法委派子代理
`boundToolGroups`（`context.intent.analyzer.component.ts:383-385`）对 `mode==="investigate"|"continue_task"` 强制 `groups.filter` 只留 read_only/memory_read/context/codegraph——**即使决策模型返回 shell/workmux 也被静默吞掉**。于是 `visibleToolsForDecision`（:999 需 groups.has('shell')；:995 需 groups.has('workmux')）在 investigate 轮永远拿不到 shell 和 spawn_agent。

这造成两处「能力名不副实」：
- `prompts/agent-investigate.md:6,13` 明确告诉调查子代理「`bash`：用于运行测试、检查日志」「使用 bash 运行测试命令验证假设」，且 config 的 investigate worker profile（`config.service.ts:319`）确实含 `shell`——但这是**子代理 profile**，主回路 investigate 决策模式拿不到。
- 主回路 investigate 退化为静态 glob/grep/read+codegraph，**无法运行测试/复现/查 git log 来证实或推翻假设**，只能靠静态阅读猜根因。

注意一个被审计正确指出的张力点：`prompts/intent.md:34` 明确指导模型「要跑 shell 命令就用 `code` 模式」，`intent.md:43` 指导「investigate 偏 read_only/codegraph」。也就是说 **intent.md（提示词层）与 agent-investigate.md（子代理提示词层）对 investigate 是否能用 shell 互相矛盾**，而 boundToolGroups 执行的是 intent.md 的世界观。host 白名单在此凌驾了模型决策——与「模型拥有语义路由、host 只验证边界」的设计宣言存在张力。

### 4. 子代理调查结论无法异步回灌本轮
`WorkerService` 完成后构造 `WorkerResultInjectedPayload` 并 emit `worker.result.injected`（`worker.service.ts:292-297`），其类型注释（`worker.types.ts:103-114`）明写 "injected into the parent turn"。但**全仓唯一订阅者是 `socket.server.service.ts:215`**——只当调试事件转发给前端，没有任何 kernel/AgentRuntimeService 订阅者把 summary 回灌父轮。子代理结论回到本轮的唯一真实通道是 `spawn_agent` 前台同步 `waitForSettled`（`spawn.agent.tool.ts:67-82`），它阻塞父轮且只在 code/general 模式可用；background 模式（:59-66）立即返回 state="running"，后续结论**永远回不到任何父轮**。叠加缺陷 3，investigate 模式连 spawn_agent 都拿不到，调查主回路无法借子代理深挖。`worker.result.injected` 目前是「死代码级别的仅广播」，与字面契约背离。

### 为什么这些错共同导致双北极星失败
- **底层 coding 内核（read/grep/glob/edit/shell/git/codegraph 真正能干活）**：investigate 砍掉 shell 使「以证据验证假设」这一核心能力在端到端路径上不可达；inspectProject 对非 TS 仓库失明使「对任意授权工作区收集真实证据」落空；证据靠扁平文本注入并被硬截断（renderToolResults 整体 30000 字符 / 每条 8000，:1184/1186；renderSingleToolResult 每条 8000），大仓库证据无声丢失，调查越深越丢关键证据。
- **无 session 智能生命体（记忆环绕内核）**：两路证据 turn 结束即蒸发、无可重建证据账本，违背 `no-session-coding-agent.md`「每次 turn 从本地持久态重建」；子代理结论无异步回灌通道，跨轮调查无法累积。证据这一层根本没有「环绕内核的记忆」，只有一次性 prompt 文本。

### 一条澄清（防止误修）
审计缺陷④是正确的纠偏：inspect 证据**确实**被喂进本轮模型（renderToolResults 产物进 modelMessages，:266-274，而 modelMessages 是 streamModelStep 每步的输入 :294）。所以「只 render 一次不回喂」是误解。真正要修的是 (a) 30000/8000 硬截断无分页/优先级；(b) 跨轮不持久——而非「回喂链路」。

### 一条审计未发现的红线违规
所有 `agent-*.md` 子代理提示词（investigate/explore/code/discuss/general）**全部缺失 `.zh.cn.md` 人维副本**，且这些 `.md` 文件本身就是用中文写的（例如 `agent-investigate.md` 全文中文）。这同时违反「每个 name.md 必须有 name.zh.cn.md 人维副本，runtime 只加载 .md」的红线方向——当前是「runtime .md 是中文、缺英文/人维分离副本」。对照 system/clarify-default/context-render/intent/tool-loop-* 都有 zh 镜像，agent-* 系列是空缺。任何调查重构动到这些提示词都必须先补齐双副本。

## 真实根因

- 根因一（最高影响）：缺少统一的、可审计可重建的证据存储层。host 预跑(inspectProject) 与模型 in-loop 回路两套结果都只当临时 prompt 文本活在本轮 modelMessages，turn 结束即蒸发；docs 承诺的 evidence ledger / repo_overview 从未落地。这同时违背 no-session 的『每轮从持久态重建』与 coding 内核『证据可验证可回放』。
- 根因二：host 在回路之外预跑动态探查，僭越了本应由模型在 in-loop 回路自取的职责。inspectProject 用固定模板猜证据，与模型真实问题脱节，且发生在模型决策之前，无法『据上一条查询结果决定下一条』。证据采集与决策被人为拆成两个回路。
- 根因三：boundToolGroups 用 host 侧白名单硬性收窄 investigate（剔除 shell/workmux），把『只读调查』错误等同于『glob/grep/read』，忽略了只读 shell（跑测试/查日志/git log）这一关键验证能力，并切断了子代理委派；同时与 agent-investigate.md 提示词承诺直接矛盾，提示词层(intent.md vs agent-investigate.md)自相矛盾。
- 根因四：证据采集硬编码 Node/TS 单体仓库假设（语言/目录/扩展名/grep 关键字/路径过滤），无任何运行时仓库探测，对大量真实仓库等同空操作。
- 根因五：worker.result.injected 信号的『回灌父轮』意图没有任何 runtime 消费实现，仅 socket 广播；background spawn 无异步回灌路径——信号契约与实现脱节，子代理调查结论无法累积进后续轮。
- 根因六：证据/记忆注入用扁平文本拼进每轮重建的 system 前缀且硬截断(30000/8000)，既无分页/优先级导致大仓库证据无声丢失，又使 system 前缀每轮抖动（破坏可缓存稳定前缀）。
- 根因七（审计未发现）：agent-*.md 子代理提示词缺失 .zh.cn.md 人维副本且 .md 本身为中文，违反提示词双副本红线。

## 推荐重构

## 总体方向
把「host 只预注入确定性静态上下文 / 模型在单一 in-loop 回路自取动态证据 / 证据沉淀进可重建账本 / 子代理结论异步经 SignalBus 回灌」四件事分清楚，移植 codex 的「环境元数据 fragment + AGENTS.md 分层发现 + 调查即工具回路」与 openhuman 的「装配/递减解耦 + 阈值门控 fire-and-forget 状态机 + 稳定前缀/动态段分层」。kernel 保持纯编排，所有横切能力经 SignalBus @Subscribe 接入。

### 改动 1 —— 退化 inspectProject 为「纯静态环境片段」(T4, 移植 codex environment_context + AGENTS.md)
- **删除 `inspectProject`/`pickProjectFiles`/`looksLikeProjectFile`**（`agent.runtime.service.ts:1052-1170`）的动态探查（git status / glob / grep / read 链）。
- 新增 `EnvironmentContextComponent`（src/context/），照搬 codex `environment_context.rs` 的 fragment 模型：只渲染 cwd、shell、当前 git 分支名、current_date、可写根目录(workspaceRoots) 这几行 host 确定性已知元数据，用稳定 `<environment_context>...</environment_context>` open/close marker 包裹，作为**单条 user 片段**注入，便于压缩时精确剔除/重建。
- 新增 `ProjectInstructionsComponent`：移植 codex `agents_md.rs` 的分层发现——从 cwd 用 `.git`(可配置 marker) 向上定位项目根，从根向下到 cwd 逐层收集 AGENTS.md，加 max-bytes 预算与截断，渲染成带 marker 的 user_instructions 片段。**AGENTS.md = 预注入静态约定；代码结构/git 状态/grep = 模型在回路自取**，两条路径严格分离。
- 把 `requiresProjectInspection` 的语义从「触发 host 预跑」改为「是否向模型暴露 read_only 工具组」——直接复用现成的 `visibleToolsForDecision` read_only 组（:977-981）。`executeInlineTools`（:934-955）保留 user-explicit shell 那一支（:943-953，因其有 `userExplicitlyRequestedShellCommand` 边界），删除 inspectProject 那一支（:937-942）。
- 在 system/turn prompt 加 codex 式指导（照搬 gpt-5.2-codex_prompt.md 的 "prefer rg / rg --files" 与「先 inspect 当前真实状态再依赖记忆」），让模型在已有 in-loop 回路（:287-328）自驱采集。**改后控制流**：turn 开始 → host 注入 environment + AGENTS.md 两条静态 marker 片段 → 模型 in-loop 回路用 read/glob/grep/git/codegraph(+只读 shell) 自取动态证据 → 单一回路，无平行预跑。

### 改动 2 —— investigate 解除 shell/workmux 封锁，但仍守边界 (T4+T5)
- 修改 `boundToolGroups`（analyzer:383-385）：investigate 允许保留 `read_only/memory_read/context/codegraph` **加上 read-only `shell` 与 `workmux`**。但 read-only 性质不靠工具组保证，而靠现有 `validateModelToolTarget`（:1102-1115）+ guard：investigate 模式下 shell 仍受 `intent.shellCommand` 约束与 guard.* ask 阻断 mutating；spawn_agent 走 `guard.spawn` ask（spawn.agent.tool.ts:40-50）。
- 统一 intent.md 与 agent-investigate.md：修订 `intent.md:34,43` 允许 investigate 暴露只读 shell 用于「跑测试/查日志/git log 验证假设」，与 agent-investigate.md 一致。**先补齐 agent-*.md 的 .zh.cn.md 副本并把运行时 .md 与人维副本对齐**（守 prompt 双副本红线）。

### 改动 3 —— 引入 EvidenceComponent：可重建证据账本 (T4, 移植 openhuman session_memory 状态机思路 + docs 承诺落地)
- 新增 `EvidenceComponent`（src/context/ 或 src/memory/，经 SignalBus 接入，**kernel 不 imperative 调用**）。它 `@Subscribe` 工具结果信号：在回路里每条 tool 结果除了进 modelMessages 外，runtime emit 一个 `evidence.collected` 信号（{turnId, conversationId, tool, args, output, ok}），EvidenceComponent 订阅后写入 memory.db 的证据账本（带 sourceKind="evidence"、sourceId=`${conversationId}:${turnId}`、provenance）。这是 docs/investigation-evidence-loop.md:26 承诺的 "rebuildable ledger, not semantic memory" 的落地。
- 账本支持去重（同 tool+args 命中复用）与跨轮召回：下一轮 `ContextBuilderService.build` 可经 contextSourcesToInject 增加 "evidence" 源，把上一轮高价值证据作为**动态段**召回（不进稳定 system 前缀）。
- collapse/压缩时：证据账本随 brain 不可变审计（任何 collapse 前原文先入 brain，已由 brainComponent.recordEvent 链保证），memory.db 证据可被遗忘归档但不删 brain。

### 改动 4 —— worker.result.injected 真正回灌 (T5, 落地 master-plan「结果回注」)
- 在 `AgentRuntimeService` 新增 `@Subscribe("worker.result.injected")`，把 background worker 的 summary 作为证据写入 EvidenceComponent（sourceKind="worker"，parentTurnId）。下一次该 conversation 的 turn，build() 经 evidence 源把它作为动态段召回回灌——实现「同轮写、下轮召回」的异步回灌，符合 no-session（不靠 provider session，每轮从本地持久态重建）。
- 前台 spawn 仍保留 waitForSettled 同步路径（spawn.agent.tool.ts:67-82）。这样 background 子代理结论不再丢失，且 worker.result.injected 的字面契约被兑现。

### 改动 5 —— 证据注入分层 + 截断改造 (T4+T6, 移植 openhuman 稳定前缀/动态段 + codex marker fragment)
- 把 `ContextBuilderService.build`（context.builder.service.ts:56-67）的 `systemSections.join` 拆成「稳定前缀段（core 模板/SYSTEM/RUNTIME，跨轮不变）」+「动态证据段（MEMORY RECALL / STRUCTURED FACTS / KNOWLEDGE TREE / EVIDENCE，随 query 变）」，动态段移到 user 侧或独立 system 尾块，让稳定前缀可被 provider/本地缓存复用，避免每轮抖动。
- `renderToolResults`/`renderSingleToolResult`（:1179-1206）的 30000/8000 硬截断改为：优先级排序（grep 命中行 > 文件头 > 长 dump）+ 分页/摘要而非无声 slice，超限时 emit `evidence.truncated` 信号显式可观测（守「禁止静默 fallback」）。

### 改动 6 —— 给 storeDurableFacts 加阈值门控状态机 (T6/T7, 移植 openhuman session_memory)
- `storeDurableFacts`（:776-819）轻量 upsertFact 仍可同轮做；但若未来要做 LLM 级证据蒸馏/去重，加一层 `SessionMemoryState`：累计 token/turn/factsToStore 增量，三增量 AND 跨阈值才触发重综合，做成 fire-and-forget（不阻塞 turn 返回）经 SignalBus，用 in-progress 标志 + 成功 reset / 失败保留 deltas 的状态机防重复保重试。

**改完后端到端数据/控制流**：host 注入 environment+AGENTS.md 静态 marker 片段 → 模型单一 in-loop 回路自取证据（read/grep/glob/git/codegraph + 只读 shell + spawn_agent，受 guard/allowlist 边界）→ 每条证据 emit evidence.collected 经 EvidenceComponent 沉淀进 memory.db 账本 → 子代理 background 结论经 worker.result.injected → EvidenceComponent 回灌 → 下一轮 build() 把高价值证据作为动态段召回 → brain 全程不可变审计。kernel 全程纯编排，证据/记忆/worker 回灌均经 SignalBus @Subscribe。

## 参考映射

- **environment_context fragment：host 只预注入 cwd/shell/branch/date/可写根 等纯元数据，渲染为带稳定 open/close marker 的单条 user 片段，便于压缩剔除/重建** ← codex (environment_context.rs / fragment.rs) → 新增 EnvironmentContextComponent(src/context/)，替换 inspectProject 的环境职责；marker 片段注入点替代 agent.runtime.service.ts:266-274
- **AGENTS.md 沿 .git 根→cwd 分层发现 + max-bytes 预算 + 渲染为带 marker 的 user_instructions** ← codex (agents_md.rs / user_instructions.rs) → 新增 ProjectInstructionsComponent；把静态约定与动态探查严格分离
- **调查即工具回路：无 host 预跑，模型用通用 shell/exec + rg 自驱探查，证据回流同一对话；rg 优先只是 prompt 一句指导而非专用 host 工具** ← codex (shell_spec.rs / gpt-5.2-codex_prompt.md / orchestrator.md) → 删除 inspectProject(agent.runtime.service.ts:1052-1170)，requiresProjectInspection 改为『是否暴露 read_only 组』，复用现成 in-loop 回路(:287-328) 与 visibleToolsForDecision(:977-981)；prompt 加 rg 优先指导
- **update_plan 轻量 ephemeral TODO 工具：仅发事件、不改控制流、简单任务不用** ← codex (plan.rs / plan_spec.rs) → 可选新增 PlanTool，接 SignalBus 事件流(类比 EventMsg::PlanUpdate)，强化多步调查可见性；与权限红线无关
- **goal continuation 的 'work from evidence' + 'completion audit' prompt 纪律，强制每个 continuation 回合先 inspect 真实状态、逐需求验证完成** ← codex (goals.rs / continuation.md / goal_context.rs) → 短期：把这两段文字加入 flyflor turn prompt(system.md / agent-investigate.md)，部分替代被删的 inspectProject 价值；中长期可引入持久 goal + 自驱 continuation
- **装配(召回→prompt)与递减(compaction)解耦：装配产出可缓存纯函数，compaction 只在超限触发的独立 stage，不在本轮回流证据进 history** ← openhuman (pipeline.rs / turn.rs) → ContextBuilderService.build 拆稳定前缀段/动态证据段；buildContextWithBudgetGuard(:646-683) 的压缩保持独立 stage
- **session_memory 阈值门控的 fire-and-forget 状态机：三增量 AND 跨阈值才触发重综合，in-progress 防重复，成功 reset/失败保留 deltas 重试，重综合移出热路径** ← openhuman (session_memory.rs / turn.rs) → 给 storeDurableFacts(agent.runtime.service.ts:776-819) 加 SessionMemoryState 门控；LLM 级蒸馏经 SignalBus fire-and-forget
- **稳定 system 前缀承载长期记忆 / 动态召回通道承载随轮变化证据，物理分离保护 KV-cache 前缀；importance/provenance 分级双写入器提升召回排序** ← openhuman (memory_loader.rs / turn.rs) → context.builder.service.ts:56-67 system content 分层；EvidenceComponent 写入带 provenance，召回作为动态段
- **可重建证据账本(rebuildable evidence ledger, not semantic memory)** ← openhuman session_memory 持久思路 + flyflor 自身 docs/investigation-evidence-loop.md:26 承诺 → 新增 EvidenceComponent，经 evidence.collected 信号沉淀进 memory.db，落地 docs 的 Later Phases

## 红线核对

逐条核对：
- **无 session**：EnvironmentContext/AGENTS.md/EvidenceComponent 全部从本地持久态(config/.git/AGENTS.md/memory.db)每轮重建；worker.result.injected 回灌走『同轮写 memory.db、下轮 build 召回』，绝不依赖 provider 连续性。✔
- **双北极星**：解除 investigate 的 shell/workmux 封锁让 coding 内核(read/grep/glob/git/codegraph/只读 shell/spawn) 在调查路径真正能干活；EvidenceComponent + 动态段召回让记忆机制环绕内核。✔
- **brain 不可变月度全量审计**：EvidenceComponent 写 memory.db；brain 仍由 brainComponent.recordEvent/recordMessage 全程记录(改动不触碰 brain 写链)；任何 collapse/遗忘前原文已入 brain，证据账本可被 memory.db 侧归档但绝不删 brain。✔
- **memory.db 热记忆**：证据账本作为 memory.db 新 sourceKind 存在，与 facts/chunks/checkpoints 同层。✔
- **kernel 纯编排**：新增的 EvidenceComponent、SessionMemoryState、worker 回灌均经 SignalBus @Subscribe 自持状态；kernel(AgentRuntimeService) 只 emit evidence.collected / 订阅 worker.result.injected，不 imperative 调用子系统业务逻辑。注意：现有 inspectProject 是 kernel imperative 调工具，删除它反而更符合此红线。✔
- **SignalBus 血管层 + guard ask**：investigate 解锁 shell 后仍走 validateModelToolTarget + guard.* ask；spawn_agent 走 guard.spawn ask(spawn.agent.tool.ts:40)，侦查者对 mutating/spawn 真正阻断；ASK>Confirm 不变。✔
- **WS 三面**：evidence.collected/worker.result.injected 作为 SignalBus 广播被前端订阅显示，不新增 WS 直连面；WS 仍只对接 guard/db(brain,memory 读)/chat。✔
- **禁 mock/fake 供应商 & 禁玩具 embedding & 禁静默 fallback**：不引入任何确定性供应商；EvidenceComponent 向量化复用现有真 embedding 通道(T7)；截断改造把无声 slice 改为 evidence.truncated 显式信号+审计。✔
- **prompt 双副本**：本方案明确要求先补齐 agent-investigate/explore/code/discuss/general 的 .zh.cn.md 人维副本并对齐运行时 .md；新增的 codex 式 prompt 指导同样必须 .md + .zh.cn.md 双份，runtime 只加载 .md。✔

## 轨道映射

主要落在 **T4(调查单回路)** 与 **T5(子代理)**，并补强 T6/T7：

- **T4 调查单回路**（master-plan:44 已列 RepoOverviewTool、EvidenceComponent、合并证据路径）：本方案与现有计划高度一致并细化——(a) 把『RepoOverviewTool』方向修正为 codex 式『environment_context 静态片段 + AGENTS.md 分层发现』，而非又一个 host 预跑探查工具(否则重蹈 inspectProject 覆辙)；(b) 明确 EvidenceComponent 经 evidence.collected 信号沉淀、落地 docs:26 的 rebuildable ledger；(c) 『合并证据路径』= 删除 inspectProject 平行预跑，统一回 in-loop 回路。差异/补强：现有计划未点明『investigate 解锁只读 shell/workmux』与『intent.md vs agent-investigate.md 提示词矛盾需统一』，本方案补上。
- **T5 子代理**（master-plan:45 已列『结果回注』『guard.spawn』）：本方案落地『结果回注』为 AgentRuntimeService @Subscribe worker.result.injected → EvidenceComponent → 下轮召回，兑现信号字面契约；guard.spawn 已存在(spawn.agent.tool.ts:40)。差异：现有计划侧重前台阻塞，本方案补强 background 异步回灌路径。
- **T6 摘要**：证据注入分层(稳定前缀/动态段) + 截断改造(显式 evidence.truncated) + storeDurableFacts 阈值门控状态机，补强 master-plan:46 的 collapse 前先入 brain。
- **T7 知识树**：EvidenceComponent 向量化必须复用真 embedding 单遍召回，与 master-plan:47 对齐。
- **T3 工具调用硬化**：WorkspaceAllowlistComponent(已落地 docs/investigation-evidence-loop.md Phase 1) 在改动 1 中被 environment 片段与 in-loop 回路复用，不新增。

与 master-plan 总差异：master-plan 已识别『investigate 砍 shell / inline 浅 / 两路割裂 / 子代理回不到本轮』(:25,57)，本方案提供了具体到文件/类/信号的落地路径与参考机制映射，并新增了 master-plan 未覆盖的『agent-*.md 缺 zh 双副本红线违规』修复项。

## 复核结论

- 总体置信: high
  - [misdiagnosed] boundToolGroups 对 mode==='investigate' 强制只保留 read_only/memory_read/context/codegraph，过滤掉 shell/workmux，导致 investigate 主回路拿不到 shell/spawn_agent，与 agent-investigate.md:13『用 bash 验证假设』矛盾 (src/context/context.intent.analyzer.component.ts:383-385 / src/kernel/agent.runtime.service.ts:975,995-1001 / prompts/agent-investigate.md / src/config/config.service.ts:317-323 / src/prompts/prompt.registry.service.ts:82)
    前半段机制属实：context.intent.analyzer.component.ts:383-385 确实对 mode==='continue_task'||'investigate' 仅 filter 保留 read_only/memory_read/context/codegraph；agent.runtime.service.ts:975 的 groups 来自 intent.toolGroupsToExpose(即 boundedToolGroups)，:999 shell、:995-997 workmux→task/spawn_agent 因此进不了 allowed 集合。但『与 agent-investigate.md 矛盾』的因果链是误诊：agent-investigate.md 在 prompt.registry.service.ts:82 标注 owner="worker"，由 WorkerService 经 investigate profile 加载(config.service.ts:320 systemPrompt 指向它)。该 profile 的 tools 在 config.service.ts:319 明确含 "shell"，且 WorkerService 用 profile.tools(worker.service.ts:365 resolveWorkerTools)解析工具，完全不走 boundToolGroups。即真正阅读 agent-investigate.md 并被要求『跑 bash』的 investigate 子代理是拿得到 shell 的。analyzer 的 mode==='investigate' 是主对话轮内联工具暴露，与子代理 prompt 是两套子系统，断言把二者混为一谈。附带:agent-investigate.md:6 写 `bash` 但实际工具名为 shell(无 bash 工具),属 prompt/工具名不一致,但非断言所述的 shell 被静默过滤。
  - [confirmed] worker.result.injected 全仓唯一订阅者是 socket.server.service.ts:215(仅转发前端调试)，无 kernel/AgentRuntimeService 订阅者把 summary 回灌父轮；background spawn 立即返回 running，结论回不到父轮 (src/worker/worker.service.ts:292-297 / src/socket/socket.server.service.ts:215 / src/tools/spawn.agent.tool.ts:59-66)
    全仓 grep worker.result.injected 仅四处:worker.service.ts:297(emit)、worker.types.ts:103,108(类型注释)、socket.server.service.ts:215。后者位于 attachRuntimeBroadcasts 的 types 数组(:180,248-251),其回调 this.server?.publish("runtime", ...) 仅向前端 runtime 频道广播,无任何 kernel 侧 subscribe 把 summary 回灌父轮。background 分支 spawn.agent.tool.ts:59-66 在 input.background 时 emit worker.spawn 后立即 return state="running",不等待 worker.settled;前台路径(67-82)才 waitForSettled。故 background 子代理结论确实无回灌路径。断言准确。
  - [confirmed] docs 宣称的 rebuildable evidence ledger / repo_overview 代码中不存在(仍是 Later Phases)；inspectProject 与模型回路两路证据只活在本轮 modelMessages，turn 结束即蒸发，只有 loopToolResults.length 进 recovery point (docs/investigation-evidence-loop.md:20-28 / src/kernel/agent.runtime.service.ts:266-274,344-351)
    repo_overview 全仓仅出现在 docs/investigation-evidence-loop.md:24(『Later Phases』标题在:20),src/ 中零引用;grep evidence ledger/rebuildable 在 src/ 中无任何命中,证实仍是未实现的后续阶段。agent.runtime.service.ts:266-274 inspectProject 的 toolResults 仅作为一条 role:"tool" 拼进本轮 modelMessages;:344-351 recordRecoveryPoint 的 payload 只存 {assistantChars, toolResults: loopToolResults.length}(:349)即一个计数,:362 upsertTurn metadata 同样只存 toolResults 计数。无证据被结构化持久化为可重建账本。断言准确。
  - [confirmed] inspectProject/pickProjectFiles/looksLikeProjectFile 硬编码 Node/TS 单体仓假设(glob src|app/*.ts(x)、grep TODO|FIXME、扩展名白名单、!includes(':') 过滤)，对 Python/Go/Rust 或非 src/app 布局仓库返回空、read 阶段零文件 (src/kernel/agent.runtime.service.ts:1059,1062,1144-1157,1166-1170)
    agent.runtime.service.ts:1059 glob 模式硬编码 package.json/bun.lock/tsconfig.json/README.md/src|app/**/*.ts(x),无 .py/.go/.rs;:1062 grep 固定 TODO|FIXME|throw new Error|console\.error(JS 习语)。pickProjectFiles:1153-1154 只挑 /^src\/.*\.(ts|tsx)$/ 与 /^app\/.*\.(ts|tsx)$/。looksLikeProjectFile:1166-1169 正则扩展名白名单仅 ts|tsx|js|jsx|json|md,且 :1168 !value.includes(":") 会把 ripgrep 的 path:line:match 行排除(但对纯 glob 路径无害)。对 Python/Go/Rust 或非 src/app 布局,glob 命中为空→pickProjectFiles 返回空→read 阶段无文件,host 预跑近似空操作(仅剩 git status 与 codegraph status)。断言准确;唯一措辞偏差:!includes(':') 主要是为剔除 grep 输出行,非额外语言过滤,但不影响整体结论。
  - [confirmed] 红线违规:所有 agent-*.md(investigate/explore/code/discuss/general)缺失 .zh.cn.md 人维副本且 .md 本身为中文,违反『每个 name.md 必须有 name.zh.cn.md』;对照 system/intent/clarify-default/context-render/tool-loop-* 均有 zh 镜像 (prompts/agent-investigate.md (无 prompts/agent-investigate.zh.cn.md))
    ls prompts/agent-*.zh.cn.md 报 no matches found,五个 agent-*.md 均无 zh.cn.md 镜像;且每个 agent-*.md 首行均为中文(如 agent-investigate.md:1『你是 Flyflor 的 Investigate 子代理』)。对照 prompts/ 下确有 system/intent/clarify-default/context-render/tool-loop-config-limit/tool-loop-limit/tool-loop-safety-ceiling 七个 .zh.cn.md。更有力佐证:docs/investigation-evidence-loop.md:29 自己写明『Every prompt added for investigation must have both .md and .zh.cn.md mirrors』,而 agent-investigate.md 恰恰违反此规。断言准确。
- 修正: 断言1 需降级为 misdiagnosed/部分误诊:boundToolGroups 对 mode==='investigate' 的过滤机制(analyzer:383-385 + runtime:975/995-1001)客观存在且正确描述,但它作用于【主对话轮】的内联工具暴露,不是 agent-investigate.md 所属的【investigate 子代理】。agent-investigate.md owner=worker(prompt.registry:82),由 WorkerService 经 investigate profile 加载,该 profile tools 含 shell(config.service:319),且 WorkerService 用 profile.tools(worker.service:365)而非 boundToolGroups 解析工具。因此『investigate 主回路永远拿不到 shell/spawn_agent,与 agent-investigate.md:13 直接矛盾』的因果链不成立——读该 prompt 的子代理拿得到 shell。综合报告若要保留此条,应拆成两个独立事实:(a)主轮 investigate 模式被 boundToolGroups 限制为只读(真实但与该 prompt 无关);(b)agent-investigate.md:6 写 `bash` 而仓库无 bash 工具、实际工具名为 shell(真实的 prompt/工具名不一致)。
- 修正: 断言4 的措辞 '!includes(":") 过滤' 略有偏差:该条件主要用于剔除 ripgrep 'path:line:match' 输出行而非充当额外语言白名单,对结论(非 TS/JS 仓返回空)无影响,可在综合报告中微调表述。
- 修正: 断言2/3/5 经源码逐行复核全部 confirmed,可直接采信。

## 开放问题

- investigate 是否应被允许使用『只读 shell』？若允许，read-only 如何强制——靠命令白名单(rg/cat/ls/git log/测试 runner)、靠 guard.* ask 逐条 ASK、还是靠沙箱只读挂载？这决定 boundToolGroups 该开多大口子，且涉及 ASK>Confirm 的交互成本。
- intent.md(『跑 shell 用 code 模式』) 与 agent-investigate.md(『用 bash 验证假设』) 哪个是 owner 想要的真相？是统一到『investigate 可只读 shell』，还是保持『investigate 纯静态、要验证就升级到 code/spawn investigate worker』？两条路对主回路 vs 子代理的能力边界定义完全不同。
- EvidenceComponent 写入 memory.db 还是独立 evidence 存储？docs:26 说『not semantic memory』——若进 memory.db 需新 sourceKind 且要确保不污染语义召回排序；若独立存储则跨轮召回通道要新建。
- worker.result.injected 异步回灌的时机与粒度：background worker 完成在父轮已结束之后，回灌只能进『下一轮 build 的动态段召回』——这对用户体验意味着 background 子代理结论有一轮延迟，是否可接受？还是需要主动 emit 一个『新证据可用』提示触发用户/模型继续？
- 是否引入 codex 式持久 goal + 自驱 continuation？这会显著改变 turn 边界与跨轮控制流，与 flyflor『host decider 每轮重新决策』的现有范式冲突，属较大架构取舍，需 owner 决定纳入哪条轨道(可能是新轨或 T4 扩展)。
- 证据注入截断从硬 slice 改为优先级/分页/摘要，超限是否必须模型蒸馏(走真供应商、移出热路径)还是确定性优先级排序即可？这关系到 T6 与是否触发 fire-and-forget 状态机。