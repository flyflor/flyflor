# Flyflor 智能体架构设计总结

本文总结当前 Flyflor 智能体架构的实际设计，包括反思、空间记忆、三层记忆、记忆唤醒、黑板协作和复杂度计算。早期 Go/ARMS/Seahorse 术语在本文中只作为概念来源；当前工程实现已经收敛到 `llm`、`crystal`、`neural`、`agent`、`agent/di`、`protocol` 等语义分层。

## 0. 设计哲学

Flyflor 的核心智能模型是：

- **LLM = 流体智力**：负责当前任务的理解、推理、生成、工具编排、黑板讨论和即时决策。
- **Reflection = 晶体智力来源**：负责把已经发生且可验证的过程压缩成可复用方法，而不是把普通聊天转录成长期记忆。
- **SurrealDB 空间记忆 = 联想网络**：负责保存 candidate、atom、skill 和关系边，使方法经验能通过符号、坐标、证据和相邻关系被唤醒。

这套设计接近“海马体 + 晶体智力”的组合：LLM 临场解决问题；反思系统把高价值经验结晶；空间数据库把晶体经验连接成可扩展的回忆网络；未来遗忘曲线和自动聚类会继续调整哪些经验更容易被深度唤醒。

基本原则：

1. 不在源码写死语义 bucket、关键词表或方法论 taxonomy。
2. 反思先进入 candidate；只有带证据的候选才能形成 atom/skill。
3. Crystal Skill 是方法建议，不是事实来源，也不是高优先级指令。
4. 深度唤醒必须有预算、超时、hop 上限和审计轨迹。
5. 必要提示词集中在 Markdown 模板；代码只负责协议、证据、边界和持久化。

后续代码分层必须保留三层智能体核心：`llm` 作为流体智力，`crystal` 作为晶体智力，`neural` 作为海马体 / 关联网络。其余装配、协议和输入输出能力围绕这三层组织。项目不设独立 `interface` 层，也不设独立 `service` 层；需要接口或服务声明时，使用模块内局部文件，例如 `agent/runtime/interface.ts`、`agent/runtime/runtime.service.ts`。

## 1. 总体架构

Flyflor 是一个可观察的智能体运行时，而不是单纯聊天客户端。一次用户请求会经过：

1. 入口归一化：渠道、会话、媒体、技能、沙箱配置和路由结果被规范成 `DispatchRequest`。
2. 复杂度评估：决定本轮走 `direct`、`direct-with-watch` 还是 `blackboard`。
3. 上下文装配：从 Markdown、SQLite/session、内部语义索引和 SurrealDB Crystal Memory 中唤醒相关记忆。
4. LLM 主循环：执行模型调用、工具调用、转向消息、子任务结果和中断处理。
5. 工具治理：Hook、Sandbox Box、敏感信息过滤、工具结果入库和事件发布。
6. 最终交付：输出用户可读答案，并把可记忆内容写回上下文管理器。

当前 TypeScript 核心路径在：

- `src/agent/runtime`
- `src/agent/blackboard`
- `src/neural/memory`
- `src/agent/session`
- `src/agent/worker`
- `src/llm`
- `src/protocol/contracts`
- `src/agent/di`
- `src/crystal/memory`

## 2. 三种执行模式

Flyflor 当前有三种黑板路由模式。

当前 Bun/TypeScript 实现说明：`RuntimeModule` 已启用 `blackboard-route.md` 模板做结构化路由判断。模型返回 `mode`、`score`、`reason`、`signals` 和 `needsReflectionCandidate`；运行时代码只校验协议和枚举，不在源码中写业务关键词表、固定 taxonomy 或硬编码 bucket。`direct-with-watch` 已作为可观测直通模式返回，工具 churn、重复失败、上下文压力和 restore point 升级重跑仍是下一步实现项。

`direct`：普通单智能体路径。不会注入黑板提示，不申请黑板会话租约，延迟最低。

