# Flyflor

Flyflor 是一个无会话智能生命体（no-session coding agent）。它不依赖模型供应商的会话作为连续性来源；每一轮都从本地持久化状态重建上下文、记忆、工具可见性和审计轨迹。

**核心理念**：LLM 作为流体智力 + MemoryComponent 热记忆 + Scope 宪法层 + CrystalComponent 晶体智力 + Forgetting 遗忘机制。

## 目录

- [架构概览](#架构概览)
- [目录红线](#目录红线)
- [模块详解](#模块详解)
  - [内核层 (`src/kernel/`)](#内核层)
  - [信号血管层 (`src/signal/`)](#信号血管层)
  - [DI 系统 (`src/di/`)](#di-系统)
  - [记忆层 (`src/memory/`)](#记忆层)
  - [审计层 (`src/brain/`)](#审计层)
  - [上下文层 (`src/context/`)](#上下文层)
  - [工具系统 (`src/tools/`)](#工具系统)
  - [插件系统 (`src/plugins/`)](#插件系统)
  - [Prompt 协议层 (`src/prompts/`)](#prompt-协议层)
  - [Agent Worker 系统 (`src/worker/`)](#agent-worker-系统)
  - [Sandbox 守卫 (`src/sandbox/`)](#sandbox-守卫)
  - [Scope 系统 (`src/scope/`)](#scope-系统)
  - [Crystal 晶体智力 (`src/crystal/`)](#crystal-晶体智力)
  - [Forgetting 遗忘系统 (`src/forgetting/`)](#forgetting-遗忘系统)
  - [配置系统 (`src/config/`)](#配置系统)
  - [共享工具 (`src/shared/`)](#共享工具)
  - [数据实体 (`src/entities/`)](#数据实体)
  - [WebSocket 适配 (`src/socket/`)](#websocket-适配)
- [信号总览](#信号总览)
- [配置文件](#配置文件)
- [SQL Schema](#sql-schema)
- [Prompt 文件](#prompt-文件)
- [设计文档](#设计文档)
- [安装与运行](#安装与运行)
- [测试](#测试)

---

## 架构概览

```
用户输入（WebSocket / TUI）
        │
        ▼
  SocketServerService ─── WebSocket 广播（60+ 信号类型）
        │
        ▼
  AgentRuntimeService ─── 内核编排（turn loop）
   │         │         │
   ▼         ▼         ▼
ContextModule  ToolModule  MemoryComponent  BrainComponent
   │              │             │                │
   ▼              ▼             ▼                ▼
意图分析+      工具注册表+    热记忆+         月度审计
上下文构建    Sandbox守卫   向量召回         brain.db
                              │
                    ┌────┬────┼────┬────┐
                    ▼    ▼    ▼    ▼    ▼
              Scope  Crystal Worker Forgetting
              宪法层  晶体智力  并发  遗忘
```

## 目录红线

以下目录结构不可违反，新增目录需更新 `AGENTS.md`：

| 目录 | 职责 |
|------|------|
| `src/di/` | DI 装饰器、元数据注册表、容器引导 |
| `src/signal/` | SignalModule、SignalBus、信号契约、guard/confirm 流 |
| `src/socket/` | 仅外部 WebSocket 适配 |
| `src/kernel/` | agent 运行时编排 |
| `src/brain/` | 月度全量审计数据库 |
| `src/memory/` | 热路径工作记忆数据库 |
| `src/context/` | 无会话上下文构建、意图分析、压缩 |
| `src/tools/` | 内置工具实现和注册表 |
| `src/plugins/` | 插件宿主和外部插件适配器 |
| `src/prompts/` | 统一 Prompt 注册表和协议层 |
| `src/worker/` | 多 Agent Worker 并发系统 |
| `src/sandbox/` | RxJS 血管侦查者守卫 |
| `src/scope/` | Scope 宪法层记忆系统 |
| `src/crystal/` | Crystal 晶体智力系统 |
| `src/forgetting/` | 遗忘衰减与漂移系统 |
| `src/config/` | 配置加载和类型化配置访问 |
| `src/entities/` | @Repo() 数据模型和 SQL 操作 |
| `src/shared/` | 共享类型、错误、跨模块工具 |
| `prompts/` | 运行时 prompt 文件 |
| `sql/` | 初始化 schema 和种子 SQL |
| `docs/` | 设计文档（实施前必须编写） |
| `.config/` | 本地配置、数据、模板、锁、产物 |

---

## 模块详解

### 内核层

**路径**：`src/kernel/`

| 文件 | 职责 |
|------|------|
| `agent.runtime.service.ts` | `@Service()` 编排完整 turn loop：用户输入 → 意图分析 → 上下文构建 → 模型调用 → 工具执行循环 → 结果持久化 |
| `agent.runtime.types.ts` | `AgentTurnInput`、`AgentTurnResult`、`AgentRuntimeOptions` |
| `model.provider.ts` | `ModelProvider` 接口 + `OpenAICompatibleModelProvider` 实现（SSE 流式 + 工具调用解析） |
| `kernel.module.ts` | `@Module` 组装所有子系统 |

**Turn 流程**：
```
用户消息 → 写入 memory + brain
         → ContextIntentAnalyzerComponent.analyze() → 模型决策路由
         → ContextBuilderService.build() → 组装模型上下文
         → OpenAICompatibleModelProvider.stream() → LLM 流式响应
         → 工具调用循环（最多 maxToolSteps 步）
         → 最终回答写入 memory + brain
         → 恢复状态更新
```

### 信号血管层

**路径**：`src/signal/`

| 文件 | 职责 |
|------|------|
| `signal.bus.service.ts` | `@Service()` SignalBus——subscribe、emit、ask、complete、final、fail、timeout |
| `signal.types.ts` | `SignalHandler`、`SignalResult`、`SignalLifecyclePayload`、`SignalSubscription`、`SignalAskOptions` |
| `signal.module.ts` | `@Module` 提供并导出 SignalBus |

**关键概念**：
- `emit(signal, payload)`：广播事件给所有订阅者
- `ask(signal, payload)`：Guard 式询问，返回 boolean（用于 Confirm）
- `complete/final/fail/timeout`：生命周期事件包装
- SignalBus 不依赖 RxJS——所有新系统的 RxJS 封装在各自服务内部

### DI 系统

**路径**：`src/di/`

| 文件 | 职责 |
|------|------|
| `decorators.ts` | 项目自有装饰器：`@Module`、`@Service`、`@Component`、`@Repo`、`@Plugin`、`@Inject`、`@Prompt`、`@Subscribe` |
| `container.ts` | `Container` 单例解析 + `createContainer()` 模块树引导 |
| `registry.ts` | `DecoratorRegistry`——WeakMap 存储装饰器元数据 |
| `types.ts` | `Constructor`、`InjectionToken`、`ProviderKind`、`ModuleOptions` 等 |

**装饰器说明**：
- `@Service()`：业务流程、编排类
- `@Component()`：基础设施类（数据库、记忆、压缩器）
- `@Repo()`：数据模型和 SQL 操作类
- `@Plugin()`：外部插件适配器
- `@Inject(token)`：显式属性注入
- `@Prompt(relativePath)`：注入 prompt 文本
- `@Subscribe(signalName)`：SignalBus 自动订阅

### 记忆层

**路径**：`src/memory/`

| 文件 | 职责 |
|------|------|
| `memory.component.ts` | `@Component()` MemoryComponent——热路径 `memory.db` 管理 |
| `memory.types.ts` | `MemoryChunk`、`MemoryFact`、`MemoryClaim`、`MemoryDecision`、`MemoryTask`、`MemoryEntity`、`MemoryRelation`、`MemoryRecallResult`、`MemoryRecallOptions` 等 |
| `memory.module.ts` | `@Module` 导入 ConfigModule，提供 MemoryComponent 和 SqliteVecLoader |
| `sqlite.vec.loader.ts` | SqliteVecLoader——从 vendored dylib 加载 sqlite-vec 扩展 |

**数据库表**：conversations、messages、context_checkpoints、memory_documents、memory_chunks、memory_entities、memory_relations、memory_edges、memory_facts、memory_claims、memory_decisions、memory_tasks、memory_artifacts、memory_retrieval_traces、memory_recovery_state、memory_jobs、memory_vectors（vec0 虚拟表）

**召回策略**：
- `treeRecall()`：向量 + 词法 + 事实 + 图遍历的混合召回
- `recall()`：简化接口，供 ContextBuilder 使用
- `recallFacts()`：结构化事实召回
- 所有召回结果附带 provenance 和 diagnostics

### 审计层

**路径**：`src/brain/`

| 文件 | 职责 |
|------|------|
| `brain.component.ts` | `@Component()` BrainComponent——月度 `YYYY-MM.brain.db` 管理 |
| `brain.types.ts` | `BrainTurnInput`、`BrainMessageInput`、`BrainEventInput`、`BrainToolCallInput`、`BrainRecoveryReport` 等 |
| `brain.module.ts` | `@Module` 导入 ConfigModule，提供 BrainComponent |

**数据库表**：brain_runtime_sessions、brain_turns、brain_messages、brain_events、brain_tool_calls、brain_subagents、brain_artifacts、brain_recovery_points

**恢复机制**：
- `scanRecovery()`：扫描中断的 turns 和 tool calls
- `markInterruptedWork()`：标记未完成工作
- `recordRecoveryPoint()`：关键操作前后写入恢复点

### 上下文层

**路径**：`src/context/`

| 文件 | 职责 |
|------|------|
| `context.builder.service.ts` | `@Service()` ContextBuilderService——组装无会话模型上下文 |
| `context.intent.analyzer.component.ts` | `@Component()` ContextIntentAnalyzerComponent——模型支持的 turn 决策 |
| `context.compressor.component.ts` | `@Component()` ContextCompressorComponent——锚定摘要压缩 |
| `context.types.ts` | `TurnCluePacket`、`ContextIntentDecision`、`ContextBuildResult`、`TurnDecisionMode` 等 |
| `context.module.ts` | `@Module` 导入 ConfigModule、MemoryModule |

**Turn 决策模式**：
- `direct_reply`：无需工具或历史上下文
- `clarify_reference`：用户可能引用先前工作但线索包不明确
- `continue_task`：知识树候选明确标识了先前任务
- `investigate`：只读项目证据收集
- `code`：需要代码或文件更改
- `memory_answer`：答案应基于记忆或知识树
- `refuse_or_block`：不安全或不可能的请求

**上下文源组**：current_user、recent_messages、checkpoint、memory_recall、structured_facts、knowledge_tree、runtime

**工具可见性组**：read_only、memory_read、memory_write、shell、edit、workmux、context、codegraph

### 工具系统

**路径**：`src/tools/`

| 文件 | 职责 |
|------|------|
| `registry.ts` | ToolRegistry——工具注册、列出、执行（含输入验证） |
| `tool.types.ts` | `Tool`、`ToolDefinition`、`ToolSchema`、`ToolContext`、`ToolResult`、`ToolExecutionMetadata` 等 |
| `tool.module.ts` | `@Module` 导入 MemoryModule、SignalModule |
| `adapters.ts` | CodeGraphTool、ContextCompactTool、TaskTool 适配器 |
| `file.tools.ts` | ReadTool、WriteTool、EditTool、MultiEditTool、GlobTool、GrepTool |
| `shell.tool.ts` | ShellTool——shell 命令执行 |
| `git.tool.ts` | GitTool——git 命令 |
| `memory.tools.ts` | MemoryRecallTool、MemoryStoreTool、MemoryForgetTool |
| `artifact.writer.component.ts` | ArtifactWriterComponent——原始工具产物持久化 |

**内置工具**（14 个）：
- 文件：read、write、edit、multi_edit、glob、grep
- 系统：shell、git
- 记忆：memory_recall、memory_store、memory_forget
- 上下文：context_compact
- 协作：task（workmux 任务请求）
- 代码智能：codegraph

**执行元数据**：
- `mutability`：read-only / mutating
- `concurrency`：concurrent / serial

### 插件系统

**路径**：`src/plugins/`

| 文件 | 职责 |
|------|------|
| `plugin.module.ts` | `@Module` 导入 ConfigModule，提供插件注册表、安装器、外部命令适配 |
| `plugin.registry.component.ts` | PluginRegistryComponent——插件发现和注册 |
| `plugin.installer.component.ts` | PluginInstallerComponent——git clone / 本地复制安装 |
| `external.command.plugin.component.ts` | ExternalCommandPluginComponent——外部命令插件适配 |
| `builtin.plugins.ts` | CodeGraphPlugin、RtkPlugin——内置外部插件适配器 |
| `rtk.command.filter.component.ts` | RtkCommandFilterComponent——RTK 输出压缩 |
| `plugin.types.ts` | `PluginManifest`、`PluginAvailability`、`PluginInstallResult`、`PluginProvider` 等 |

**内置外部插件**：
- **CodeGraph**：代码知识图谱（tree-sitter AST 索引），用于结构化代码查询
- **RTK**：命令输出压缩，过滤噪声

### Prompt 协议层

**路径**：`src/prompts/`

| 文件 | 职责 |
|------|------|
| `prompt.registry.service.ts` | `@Service()` PromptRegistryService——统一 prompt 加载、缓存、模板变量解析 |
| `prompts.types.ts` | `PromptProtocol`、`PromptTemplateContext` |
| `prompts.module.ts` | `@Module` 导入 ConfigModule |

**模板变量**：`{{WORKSPACE_ROOT}}`、`{{AVAILABLE_TOOLS}}`、`{{MAX_STEPS}}`、`{{PARENT_TASK}}`、`{{CURRENT_DATE}}`

**协议注册**：13 个 prompt 协议条目，覆盖 system、intent、worker、crystal、blackboard、forgetting、sandbox 所有系统。

### Agent Worker 系统

**路径**：`src/worker/`

| 文件 | 职责 |
|------|------|
| `worker.service.ts` | `@Service()` WorkerService——多 Agent 并发/排队引擎 |
| `worker.types.ts` | `WorkerSpawnPayload`、`WorkerCompletedPayload`、`WorkerRunContext` 等 |
| `worker.module.ts` | `@Module` 导入 BrainModule、ConfigModule、MemoryModule、PromptsModule、SignalModule、ToolModule |

**Agent Profiles**（在 `config.jsonc` 中配置）：
- `explore`：只读探索，工具 read/glob/grep/codegraph/memory_recall
- `discuss`：多角度讨论，仅 memory_recall
- `investigate`：深度调查，包含 shell 用于测试验证
- `code`：编码执行，包含全部读写/编辑/shell 工具
- `general`：通用混合任务

**并发控制**：
- `maxConcurrent`（默认 4）：最大并发 Worker
- 超出的请求排队（FIFO）
- Worker 超时保护（默认 300 秒）
- 独立 LLM 会话 + 过滤后的工具集

**Worker 生命周期**：
```
worker.spawn → queued（若满） → started → [step loop] → completed/failed
                                              │
                                    worker.result.injected → 父 turn
```

### Sandbox 守卫

**路径**：`src/sandbox/`

| 文件 | 职责 |
|------|------|
| `sandbox.guard.service.ts` | `@Service()` SandboxGuard——RxJS-ready 风险分级侦查者 |
| `sandbox.types.ts` | `SandboxInspection`、`SandboxPattern`、`SandboxAnomaly`、`SandboxEscalation` |
| `sandbox.module.ts` | `@Module` 导入 SignalModule、ConfigModule、MemoryModule |

**风险分级**：
| 级别 | 工具 | 分数 | 行为 |
|------|------|------|------|
| low | read, glob, grep, codegraph, memory_recall, memory_store, git | 0.1 | 自动批准 |
| medium | write, edit, multi_edit | 0.5 | 升格为 ASK |
| high | shell, bash, exec | 0.9 | 自动拒绝（异常分数 > 0.5） |

**Confirm ≠ ASK**：SandboxGuard 处理工具级 Confirm（`guard.ask`），无法判断时升格为 ASK 交由 CrystalService 处理。

**模式学习**：所有 guard 结果持久化为 `namespace='sandbox'` 的 MemoryFact，形成自动判断规则。

### Scope 系统

**路径**：`src/scope/`

| 文件 | 职责 |
|------|------|
| `scope.service.ts` | `@Service()` ScopeService——关键词检测、回忆模式、候选提名 |
| `scope.store.component.ts` | `@Component()` ScopeStore——`scope.db` 管理（带 sqlite-vec） |
| `scope.types.ts` | `ScopeRecord`、`ScopeInput`、`ScopeDetectedPayload`、`ScopeCandidatePayload` 等 |
| `scope.module.ts` | `@Module` 导入 MemoryModule、SignalModule、ConfigModule |

**Scope 记忆路径**：Scope 记忆写入 MemoryComponent（B 路径），走现有 `treeRecall` 自然召回。

**Codename 候选 → 升格流程**：
```
用户频繁提及（30 天内 ≥ 5 次）
  → scope.candidate.nominated
  → ASK（由 CrystalService 生成）
  → 用户确认
  → scope.created（scope.db 初始化 + 历史记忆镜像）
```

**回忆中模式**：
```
检测到 Scope 关键词
  → scope.activated + scope.recall_mode.started
  → 后续 3 个 turn 注入 Scope 宪法摘要
  → 话题切换 → scope.recall_mode.ended
```

### Crystal 晶体智力

**路径**：`src/crystal/`

| 文件 | 职责 |
|------|------|
| `crystal.service.ts` | `@Service()` CrystalService——ASK 生命周期、候选追踪、Gem 匹配 |
| `crystal.store.component.ts` | `@Component()` CrystalStore——`crystal.db` 管理（带 sqlite-vec） |
| `crystal.types.ts` | `AskPayload`、`AskQuestion`、`AskOption`、`CrystalCandidate`、`CrystalGem`、`EqAdjustment` |
| `crystal.module.ts` | `@Module` 导入 MemoryModule、SignalModule、ConfigModule |

**ASK 由 LLM 生成**：ASK JSON 通过 `prompts/ask.schema.md` 提示词工程驱动，不硬编码在 TypeScript 中。

**结晶候选 → Gem 升格**：
```
ASK 被回答
  → 提取 pattern_key（namespace:subject:predicate → sha256）
  → 新候选：crystal.candidate.formed
  → 已有候选：crystal.candidate.reinforced（hit_count++）
  → hit_count >= 3：crystal.candidate.ready
  → LLM 自我总结 → crystal.gem.elevated
  → Gem 存入 crystal.db（向量索引）
```

**Gem 匹配**：每个 turn 开始时，CrystalService 将当前意图特征 embed 后在 crystal_vectors 中搜索匹配 Gem，匹配到的 Gem 的 prompt_template 注入上下文。

**EQ 调节维度**：
- `ask_frequency`：ASK 频率倾向
- `clarify_before_act`：操作前澄清倾向
- `delegate_to_worker`：委托 Worker 倾向

### Forgetting 遗忘系统

**路径**：`src/forgetting/`

| 文件 | 职责 |
|------|------|
| `forgetting.service.ts` | `@Service()` ForgettingService——艾宾浩斯衰减 + 周期扫描 |
| `forgetting.types.ts` | `ForgettingCycleStarted`、`ForgettingChunkCompacted`、`ForgettingGemDrifted` 等 |
| `forgetting.module.ts` | `@Module` 导入 MemoryModule、SignalModule、ConfigModule |

**遗忘曲线模型**：`strength = 1 / (1 + ageHours / 24)`

| 年龄 | 强度 | 操作 |
|------|------|------|
| < 1h | 1.0 → 0.96 | 无 |
| 1h – 24h | 0.96 → 0.50 | 重要性微调 |
| 1d – 7d | 0.50 → 0.22 | LLM 压缩为摘要 |
| 7d – 30d | 0.22 → 0.03 | 深度压缩 + 漂移 |
| > 30d | < 0.03 | 仅保留摘要，原文在 brain.db |

**两种遗忘模式**：
- **热记忆衰减**：Chunk 重要性随时间降低，低重要性 Chunk 被 LLM 压缩为摘要
- **晶体记忆偏移**：Gem 语义随时间发生微小偏移，由 LLM 执行漂移

**触发方式**：定时周期（默认每小时）+ 上下文压缩后（debounce 5s）+ 恢复扫描后

### 配置系统

**路径**：`src/config/`

| 文件 | 职责 |
|------|------|
| `config.service.ts` | `@Component()` ConfigService——JSONC 解析 + Hermes 兼容 provider 规范化 + env 合并 |
| `config.types.ts` | `FlyflorConfig`、`ConfigPaths`、`ModelConfig`、`AgentsConfig`、`AgentProfileConfig` 等 |
| `config.module.ts` | `@Module` 提供 ConfigService 和 TemplateLoaderComponent |
| `template.loader.component.ts` | `@Component()` TemplateLoaderComponent——加载 `.config/templates` 下的宪法模板 |

**配置段**：paths、runtime、socket、prompts、model、providers、memory、context、tools、plugins、agents

### 共享工具

**路径**：`src/shared/`

| 文件 | 职责 |
|------|------|
| `path.ts` | `ProjectPaths`——项目相对路径解析和目录创建 |
| `runtime.ts` | `RuntimeStatus`——最小启动状态描述 |

### 数据实体

**路径**：`src/entities/`

| 文件 | 职责 |
|------|------|
| `entities.module.ts` | `@Module({})` 占位模块——`@Repo()` 类未来在此注册 |

### WebSocket 适配

**路径**：`src/socket/`

| 文件 | 职责 |
|------|------|
| `socket.server.service.ts` | `@Service()` SocketServerService——Bun 原生 WebSocket 适配器 |
| `socket.types.ts` | `SocketEnvelope`、`ChatMessagePayload`、`SocketServerOptions` |
| `socket.module.ts` | `@Module` 导入 ConfigModule、KernelModule |

**协议**：JSON 信封 `{ id, type, payload, timestamp }`，`/ws` 路径升级 WebSocket，`/socket-test.html` 提供调试页面。

**广播信号**：60+ 类型，覆盖 chat、memory、model、context、plugin、tool、guard、recovery、worker、sandbox、scope、crystal、forgetting 全部系统。

---

## 信号总览

### 内核信号

`chat.delta`、`chat.final`、`chat.message`、`agent.error`

### 记忆信号

`memory.store`、`memory.recall`、`memory.fact.stored`

### 模型信号

`model.reasoning`、`model.tool_call`

### 上下文信号

`context.ready`、`context.compacted`、`context.intent`、`turn.decision.completed`、`turn.clue_packet.created`

### 插件信号

`plugin.availability`、`plugin.diagnostic`、`plugin.unavailable`、`plugin.failed`

### 工具信号

`tool.call`、`tool.started`、`tool.result`、`tool.completed`、`tool.failed`、`tool.error`、`tool.artifact`、`tool.denied`

### 守卫信号

`guard.ask`、`guard.answer`

### 恢复信号

`recovery.scan`

### 协作信号

`workmux.task.requested`

### Worker 信号

`worker.spawn`、`worker.started`、`worker.step`、`worker.completed`、`worker.failed`、`worker.queued`、`worker.result.injected`

### Sandbox 信号

`sandbox.inspected`、`sandbox.approved`、`sandbox.denied`、`sandbox.escalated`、`sandbox.pattern.learned`、`sandbox.anomaly.detected`

### Scope 信号

`scope.detected`、`scope.activated`、`scope.deactivated`、`scope.candidate.nominated`、`scope.created`、`scope.recall_mode.started`、`scope.recall_mode.ended`

### Crystal 信号

`crystal.ask.created`、`crystal.ask.answered`、`crystal.ask.resolved`、`crystal.ask.timeout`、`crystal.candidate.formed`、`crystal.candidate.reinforced`、`crystal.candidate.ready`、`crystal.gem.elevated`、`crystal.gem.loaded`、`crystal.gem.applied`、`crystal.gem.expired`、`crystal.eq.adjusted`

### Forgetting 信号

`forgetting.cycle.started`、`forgetting.chunk.compacted`、`forgetting.chunk.faded`、`forgetting.fact.aged`、`forgetting.gem.drifted`、`forgetting.cycle.completed`、`forgetting.schedule.adjusted`

---

## 配置文件

- **`.config/config.jsonc`**：单文件配置源（paths、runtime、socket、prompts、model、providers、memory、context、tools、plugins、agents）
- **`.config/templates/`**：宪法模板（SOUL.md、USER.md、MEMORY.md）
- **`.config/memory/`**：memory.db、memory/wiki/、memory/artifacts/
- **`.config/brain/`**：月度 `YYYY-MM.brain.db`、brain/artifacts/
- **`.config/sqlite-vec/`**：vendored 平台特定 dylib（macOS x64/arm64、Linux x64/arm64、Windows x64）
- **`.config/scope/`**：Scope 宪法数据库
- **`.config/crystal/`**：Crystal 向量数据库
- **`.config/plugins/`**：插件清单和运行时状态
- **`.config/codegraph/`**：CodeGraph 缓存和索引
- **`.config/runtime/`**：运行时锁和临时状态
- **`.config/web/`**：WebSocket 调试页面

**Agent 配置段**（新增）：

```jsonc
"agents": {
    "profiles": {
        "explore": { /* 只读探索 agent */ },
        "discuss": { /* 讨论 agent */ },
        "investigate": { /* 调查 agent */ },
        "code": { /* 编码 agent */ },
        "general": { /* 通用 agent */ }
    },
    "defaults": {
        "maxConcurrent": 4,    // 最大并发 Worker
        "maxSteps": 8,         // 默认工具调用步数
        "timeoutSeconds": 300  // Worker 超时
    }
}
```

---

## SQL Schema

| 文件 | 数据库 | 用途 |
|------|--------|------|
| `sql/memory-schema.sql` | `memory.db` | 热记忆——17 张表 + vec0 虚拟表 |
| `sql/brain-schema.sql` | `YYYY-MM.brain.db` | 全量审计——8 张表，按月轮换 |
| `sql/scope-schema.sql` | `scope.db` | Scope 宪法层——4 张表 + vec0 虚拟表 |
| `sql/crystal-schema.sql` | `crystal.db` | 晶体智力——4 张表 + vec0 虚拟表 |

---

## Prompt 文件

| 文件 | 系统 | 用途 |
|------|------|------|
| `prompts/system.md` | kernel | 运行时系统 prompt |
| `prompts/intent.md` | context | Turn 决策 prompt |
| `prompts/ask.schema.md` | crystal | ASK JSON schema——LLM 输出格式定义 |
| `prompts/agent-explore.md` | worker | Explore 子代理 prompt |
| `prompts/agent-discuss.md` | worker | Discuss 子代理 prompt |
| `prompts/agent-code.md` | worker | Code 子代理 prompt |
| `prompts/agent-general.md` | worker | General 子代理 prompt |
| `prompts/agent-investigate.md` | worker | Investigate 子代理 prompt |
| `prompts/crystal-gem-summarize.md` | crystal | Gem 总结 prompt |

每个 `.md` 需要匹配的 `.zh.cn.md` 中文镜像（人力维护，runtime 不加载）。

---

## 设计文档

### 现有系统
| 文档 | 内容 |
|------|------|
| `docs/agent-runtime-overview.md` | Agent 运行时架构概述 |
| `docs/no-session-coding-agent.md` | 无会话编码代理设计 |
| `docs/turn-decision-clue-packet.md` | Turn 决策线索包 |
| `docs/context-memory-compaction.md` | 上下文记忆压缩 |
| `docs/tool-runtime.md` | 工具运行时 |
| `docs/coding-agent-research.md` | Coding agent 调研 |
| `docs/evaluation-protocol.md` | 评估协议 |
| `docs/signal-di-lifecycle.md` | Signal + DI 生命周期 |
| `docs/plugin-system.md` | 插件系统 |
| `docs/plugin-auto-install.md` | 插件自动安装 |
| `docs/workmux-plan.md` | Workmux 计划 |
| `docs/closed-loop-implementation-plan.md` | 闭环实施计划 |
| `docs/reference-agent-evidence.md` | 参考 Agent 证据 |

### 新系统
| 文档 | 内容 |
|------|------|
| `docs/prompts-protocol-layer.md` | 统一 Prompt 协议层设计 |
| `docs/agent-worker-system.md` | 多 Agent Worker 系统设计 |
| `docs/sandbox-guard.md` | RxJS Sandbox 守卫设计 |
| `docs/scope-system.md` | Scope 宪法层设计 |
| `docs/crystal-system.md` | Crystal 晶体智力设计 |
| `docs/forgetting-system.md` | 遗忘系统设计 |
| `docs/implementation-plan.md` | 实施计划 |

---

## 安装与运行

```bash
# 安装
bun install

# 运行（thin entrypoint）
bun run src/index.ts

# 启动 WebSocket 服务
bun run src/index.ts --serve
# → socket-ready url=http://127.0.0.1:17361

# WebSocket 调试页面
# 浏览器打开 http://127.0.0.1:17361/socket-test.html
```

**环境变量**：创建项目根目录 `.env` 文件配置 LLM API key：

```env
DEEPSEEK_API_KEY=sk-xxx
```

---

## 测试

所有场景测试使用配置的真实 LLM provider，不使用 mock/fake/stub：

```bash
# 类型检查
bunx tsc --noEmit

# 核心场景测试
bun test tests/scenario/no.session.agent.test.ts
bun test tests/scenario/memory.vector.tree.test.ts

# Provider 测试（需要真实凭据）
bun test tests/scenario/deepseek.inner.test.ts
bun test tests/scenario/deepseek.full.test.ts

# DI + Signal 生命周期测试
bun test tests/scenario/signal.di.lifecycle.test.ts

# WS 服务系统测试（新增）
bun test tests/scenario/ws-services.test.ts

# 全量测试
bun test
```

**测试覆盖**：
- `no.session.agent.test.ts`：无会话连续性、工具执行、项目检查、Brain 审计、恢复
- `memory.vector.tree.test.ts`：记忆向量树召回
- `deepseek.inner.test.ts`：DeepSeek provider 集成
- `deepseek.full.test.ts`：全链路 DeepSeek 场景
- `signal.di.lifecycle.test.ts`：SignalBus + DI 容器生命周期
- `ws-services.test.ts`：SandboxGuard、WorkerService、ScopeService、CrystalService、ForgettingService（24 个测试用例）
