# Blackboard 多 Worker 设计

本文把 [DESIGN.md](../DESIGN.md) 中的黑板协作思想落到当前 Bun/TypeScript + DI/Protocol 架构。这里记录已经收口的黑板基线、外部 worker 协议边界和后续增强顺序。

当前实现状态：已落地 `src/agent/blackboard` 边界模块、SQLite turn/step/decision/lease/message transcript、`src/agent/worker` WorkerManager/Pool、动态 `WorkerAdapter` 对接层、`json-process` / `persistent-json-process` 外部 worker 协议、黑板事件枚举和 `FlyFlor` 显式 DI 注入。`RuntimeModule` 已通过 `templates/prompts/blackboard.route.md` 启用 `direct` / `direct-with-watch` / `blackboard` 判断；路由语义由模型按模板返回结构化 JSON，源码只校验 mode、score、signals 和 worker plan，不维护业务关键词表、固定分类桶或固定角色目录。worker 选择必须是模型按当前请求做的角色竞价/博弈结果：谁提方案、谁挑战、谁验证都由任务语义决定，不能靠固定名单硬写。无法回答的问题会先判断黑板是否能整理 blocker、替代路径或安全交还用户；需要交还时仍由黑板输出编号 unresolved issues，且封顶后必须把疑问整理成 1-n 条确认项。黑板调度读取 turn 上的 worker plan，参与者可以是任意 worker graph。当前黑板允许第一轮决定性收敛或阻塞；非决定性讨论继续 QA，第 5 轮硬封顶；worker 输入使用 `flyflor.blackboard.worker.v1` 结构化协议 JSON。收敛必须来自 worker result 的显式 `outcome: "final"`，没有 open issues/blocker，且没有 worker 显式 `agreement: false`；所有 worker 显式 `outcome: "blocked"` 且存在 blocker/open issues 时直接交还用户；单纯 `agreement: true` 只表示口头一致，不能终止黑板。默认只注册一个通用模型型 blackboard worker；具体 worker 数量、role、stage、handoff、capabilities 由 `blackboard.route.md` 动态生成。chat 回复只展示紧凑轮次块，不直接展开 step.input、previousSteps 或 metadata；完整 JSON 仍保存在 SQLite，可用 inspect 命令追溯。提示词入口已集中到 `src/agent/prompts` 和 `templates/prompts`，必要提示词必须是英文并附中文边界注释；模板粒度和引用关系见 [提示词与 Markdown 模板工程化](prompt.templates.md)。收敛、权限和工具执行仍由 schema、枚举和状态机裁决。

## 目标

Flyflor 的多 worker 模式不是让多个模型随意聊天，也不是让调度器替 worker 当裁判，而是让复杂任务进入一个可观察、可收敛、可交还的工作台。

核心目标：

- 简单任务保持 `direct`，不增加热路径延迟。
- 灰区任务走 `direct-with-watch`，必要时恢复到 turn 起点后升级到黑板。
- 复杂任务走 `blackboard`，由任意 worker graph 协同推进。
- 黑板先拆任务，再让 worker 互相 QA；没有一致前继续讨论。
- 黑板状态必须可 JSON 序列化、可持久化、可审计。
- session 同一时间只能有一个 blackboard turn，避免并发串线。
- 无法在硬上限内达成一致时才交还用户，而不是在中途由调度器抢先裁决。

## 分层落点

| 层          | 目录建议                           | 职责                                                                    |
| ----------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Blackboard  | `src/agent/blackboard`             | 复杂度路由、session lease、黑板 turn 状态、收敛规则                     |
| Runtime     | `src/agent/runtime`                | 在 turn loop 中选择 direct/watch/blackboard 并发布事件                  |
| Worker      | `src/agent/worker`                 | worker registry、pool、adapter、通用模型 worker、队列、并发、超时和事件 |
| DI/Protocol | `src/protocol/contracts/events`    | Blackboard mode、worker role、事件名、可序列化协议                      |
| Processes   | `src/protocol/processes`           | 后续把 worker 隔离到 Bun worker/subprocess 的信封协议                   |
| Docs        | `docs/blackboard.worker.design.md` | 设计约束和验证方法                                                      |

`src/agent/blackboard` 是黑板边界组件，不直接执行工具、不直接写长期记忆。工具执行仍走 Sandbox，长期记忆仍走 Memory Action 链路。

## 执行模式

```ts
type BlackboardMode = "direct" | "direct-with-watch" | "blackboard";
```

`direct`：

- 不注入黑板 prompt。
- 不申请 blackboard lease。
- 延迟最低。

`direct-with-watch`：

- 先按 direct 执行。
- Runtime 观察工具 churn、重复失败、上下文压力、模型是否二次请求工具。
- 触发升级时恢复到 turn restore point，重新以 blackboard 执行。