`direct-with-watch`：灰区任务先按 direct 执行，但运行时观察工具 churn、重复失败、上下文压力和多轮工具迭代。一旦发现任务需要协作，会回滚到本轮开始时的 restore point，然后以 blackboard 模式重跑一次。

`blackboard`：复杂任务进入黑板工作台。系统提示中会注入动态 worker plan、收敛预算、死锁交还和反思草稿规范。

这三种模式由 `BlackboardMode` 表示：

- `direct`
- `direct-with-watch`
- `blackboard`

## 3. 复杂度计算

复杂度计算在当前 TypeScript runtime/blackboard 路由中执行，早期 `pkg/agent/blackboard_complexity.go` 是历史概念来源。

输入特征来自当前用户消息、媒体和最近会话历史，主要包括：

- token 估算
- 代码块数量
- diff 或 stacktrace 标记
- 子任务数量
- 是否请求方案、实现、验证、复核
- 会话深度
- 最近工具调用密度
- 是否引用前文继续
- 是否包含媒体
- 是否有风险意图，例如 shell、网络、提交、删除
- 是否显式要求黑板、多智能体、规划器、复核器
- 是否跨文件或多步骤

打分逻辑是固定权重加和后 clamp 到 `[0, 1]`。默认阈值：

- `< 0.35`：`direct`
- `>= 0.35` 且 `< 0.55`：`direct-with-watch`
- `>= 0.55`：`blackboard`

配置只开放：

- `enabled`
- `direct_threshold`
- `threshold`
- `allow_auto_escalation`

权重、黑板轮数和死锁规则是运行时约定，不建议按部署随意调参。

硬门槛会绕过普通分数，直接进入 blackboard：

- 显式要求黑板或多智能体
- 超大输入或多个代码块
- 同时要求实现和验证
- 同时要求实现和复核
- 跨文件工作流且带实现、验证或复核意图

运行时升级条件：

- watched turn 内工具执行达到 3 次
- 同一工具连续失败 2 次
- 第二轮 LLM 仍需要工具
- 主动上下文压缩发现预算压力

升级时会恢复会话历史和摘要，发出 `agent.blackboard.escalated` 事件，并在第二次尝试中强制 blackboard。

## 4. 黑板工作台

黑板工作台在 `pkg/agent/blackboard_scheduler.go`。

Worker plan 由 `blackboard-route.md` 基于当前请求动态生成。代码不固定 Planner/Reviewer 组合，只校验 worker plan、结构化结果、收敛状态和交还条件。

调度规则：

- 每个会话同一时间只能有一个 blackboard turn，通过 session lease 防止并发交叉。
- 每个 worker 默认 `MaxConcurrency = 1`。
- worker 上下文预算约 12000 runes。
- 目标 3 轮内收敛，硬上限 5 轮。
- 两轮没有新事实、重复争议、同一 blocker 未解除、重复失败工具路径时视为 livelock。

如果无法收敛，黑板不继续内部争论，而是向用户返回 `flyflor-decision-form` fenced block。WebUI/TUI 可以把它渲染成单选、多选和自定义输入；纯 Markdown 环境也能直接阅读。

黑板提示通过 prompt contributor 注入，仅在 `BlackboardModeBlackboard` 生效。

## 5. 三层记忆主干

当前长期记忆主干是三层：

### 5.1 Markdown 层

位置：

- `workspace/AGENT.md`
- `workspace/SOUL.md`
- `workspace/USER.md`
- `workspace/memory/MEMORY.md`

职责：

- 智能体身份、行为原则和语气
- 用户偏好和稳定工作方式
- 项目长期事实和高信号约束

这层是人可读、可编辑的宪法层。ContextBuilder 会跟踪文件 mtime，文件变化后下一轮自动进入上下文。

### 5.2 SQLite/Seahorse 层

位置和实现：

- `pkg/seahorse`
- 默认数据库：`workspace/sessions/seahorse.db`
- 会话 JSONL 后端：`pkg/memory`、`pkg/session`

