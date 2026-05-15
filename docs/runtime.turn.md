# 单轮请求流程

## 一句话定位

`RuntimeModule.handleMessage` 是热路径唯一入口；从 Gateway 归一化消息到回复落盘、记忆写入、后台反思的全过程都在这里编排。

## 相关代码路径

- `src/agent/runtime/runtime.module.ts` — 热路径主入口
- `src/agent/runtime/fast.route.ts` — 资源指标短路
- `src/agent/runtime/blackboard.route.ts` — LLM 路由模板调用
- `src/agent/runtime/route.escalation.ts` — direct-with-watch 升级器
- `src/agent/runtime/reflection.worker.ts` — 反思调度 worker
- `src/agent/runtime/perf.metrics.ts` — 性能事件采集
- `src/agent/runtime/chat.ts` — TTY 交互入口
- `src/neural/memory/index.ts` — `MemoryModule.buildPrompt` / `rememberTurn`
- `src/agent/mcp/tool.calls.ts` — `<flyflor_mcp_calls>` 解析

## 核心阶段

```mermaid
flowchart TB
    A["GatewayMessage 入站"] --> B["RuntimeModule.handleMessage"]
    B --> C["嵌入向量计算<br/>LocalHashEmbeddingProvider.embed"]
    C --> D["fastRoute 评估<br/>token / hint / cosine"]
    D --> E{"fastRoute 命中？"}
    E -- 是 --> F["buildBypassDecision direct"]
    E -- 否 --> G["decideBlackboardRoute<br/>调 LLM 走 blackboard.route.md"]
    F --> H["loadSkills / loadMcpServers / buildPrompt 并发"]
    G --> H
    H --> I["applyRouteEscalation<br/>watch / failure 计数升级"]
    I --> J{"模式"}
    J -- direct --> M["拼 system prompt"]
    J -- direct-with-watch --> M
    J -- blackboard --> K["BlackboardModule.startTurn"]
    K --> L["BlackboardModule.runUntilConverged"]
    L --> AskGate{"NeedsUser / hard cap?"}
    AskGate -- 是 --> Ask["runtime 合成 AgentAsk<br/>reason=blackboard-stalemate"]
    AskGate -- 否 --> M
    M --> N["buildMcpToolCatalog<br/>TTL 30s 缓存"]
    N --> O["model.generate 首轮"]
    O --> P{"含 flyflor_mcp_calls？"}
    P -- 是 --> Q["执行工具 + 结果回灌"]
    P -- 否 --> R["流式输出最终回复"]
    Q --> R
    R --> Parse["剥离 memory_actions / ghost_decisions / identity / ask"]
    Parse --> S["GatewayReply 返回调用方"]
    Ask --> S
    S --> T["rememberTurn / recordSkillUsage<br/>aware-of-await"]
    T --> U["ReflectionWorker.dispatch 后台 fire-and-forget"]
    T --> V["classifyAndApplyFeedback 后台"]
    T --> W{"黑板收敛？"}
    W -- 是 --> X["recordDebateEpisode"]
    T --> Y["更新 fastRouteSnapshots"]
```

## fastRoute（资源指标短路）

只允许三类指标，未命中才调路由 LLM：

| 指标 | 命中条件 | 阈值 |
| --- | --- | --- |
| token 预算 | `estimatedTokens < routeBypassTokenBudget` | 配置 |
| hint 复用 | `nextRouteHint === direct` 且 `now - recordedAt < routeHintTtlMs` | 配置 |
| embedding 相似 | `lastMode === direct` 且 `cosine > similarityBypassThreshold` | 配置 |

落库的 `FastRouteSnapshot`（按 `channel:chatId:userId` 维度）会在 turn 末尾更新：

```ts
interface FastRouteSnapshot {
    recordedAt: number;
    embedding?: number[];
    lastMode: BlackboardMode;
    nextRouteHint?: BlackboardMode;
    consecutiveWatchTurns?: number;
    consecutiveBlackboardFailures?: number;
    consecutiveToolFailureTurns?: number;
}
```

## Blackboard route（LLM 决策）

`templates/prompts/blackboard.route.md` 必须返回结构化 JSON：

```json
{
  "mode": "direct | direct-with-watch | blackboard",
  "score": 0.0,
  "reason": "...",
  "signals": ["..."],
  "needsReflectionCandidate": true,
  "blackboardContract": { "evidence": [], "contradictions": [], "mode": "normal" },
  "workers": [{ "role": "...", "stage": "...", "handoff": "...", "capabilities": [], "dependsOn": [] }]
}
```