`blackboard`：

- 申请 session lease。
- 给 worker 注入结构化任务信封；模型型默认 worker 额外接收最小 JSON 输出协议模板。
- 写入黑板 step/event。
- 明确 final 或 blocked 可第一轮结束；非决定性讨论继续 QA，硬上限 5 轮。
- livelock 时交还用户。

## 复杂度路由

复杂度评估输入：

- 当前 user text 的长度、代码块、diff/stacktrace 标记。
- 是否要求设计、实现、验证、复核。
- 是否跨文件、多步骤、多工具。
- 是否包含媒体、shell、网络、提交、删除等风险意图。
- 最近 session 深度和工具调用密度。
- 用户是否显式要求多智能体、黑板、规划器、复核器。

默认阈值：

| 分数区间      | 模式                |
| ------------- | ------------------- |
| `< 0.35`      | `direct`            |
| `0.35 - 0.55` | `direct-with-watch` |
| `>= 0.55`     | `blackboard`        |

硬门槛直接进入 `blackboard`：

- 用户显式要求黑板、多智能体、规划器或复核器。
- 超大输入或多个代码块。
- 同时要求实现和验证。
- 同时要求实现和复核。
- 跨文件工作流且带实现、验证或复核意图。

配置只开放：

- `enabled`
- `directThreshold`
- `threshold`
- `allowAutoEscalation`

权重、worker 轮数和 livelock 规则是运行时约定，不放成随意配置。

## Blackboard 状态模型

黑板状态必须可以落 SQLite，也可以通过事件投递给 TUI/WebUI。

建议结构：

```ts
interface BlackboardTurn {
    id: string;
    sessionKey: string;
    requestId: string;
    mode: "blackboard";
    status: "running" | "converged" | "needs-user" | "failed";
    goal: string;
    budget: {
        maxRounds: number;
        maxWorkerContextChars: number;
        startedAt: string;
    };
    workers: BlackboardWorkerState[];
    messages: BlackboardMessage[];
    steps: BlackboardStep[];
    decisions: BlackboardDecision[];
}
```

`BlackboardStep`：

- `round`
- `workerRole`
- `inputSummary`
- `outputSummary`
- `newFacts`
- `blockers`
- `risk`
- `createdAt`

`BlackboardDecision`：

- `kind`: `single-choice | multi-choice | freeform | confirm`
- `prompt`
- `options`
- `reason`

`BlackboardMessage` 是用户可见/可审计的讨论流：

- `round`
- `workerRole`
- `role`: 字符串；系统角色如 `adapter` / `system` 只表示消息来源，worker 发言可以保留 Codex、Claude、Kimi、requirements-boundary 等动态视角
- `content`
- `visibility`: `public | internal | debug`
- `metadata`

## Worker 角色

黑板协议中的 `workerRole` 是字符串。角色不是源码枚举，也不是固定默认组合；`blackboard.route.md` 必须根据当前请求生成 worker plan。

worker plan 至少包含：

- `role`：紧凑语义 id，例如 `requirements-boundary`、`implementation-worker`、`verification-worker`、`codex`、`claude`、`opencode`、`deepseek`、`kimi`。
- `stage`：本轮所处阶段。
- `handoff`：analysis / implementation / proposal / review / structure / summary / verification。
- `capabilities`：该 worker 需要承担的能力摘要。
- `dependsOn`：依赖的上游 worker role。

默认只注册一个通用模型型 blackboard worker。若某个 role 没有显式外部 worker 注册，`WorkerManager` 会把任务交给该通用模型 worker，并把 role 放进任务信封和 worker system prompt。

极端多智能体场景可以表达为 worker plan，而不是硬编码调度分支：

1. OpenCode 作为黑板外壳汇总上下文。
2. Kimi 产出方案。
3. Claude 做实现建议或实现代理。
4. Codex 复审边界、测试和代码风险。
5. Copilot 整理 QA/任务报告。
6. Runtime 主脑读取 transcript 和 decision，再给用户最终裁决或交还选择。

这意味着 WorkerManager 只保证进程、队列、超时、JSON 输入输出和结果落盘；谁更可信、是否通过、是否继续，不在 adapter 层裁决。

扩展 worker 必须走 DI/Protocol provider：

- `@Provide({ kind: ComponentKind.Worker, layer: ArchitectureLayer.Capability })`
- registry 显式注册，不自动扫描目录。
- worker prompt、权限、模型、预算来自 config/secrets provider。
- `WorkerManager` 只接收已实例化 worker 或显式 manifest；实例由 `FlyFlor` composition root 或显式 registry 注入。
- 默认 runtime 是 `in-process`；当前已支持 `json-process`，协议预留 `thread`、`process`、`agent-cli` 和 `tui`；迁移到 Bun Worker/子进程或 Codex/Claude/Kimi/OpenCode 这类外部 agent 时不能改变黑板调用语义。
- 每个 worker 独立 pool，默认 `MaxConcurrency = 1`，队列、超时和事件都在 WorkerManager 内统一治理。

