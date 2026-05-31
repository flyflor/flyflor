# Flyflor 重构主计划（Release 攻坚）

> 目标：交付完整的无 session 智能生命体，功能 100%，到 release 版本。
> 本文档是本轮重构的权威设计与排程。实现必须 doc-first：每条轨道先更新对应 `docs/` 设计文档与 `prompts/*.md`(+`.zh.cn.md`)，再改运行时代码，每步用 `bunx tsc --noEmit` + `bun test` 验证。

## 1. 北极星与定位

Flyflor 是**无 session 智能生命体**：模型供应商永不作为连续性来源，每一轮从本地持久状态重建。
- LLM = 流体智力；MemoryComponent = 热记忆；Scope = 宪法层固化记忆；Crystal = 晶体智力(Gem)；Forgetting = 遗忘曲线；brain.db = 不可变月度传记；SignalBus = 血管层；Sandbox 侦查者 = RxJS 守卫（ASK > Confirm）。
- **核心驱动偏向底层 coding 工具**：read/grep/glob/edit/multi_edit/shell/git/codegraph 必须先是一个真正能干活的 coding agent，生命体记忆机制环绕这个内核。

## 2. 本轮新增的五条架构约束（已写入 AGENTS.md 红线）

1. **WS 层只对接三个面**：侦查者(guard，阻断 Confirm/ASK)、db(brain/memory 读)、对话(chat)。其余一切只能作为 SignalBus 广播被 WS 订阅显示，WS 不得命令工具/worker/记忆/scope/crystal/forgetting。
2. **内核保持纯粹**：kernel 只做 turn 编排（turn loop + 模型调用 + 工具回路）。所有横切能力经 SignalBus（侦查者链路）协调，能力以 `@Subscribe` 接入并自持状态。既发挥 DI 边界优势，又让状态转移集中可观测可审计。
3. **外挂插件隔离**：rtk/codegraph 及后续 browser-use/computer-use 全部安装到 `./plugins/<name>`，与全局隔离（不入全局 PATH，缓存在 `.config`）。状态查询是纯读，安装是独立显式动作。
4. **提示词工程**：每个运行时 `name.md` 必须有 `name.zh.cn.md` 人维副本；runtime 只加载 `.md`。
5. **灵魂宪法**：实现 hermes-agent 式 soul 宪法层（SOUL/USER/MEMORY + 每 scope 宪法），可模型辅助修订、审计、永不被遗忘/压缩。

## 3. 当前真实状态（代码级，注意 ISSUES.md 部分过时）

已验证 `tsc` 通过。ISSUES.md 中 worker.modelProvider/超时/failed 覆盖/schema 丢弃等条目**已修**，但更深的结构性缺陷仍在。五大领域真实根因：

- **工具调用**：① 原生 tool 协议在多步回路断裂——`model.provider.ts:235` 把 `role:"tool"`→`"user"`，且 `agent.runtime.service.ts:286` 只在无工具调用时回填 assistant 文本，带 `tool_calls` 的 assistant 消息从不入历史，`tool_call_id` 只活在字符串里。② `registry.ts:58` 自造 id，审计 id 与协议 id 脱节。③ 生产环境 `guard.ask` 无 responder → 全部 mutating 工具自动放行（侦查者形同虚设）。④ 工具双重注册（ToolModule + registerCoreTools）。⑤ 多层不协调截断。⑥ 串行执行。⑦ projectPath 未校验即作 cwd/写根。
- **调查**：路由层正确（单模型 JSON 决策，不做 host 关键词分类，须保留）；但 `investigate` 模式被砍掉 shell 无法验证；inline 调查浅；两条证据路径(host 预跑 + 模型回路)割裂；子代理结果回不到本轮。
- **子代理**：发射后不管，结果只进 memory 供未来轮；超时只是软超时且 finally 在 `timeoutFired` 提前 return 导致**并发槽泄漏** + 双发终态事件；无 AbortController；`guardPolicy:"auto"` 绕过侦查者；同样压平 tool 协议。
- **摘要**：`context.compressor` 是**正则截断**(360 字 + anchor 正则)，无模型调用；checkpoint 单条最新会丢历史；压缩删 chunk 不保证 brain 留原文（违反不可删审计）。
- **知识树**：4 维玩具 embedding（违反"无 mock 模型"）；单层统一树，无 openhuman 分层固化/摄取管线；遗忘用 `treeRecall("")` 当存储扫描；scope 有第二套召回引擎(dead)；`memory.store` payload 不匹配。