职责：

- 保存结构化会话时间线
- 记录 tool use、tool result、media part 和 reasoning content
- 做短期/中期上下文装配
- 在预算压力下压缩摘要
- 提供 grep/expand 类精确检索工具

Seahorse 是默认 `context_manager`，负责每轮 `Assemble`、`Ingest`、`Compact`、`Clear`。

### 5.3 Qdrant 语义向量层

位置：

- `pkg/semanticmemory`

职责：

- 从有意义的 user/assistant 消息中抽取偏好、项目事实、记忆设计要求和交付经验。
- 生成 embedding。
- 写入 Qdrant collection。
- 下一轮根据当前 query 做语义召回。

默认 collection 是 `flyflor_memories`，默认维度 256，默认 `top_k = 6`。没有外部 embedding 配置时使用 hash embedding；配置 OpenAI-like embedding 后可使用真实向量模型。

Qdrant 层输出格式为 `VECTOR_MEMORY`，提示模型把它当作有用线索，而不是高于用户当前指令的事实。

## 6. 向量索引流程

Qdrant 向量索引发生在 `ContextManager.Ingest`。

写入路径：

1. 用户消息或助手消息被持久化到 session。
2. `turnState.ingestMessage` 调用当前 `ContextManager.Ingest`。
3. Seahorse 先写 SQLite。
4. 如果 semantic memory 已启用，`semanticmemory.Manager.IndexMessage` 抽取候选记忆。
5. 每条候选记忆生成 embedding。
6. 使用稳定 UUID 写入 Qdrant，payload 包含 text、kind、session_key、role、created_at、source、schema_version。

抽取规则：

- user 消息：偏好、项目事实、记忆设计要求、长文本摘要。
- assistant 消息：交付结果、验证经验、风险和设计结论。
- `Methodology Reflection Draft` 会先被剥离，避免方法论反思混入普通语义记忆。

召回路径：

1. `SetupTurn` 调用 `ContextManager.Assemble`。
2. 当前 user message 作为 query。
3. Seahorse 先装配会话上下文和摘要。
4. Qdrant 搜索 topK 并按 `min_score` 过滤。
5. 命中项追加到 summary/context block 中。

## 7. 反思与 ARMS 方法论记忆

当前 Bun/TypeScript 实现已把 ARMS 目标收敛为 Crystal Memory：反思先生成 `reflection candidate`，再由证据评分决定是否晶体化为 atom/skill。`crystal-reflection.md` 只要求从证据中动态生成 `title`、`method`、`symbols`、`bucketHint` 和 `coordinates`；代码不提供固定方法论分类、关键词桶或语义 taxonomy。证据为 0 的垃圾候选只保留审计，不会生成 crystal skill。

反思系统不是普通记忆的一部分，而是隔离的方法论记忆侧车。

反思入口是黑板提示中的输出约定：

```markdown
## Methodology Reflection Draft

- Situation: When this method applies.
- Method: The repeatable approach.
- Avoid: What failed or caused delay.
- Next-time hint: A short cue for retrieval before future planning.
```

Crystal Memory 只接受运行时或后台 worker 明确提交的 reflection candidate。用户文本、普通助手总结、项目事实、偏好和会话摘要都不会直接变成 crystal skill。

实现位置：

- `pkg/armsmemory`
- `pkg/agent/context_arms.go`

写入路径：

1. blackboard turn 产出 Methodology Reflection Draft。
2. `armsContextManager.Ingest` 包装基础 ContextManager。
3. `armsmemory.ExtractMethodologies` 严格抽取反思 section。
4. 写入 ARMS store。

读取路径：

1. `armsContextManager.Assemble` 先调用基础 ContextManager。
2. 用当前 query 搜索 ARMS。
3. 命中结果追加为 `METHODOLOGY_MEMORY`。
4. 模型把它作为规划和复核的可复用方法，而不是用户事实。

当前 Crystal Memory driver：