代码只做 `mode` 枚举校验、`score` 数值范围、`workers` 数量 `<= 5`，不二次解析自然语言。

## 路由升级

```mermaid
stateDiagram-v2
    [*] --> direct
    direct --> direct: 默认
    direct --> watch: LLM 升级
    watch --> watch: 连续命中
    watch --> blackboard: consecutiveWatchTurns >= watchThreshold
    direct --> blackboard: consecutiveBlackboardFailures >= failureThreshold
    blackboard --> blackboard: status = converged → 清零
    blackboard --> direct: status = needs-user/failed → failure++
```

阈值来自 `RoutingConfig`：`watchEscalationThreshold`（默认 3）、`blackboardFailureEscalationThreshold`（默认 2）。任一为 0 表示禁用该通道。

## 上下文装配（`MemoryModule.buildPrompt`）

```mermaid
flowchart LR
    Q[GatewayMessage] --> Markdown[MarkdownMemoryStore.snapshot<br/>SELF/SOUL/USER/MEMORY]
    Q --> Brain[BrainStore<br/>brain event prompt recall + ask/ghost/identity/codename/eq state]
    Q --> Hippo[Hippocampus context<br/>MemoryComponent local ring]
    Q --> Project[ProjectMemoryStore.snapshot<br/>项目局部记忆]
    Q --> Crystal[CrystalMemoryService.recall<br/>CrystalComponent Gem]
    Q --> SqliteSearch[SQLiteMemoryStore.search]
    Markdown --> Render[renderMemoryPrompt]
    Brain --> Render
    Brain --> Nudge[continuation / ghost-hint / identity / eq / dormant resume]
    Nudge --> Render
    Hippo --> Render
    Project --> Render
    Crystal --> Render
    SqliteSearch --> Render
    Render --> Prompt[memoryContext 字符串]
```

输出后用 `renderRuntimeSystemPrompt` 拼接，注入：

- `sandboxSummary`：当前 sandbox 模式描述
- `memoryContext`：上面的合成 prompt
- `memoryActionInstructions`：`memory.action.md`
- `skillContext`：`renderSkillContextPrompt`
- `selectedSkills` 的自动池已经吃到 runtime 预计算 embedding，但仍只按资源指标做排序，不碰自然语言启发式
- `mcpContext`：`renderMcpContextPrompt`（含可用工具 catalog）
- `blackboardContext`：`renderBlackboardAdvisoryPrompt`
- `askSchemaInstructions`：Ask / Ghost / Identity 结构化块协议

Ghost Context 不是普通 retrieved memory：active / resumed ghost 通过 `[ghost-hint]` 单独进入 prompt，模型用结构化 `resume` / `fork` / `fresh` 决策让分支继续、降权或回到主线。

RuntimeModule 另外暴露 `listChatHistory(userId, options)` 给 chat TUI 做 out-of-band 历史回放；这条路径只读 `brain.db` 事件，不进入 prompt 装配。

## MCP 工具循环

```mermaid
sequenceDiagram
    participant RT as RuntimeModule
    participant LLM as ModelClient
    participant Sandbox as SandboxPolicy
    participant Cat as McpCatalogCache
    participant MCP as MCP server

    RT->>Sandbox: decideCapabilityExecution(McpTool)
    Sandbox-->>RT: canExecute / requiresApproval
    RT->>Cat: buildMcpToolCatalog(servers)
    Cat->>MCP: tools/list (cache TTL 30s)
    MCP-->>Cat: tool defs
    Cat-->>RT: McpToolCatalogEntry[]
    RT->>LLM: model.generate(messages)
    LLM-->>RT: 首轮含 <flyflor_mcp_calls> JSON?
    alt 有
        RT->>RT: parseMcpToolCalls
        loop 每个 call
            RT->>Sandbox: ask 审批（如需要）
            Sandbox-->>RT: allow / deny
            alt allow
                RT->>MCP: tools/call
                MCP-->>RT: McpCallResult
            else deny
                RT->>RT: 记录 SandboxToolApprovalDenied
            end
        end
        RT->>LLM: model.generate(messages + tool 结果)
        LLM-->>RT: 终稿
    else 无
        LLM-->>RT: 直接终稿
    end
```