## 4. 共享地基（被多领域复用，先做）

- **A. DI 急切引导 + 信号 require-responder + 侦查者接线**（T1）：`ModuleOptions.bootstrap`；`createContainer` 注册后急切 resolve bootstrap providers，使 `@Subscribe` 在 `--serve` 真正生效。`SignalBus.ask` 对 `guard.*` 要求 responder，无则 `guard.unattended`+拒绝。`SandboxModule.bootstrap:[SandboxGuard]`。→ Confirm<ASK 成立，侦查者链路是横切协调脊柱。
- **B. 原生 tool 协议往返**（T2）：`ContextMessage.toolCalls?/toolCallId?`；`normalizeMessages` 发原生 `assistant.tool_calls` + `role:"tool"` `tool_call_id`；kernel/worker 回路构造结构化 assistant+tool 消息回显 provider id；`registry.execute(...,providerCallId)`。被 T3/T4/T5 复用。
- **C. WorkspaceAllowlistComponent**（T3，src/sandbox）：canonicalize+allowlist projectPath/writeTargetRoot/shell cwd；`workspace.denied`。被 T4 复用。

## 5. 十二条轨道与排程（依赖序）

| 轨道 | 范围 | 依赖 | 关键交付 |
|---|---|---|---|
| T0 | 地基文档/红线/记忆 | — | AGENTS.md 红线、本文档 |
| T1 | DI 引导 + 信号 require-responder + 侦查者脊柱 | T0 | 守卫真正接线、ASK>Confirm 成立 |
| T2 | 原生 tool 协议往返 | T0 | 多步工具回路协议保真 |
| T3 | 工具调用硬化 | T1,T2 | 单一注册权威、workspace allowlist、预算、git 解析、调度器 |
| T4 | 调查单回路 | T2,T3 | RepoOverviewTool、EvidenceComponent、合并证据路径 |
| T5 | 子代理 | T2,T1 | SpawnAgentTool 前台阻塞、WorkerRun+settle()、abort、结果回注、guard.spawn |
| T6 | 摘要 | T2 | ContextCompactionService 模型蒸馏、checkpoint 链、collapse 前先入 brain |
| T7 | 知识树 | T2 | 真 embedding、分层树、摄取管线+job、召回单遍、遗忘归档 |
| T8 | 灵魂宪法 | T0 | ConstitutionService(SOUL/USER/MEMORY)、修订审计 |
| T9 | 插件隔离 | T1 | ./plugins 外挂隔离、browser-use/computer-use 脚手架、纯状态查询 |
| T10 | WS 收窄 + 内核纯化 | T1 | socket 限 guard/db/chat、createContainer(SocketModule) 权威启动 |
| T11 | 全量验证与发布 | 全部 | tsc/test、serve 冒烟、文档对齐、ISSUES 收口、提交 |

## 6. 验收标准（release 门槛）

- `bunx tsc --noEmit` 0 错；`bun test` 全绿（真实 LLM，无 mock，缺凭据视为失败）。
- 重启后可恢复、可召回项目事实、能探索代码、能执行并复核工具、压缩不丢关键证据、brain.db 暴露完整审计。
- 多步工具回路协议保真；侦查者对 mutating/spawn 真正升格 ASK；子代理前台结果回注本轮；摘要为模型蒸馏且 collapse 前原文已入 brain；向量召回基于真 embedding 且单遍每轮；遗忘归档不删原文。
- WS 仅 guard/db/chat；kernel 纯编排；外挂插件 `./plugins` 隔离；灵魂宪法注入且可审计修订。
- 每个被触碰子系统有 ≥2 个真实 LLM 场景测试；所有 `.md` 有 `.zh.cn.md` 副本；docs 与实现一致；ISSUES 无遗留 P0/P1/P2。

## 7. 进度记录

- 2026-05-31：T0 启动。AGENTS.md 新增 Socket(WS 三面)、Kernel Purity、Plugin 隔离、Soul Constitution 红线及 `src/constitution` 目录红线。本主计划落档。