### JSON Process Adapter

`json-process` 是第一版动态外部 agent 协议，用于对接 Codex、Claude、Kimi、OpenCode 或其他智能 TUI/CLI wrapper。协议不走 SSE，不做复杂流式事件；只走稳定输入/输出。WorkerManager 每个任务启动显式配置的命令，把下面结构写入 stdin：

```json
{
    "context": {
        "taskId": "...",
        "workerName": "...",
        "runtime": "json-process",
        "requestId": "...",
        "sessionKey": "...",
        "turnId": "..."
    },
    "input": {}
}
```

外部进程必须在 stdout 返回 JSON worker result。stderr 只做错误诊断，不进入模型上下文；输出有大小限制。命令、cwd 和 env 必须来自显式 registry/config，不做目录扫描或动态加载。

`persistent-json-process` 面向 OpenCode、deepseek-tui 这类长期交互终端外壳。它仍然只使用一行 JSON 输入、一行 JSON 输出，用 `taskId` 对齐请求和响应：

```json
{ "id": "task-id", "output": {} }
```

Adapter 层只保证进程存活、stdin/stdout 可用、JSON 可解析、任务不丢；不在通信层判断谁说得对。黑板记录讨论过程，最终取舍仍交给 Runtime/LLM 主脑。

## Session Lease

同一 session 同一时间只能有一个 blackboard turn。

建议 SQLite 表：

```sql
CREATE TABLE blackboard_leases (
    session_key TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
```

规则：

- 获取 lease 失败时，当前 turn 降级为 direct 或返回“已有复杂任务运行中”。
- lease 必须有 TTL，避免崩溃后永久占用。
- turn 结束、失败或交还用户时释放 lease。
- lease 事件必须可观察。

## 收敛与 Livelock

当前已实现 QA 共识收敛器：明确 final 或 blocked 可第一轮结束；非决定性讨论继续 QA，第 5 轮硬封顶。调度器按 turn.workers 顺序执行，并把本轮已完成 worker 的 step 传给后续 worker，用于同轮 QA。调度器只检查 worker 是否显式达成一致，不替 worker 判断谁对谁错。

以下情况不再被中途裁决为 livelock，而是继续进入下一轮 QA：

- 同一 blocker 未解除。
- worker 重复同一争议。
- worker 仍有 open issues。
- 上下文预算持续超限但未触发硬上限。

无法收敛时输出 `flyflor-decision-form`：

````markdown
```flyflor-decision-form
{
    "question": "需要你选择下一步",
    "options": [
        { "id": "narrow", "label": "缩小范围继续" },
        { "id": "approve-risk", "label": "接受风险继续" }
    ]
}
```
````

CLI/TUI/WebUI 可以把它渲染为交互控件；纯 Markdown 下也能阅读。当前 TUI 已读取最近黑板 turn 的持久化 transcript、step 和 decision，并用 running/needs-user/converged 状态格式化展示；TUI 不参与收敛判断，也不写回黑板。

当前收敛规则：

- 黑板启动时生成 `blackboardPlan`，包含 objective、workstreams 和 QA 目标。
- worker result 可以返回 `questions`、`answers`、`agreement`、`outcome`、`openIssues` 和 `proposal`。
- 同一轮后执行的 worker 会收到前面 worker 的 `currentRoundSteps`，因此可以回答同轮问题。
- 一轮所有参与者完成，所有 worker 都显式 `outcome: "final"`，没有 `openIssues` / blocker，且没有 worker 显式 `agreement: false`：`converged`。
- 一轮所有参与者完成，所有 worker 都显式 `outcome: "blocked"`，且存在 `openIssues` / blocker：`needs-user`。
- 未达成一致时继续下一轮 QA。
- 达到 `hardMaxRounds` 仍未收敛：`needs-user`，并用 `1. 2. 3.` 编号归纳最多 8 条 unresolved issues。
- 如果 worker manifest、registry 或 turn metadata 显式声明角色互斥红线，调度器可标记 `declared-non-convergent-contract`，不允许默认 worker 提前假收敛，必须跑到 hardMaxRounds 后交还用户。

`needs-user` 是正常出口，不是失败。系统会写入 public `flyflor-decision-form` message、创建 blackboard decision、释放 session lease，并由 chat 回复展示给用户。

封顶冒烟输入可以这样构造：