## 记忆写回（`rememberTurn`）

同步落库 + 异步管道，全部必要写入完成后才结束 `rememberTurn`：

```mermaid
flowchart LR
    Action[memory_actions JSON] --> Cand[candidates 构造]
    Action --> Codename[codename 写 brain.codenames<br/>inbox projectId 命名空间化]
    Action --> Eq[eq 写 memory_eq_state]
    Action --> Trig[detectExplicitIntent → ProjectTrigger]
    Action --> Imp[importanceFromActions]
    Ask[AgentAsk?] --> BrainAsk[ask / ask-answer-pair 事件]
    Imp --> WorkEp[writeEpisodeToWorkingMemory<br/>metadata.brainEventId]
    Trig --> ScaffoldP[ProjectScaffolder]
    Cand --> SqliteCand[sqlite.addCandidate<br/>autoPromote 时直接 markdown 写入]
    Trig --> ProjectMem[ProjectMemoryStore.recordTurn<br/>显式意图通道]
    Action --> BrainEvent[BrainStore.appendEvent<br/>brain.db memory_events + content.atoms]
    Cand -.-> CrystalAsync[CrystalMemoryService.recordTurn]
```

随后 fire-and-forget 启动：

- `ReflectionWorker.dispatch` — LLM 抽取 symbols/bucket/coordinates → `MemoryModule.applyReflection` → Crystal 候选
- `classifyAndApplyFeedback` — A/B/C/D 分类，由模型 JSON 驱动；Preference / GlobalStrategy / 部分 correction/confirmation 已接入记忆事件
- 收敛黑板 → `recordDebateEpisode` 高权重 episode
- MCP 工具失败 → `ghost-context`，process restart → warmup 恢复 ghost

## 性能事件

| 事件 | 含义 |
| --- | --- |
| `perf.ttfb` | 首字延迟（目标 < 350ms） |
| `perf.build_prompt` | 上下文装配耗时 |
| `perf.route_llm` | 路由阶段总耗时（含 bypass） |
| `perf.fast_route_evaluated` | fastRoute 决策记录 |

## 关键数据结构

```ts
interface RuntimeContext {
    requestId: string;
    now: string;            // ISO timestamp
    embedding?: number[];   // 由 handleMessage 计算并下发
    skillNames?: string[];  // CLI --skills 透传
    // ...
}

interface GatewayReply {
    messageId: string;
    route: GatewayRoute;
    text: string;
    metadata: {
        blackboard?: { turnId, mode, status, elapsedMs, ... };
        memoryActions: number;
        mcpToolCalls: number;
        mcpToolExecutions: Array<{ server, tool, ok, ... }>;
        skills: string[];
        sandboxMode: SandboxMode;
        // ...
    };
}
```

## 配置与约束

- `config.routing.fastRouteEnabled` 控制资源短路总开关。
- `config.routing.routeHintTtlMs` / `similarityBypassThreshold` / `routeBypassTokenBudget` 控制短路命中阈值。
- `config.memory.embedding.dimensions` 决定 embedding 向量长度；`LocalHashEmbeddingProvider` 不联网。
- `config.metrics.enabled` 关闭时所有 perf 事件不发布。

## 运行边界 / 后续增强

- `RuntimeModule` 已拆 phase，但工具循环、结构化块解析、persist 副作用仍在同一文件，后续可继续抽 service。
- `brain.db` 已成为 prompt recall / turn event write / inbox 可视化权威；working-memory episode 通过 `metadata.brainEventId` 回连 brain atom，后续改动必须避免新增 sidecar 事件库回到 prompt path。
- direct-with-watch 已加入工具失败 / 上下文压力资源指标，但仍是轻量计数器，不消费 worker 内部复杂信号。
- `fastRouteSnapshots` 默认走进程内 Map；多副本共享快照后续应走独立 cache component，不再把工作记忆后端当作公共缓存。
- 行为演化已写入 `behavior-snapshot` / `behavior-correction`，ask / answer / snapshot 通过同一个 `snapshotId` 回挂；后续重点是围绕这些证据做诊断展示。

## 相关测试

- `tests/runtime.perf.test.ts`
- `tests/route.escalation.test.ts`
- `tests/chat.boundaries.test.ts`
- `tests/feedback.wire.test.ts`
- `tests/memory.scheduler.wiring.test.ts`