- SQLite/session/history 保存证据来源和运行状态。
- SurrealDB 保存 reflection candidate、atom、skill，后续保存 graph edge、cluster、recall trace 和 forgetting state。
- 内部语义索引可以作为召回加速，但不承担晶体智力的 source of truth。
- 坐标和 bucketHint 由反思 worker 从证据生成，不能在源码中固定为分类轴。

## 8. 记忆唤醒

“唤醒”发生在模型调用前的 `Assemble` 阶段，而不是模型回答后。

当前顺序：

1. Markdown 层由 ContextBuilder 作为静态/半静态 prompt 贡献者进入系统提示。
2. Seahorse 根据 session key 和预算装配最近消息、摘要和压缩上下文。
3. Qdrant 用当前 user query 召回 `VECTOR_MEMORY`。
4. Crystal Memory 如果启用，再用同一 query 召回可复用方法 skill。
5. BuildMessages 把这些内容合并到最终 provider messages。

记忆优先级原则：

- 当前用户指令最高。
- Markdown 身份和用户偏好是长期约束。
- Seahorse 会话上下文提供最近事实和过程。
- 内部语义索引是相关事实线索，需要被核对。
- Crystal Skill 是方法论建议，只影响“怎么做”，不直接当事实。

## 9. 运行时可观察性

架构通过 runtime events 把内部状态暴露给 UI、日志和黑板面板。

关键事件：

- `agent.turn.start`
- `agent.turn.end`
- `agent.complexity.assessed`
- `agent.blackboard.escalated`
- `agent.sandbox.assessed`
- `agent.llm.request`
- `agent.llm.response`
- `agent.tool.exec_start`
- `agent.tool.exec_end`
- `agent.tool.exec_skipped`
- `agent.context.compress`
- `agent.steering.injected`

复杂度事件会带上 mode、score、threshold、reasons、hardGate 和完整 features，便于解释为什么某轮进了黑板或保持 direct。

## 10. 当前设计边界

已经实现：

- 默认 Seahorse context manager。
- Qdrant semantic memory 的索引、召回和 session delete。
- Crystal Memory candidate、atom、skill 基础链路，严格反思抽取和零证据候选隔离。
- blackboard complexity routing。
- direct-with-watch 自动升级、回滚、重跑。
- 黑板 session lease、动态 worker plan、收敛和 deadlock 提示约定。

仍属于约定或待继续产品化的部分：

- worker 角色目前由 `blackboard-route.md` 生成，默认通用模型 worker 执行；外部进程 worker 仍需继续产品化。
- `flyflor-decision-form` 已有 Markdown/JSON 约定，UI 原生控件渲染仍需继续完善。
- Reflection candidate 已可进入 Crystal Memory，但后台化、召回反馈、自动聚类和遗忘曲线仍需继续产品化。
- 内部语义索引不应替代 SurrealDB 晶体层，后续要逐步把方法论召回收敛到 Crystal Skill 和关联图。
- SurrealDB graph edge、深度唤醒、recall trace 和 decay/reinforcement 仍未完成。

风险预警：

- 如果源码重新写入固定 bucket、关键词或语义分类，Crystal Memory 会退化为提示词/规则工程。
- 如果 candidate 不经证据门直接变成 skill，垃圾数据会污染未来规划。
- 如果深度唤醒没有预算控制，图扩散会拖慢聊天热路径。
- 如果没有遗忘曲线，过期经验会长期干扰；如果遗忘过强，低频关键方法会丢失。
- 如果提示词模板漂移但 schema 校验不足，反思候选质量会失控。

## 11. 一句话总结

Flyflor 当前架构是：LLM 作为流体智力处理当前任务；黑板把复杂工作变成可观察、可收敛、可交还的协作流程；Markdown、SQLite/session 和内部语义索引保存事实与过程；SurrealDB Crystal Memory 把反思后的证据经验结晶为可唤醒的方法网络，并在后续通过自动聚类、遗忘曲线和深度唤醒逐步形成晶体智力。