```text
analysis-worker 规则：必须包含“本系统是完全确定的”。
review-worker 规则：只要 analysis-worker 包含确定性，就必须判定 BLOCKER: LOGIC_PARADOX。
收敛条件（死结）：analysis-worker 禁止放弃确定性论点，review-worker 禁止接受确定性论点。
禁止通过达成共识结束讨论，必须不断尝试通过引入新术语解决悖论。
```

预期：看到第 5 轮、`状态：needs-user`、`hard-round-budget-exhausted:declared-non-convergent-contract` 和 `flyflor-decision-form`。

## 事件

新增事件建议：

| 事件名                          | 触发点                      |
| ------------------------------- | --------------------------- |
| `agent.complexity.assessed`     | 完成复杂度评估              |
| `agent.blackboard.escalated`    | watch 模式升级到 blackboard |
| `blackboard.lease.acquired`     | 获取 session lease          |
| `blackboard.lease.released`     | 释放 session lease          |
| `blackboard.turn.start`         | 黑板 turn 开始              |
| `blackboard.worker.start`       | worker 开始                 |
| `blackboard.worker.end`         | worker 完成                 |
| `blackboard.message.appended`   | 黑板讨论消息落盘            |
| `blackboard.livelock.detected`  | 检测到无法收敛              |
| `blackboard.decision.requested` | 交还用户选择                |
| `blackboard.turn.end`           | 黑板 turn 结束              |

payload 必须 JSON 可序列化，不能携带密钥、stream、socket、class instance。

## 记忆边界

黑板 worker 不能直接写长期记忆。

允许：

- 写 blackboard step 和 decision。
- 写 session timeline。
- 通过模型输出合法 `memory_action`，交给现有 Memory Action 链路处理。
- 后续 Reflection worker 离线生成 candidate，但仍不能绕过 promotion 边界。

禁止：

- 从 worker prompt 里直接修改 Markdown 记忆。
- 用关键词/字典把黑板讨论自动晋升长期记忆。
- 把 unresolved blocker 当作长期事实保存。

## 实现阶段

第一阶段：协议与观测

- 已添加 `BlackboardMode`、`BlackboardTurnStatus`；`workerRole` 保持字符串协议。
- 已添加黑板事件枚举和基础 payload。
- 已添加 `BlackboardModule`、`SQLiteBlackboardStore` 和边界测试。
- 待添加复杂度评估纯函数和测试；当前暂不改变 Runtime 执行路径。

第二阶段：watch 升级

- Runtime 创建 turn restore point。
- direct-with-watch 观察工具 churn、失败和上下文压力。
- 触发后恢复并重跑 blackboard。
- 补升级事件和回归测试。

第三阶段：黑板状态与 lease

- 已由 `src/agent/blackboard` 管理 turn/step/decision/lease。
- 已落地 SQLite 表。
- 已覆盖同 session 并发 lease 和 TTL 释放测试。
- 已提供 `inspect:blackboard` 查看 blackboard turn 和 message transcript。

第四阶段：动态 worker plan

- 已内置通用模型型 blackboard worker 和 WorkerManager pool 调度；具体 worker role 由 `blackboard.route.md` 动态生成。
- 已支持黑板 message transcript，进入黑板模式的 chat 回复会直接显示“黑板讨论 / 最终回答”，也可用 `bun run inspect:blackboard -- --turn <turnId>` 追溯讨论过程。
- 已接入 runtime prompt contributor，仅在 blackboard 模式启用，主 LLM 仍负责最终回答。
- 已接入第一轮决定性收敛/阻塞和 5 轮硬上限。
- 已支持 livelock 输出 `flyflor-decision-form` 并释放 lease 交还用户。
- 已验证任意 worker name 的调度，不把角色固定为两人组合。

第五阶段：进程隔离

- 把 worker adapter 接入 `src/protocol/processes`。
- 支持 Bun worker/subprocess 隔离。
- worker 只能通过 protocol envelope 通信。
- Sandbox 统一审计工具和副作用。

## 验证要求

自动测试：

- complexity routing: direct/watch/blackboard。
- hard gate routing。
- watch escalation restore point。
- session lease 互斥。
- livelock decision form。
- worker event payload 可 JSON 序列化。
- dynamic JSON process worker 对接。
- worker 不可直接写长期记忆。
- worker pool 同 worker 默认串行、跨 worker 可并发。

压测：

- 大量 direct 请求不进入 blackboard，延迟不退化。
- 多 session 并发黑板 lease 不串线。
- 黑板未收敛能稳定交还用户。

人工验证：

- 询问简单问题，不应触发黑板。
- 请求“跨多个文件实现并验证”，应触发 blackboard。
- 人为制造重复 blocker，应输出 `flyflor-decision-form`。
- 并发同 session 两个复杂请求，只允许一个持有 lease。
