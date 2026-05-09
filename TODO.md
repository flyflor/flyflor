# Flyflor 工作进度

当前阶段目标：先把可编译、可验证、可扩展的智能体运行时骨架打稳，再逐步补齐黑板多 worker、CLI/TUI、插件市场、反思 worker 和复杂工具执行。

## 已完成

| 模块       | 事项               | 说明                                                                                                                                                                      |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FCP        | 公共协议层迁移     | `src/shared` 已迁移为 `src/fpc`，成为跨层协议、事件、metadata、DI 和进程信封层。                                                                                          |
| FCP        | 分层哲学           | 明确 `Composition / Control / Runtime / Capability / Extension / Process / Protocol` 七层。                                                                               |
| FCP        | Control 层定位     | Gateway、Memory、Sandbox、Command 定义为 Control Component，负责边界、权限、状态流向和降级策略。                                                                          |
| 结构       | 语义目录收敛       | 顶层实现目录收敛为 `src/control`、`src/core`、`src/fpc`；不再使用 `src/gateway` 和 `src/modules` 泛化桶。                                                                 |
| 结构       | NestJS 命名约定    | 源码目录统一提供 `index.ts` 入口；复杂实现文件统一使用点分命名，不再新增连字符源码文件。                                                                                  |
| Session    | Control 抽离       | `src/control/session` 持有 session identity、live context、timeline 和 history 固化边界，memory 只调用 session facade。                                                   |
| FCP        | Decorator metadata | 已支持 `@Provide`、`@FlyFlor`、`@Gateway`、`@Channel`、`@Command`、`@Memory`、`@Sandbox`、`@Runtime`、`@Skill`、`@Mcp`、`@McpService`、`@Plugin`、`@Tool`、`@Component`。 |
| FCP        | 主类 DI 装配       | `src/flyflor.ts` 作为 `@FlyFlor` composition root，提前注入 config、event sink、model、runtime、gateway 和 channel adapters；`app.ts` 只负责启动。                        |
| FCP        | Provider 统一      | `@Gateway`、`@Memory`、`@Session` 作为语义化 provider，底层统一登记 `@Provide` 注入 metadata。                                                                            |
| FCP        | 插件兼容入口       | Metadata 支持 `kind`、`layer`、`compatibility`、`tags`，为 `SKILL.md`、MCP server/client 和插件包预留稳定入口。                                                           |
| FCP        | 全局事件协议       | `FpcEventType`、`FpcEventBus`、`globalEvents`、sink 和事件创建函数已拆分落盘。                                                                                            |
| Session    | Session 分离       | SQLite 保存 session/messages；prompt 只注入同 session live messages，不跨 session 泄漏。                                                                                  |
| Session    | Session 固化       | 超过 live 阈值后固化到 history entry，下一轮 prompt 只保留未固化 live messages。                                                                                          |
| Session    | Session 压测       | `test:session:stress` 覆盖 session key 隔离、timeline 顺序、live/history 固化、脱敏和延迟分位数。                                                                         |
| Blackboard | 多 worker 设计     | 已基于 `DESIGN.md` 输出 [Blackboard 多 Worker 设计](docs/BLACKBOARD_WORKER_DESIGN.md)，明确 direct/watch/blackboard、lease、livelock 和事件边界。                         |
| Blackboard | Control 基础       | `src/control/blackboard` 已落地 turn、step、decision、message transcript、SQLite session lease、TTL 释放、事件发布和 `FlyFlor` DI 注入。                                  |
| Worker     | 动态对接与 Pool    | `src/control/workers` 已落地 WorkerManager、metadata registry、动态 WorkerAdapter、one-shot/persistent JSON process adapter、独立 pool、队列、超时和事件。                |
| 记忆       | Memory action 写入 | 长期记忆写入只接受模型同轮输出的结构化 `memory_action`，不做 loop 字典/正则匹配。                                                                                         |
| 记忆       | Markdown 长期记忆  | `SELF.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 作为长期意义层和 source of truth。                                                                                           |
| 记忆       | 残值矩阵           | `natural` 仅在合法 action 后参与轻量聚合，影响权重和召回排序，不改变写入门槛。                                                                                            |
| 记忆       | Qdrant 内部索引    | Qdrant 只做内部 best-effort 语义召回，不暴露宿主机端口，可从 Markdown + SQLite 重建。                                                                                     |
| Docker Dev | 二进制开发容器     | Compose 只挂载工作目录、配置、持久化数据和已编译 Linux 二进制，不在容器内安装 Bun。                                                                                       |
| 验证       | 边界测试与压测     | `bun test` 覆盖 JSONC、session、candidate、Markdown、Qdrant 降级；`test:memory:stress` 输出完整记忆链路报告。                                                             |

## 进行中

| 模块       | 事项             | 说明                                                                                                     |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| Gateway    | 渠道适配完善     | 已有 stdio/webhook/Telegram/Discord/Feishu/WeChat/Weixin iLink 入口，后续继续补真实平台细节。            |
| Skills/MCP | 兼容加载层       | 当前能读取本地 skills 和 MCP 配置；下一步需要让 `@Skill`、`@Mcp`、`@McpService` 接入 registry/manifest。 |
| Sandbox    | 权限控制器       | 已有 `SandboxController` 和策略摘要；后续需要接真实工具执行、审批和审计。                                |
| CLI/TUI    | Session 开发查看 | 当前用 `scripts/session.inspect.ts` 只读检查 session；正式 CLI/TUI 后续单独设计。                        |
| Blackboard | 收敛调度         | 已在 WorkerManager 基础上接入默认黑板调度、任意 worker name、3 轮目标收敛、5 轮硬上限和 livelock 交还。  |

## Blackboard 阶段计划

设计依据：[Blackboard 多 Worker 设计](docs/BLACKBOARD_WORKER_DESIGN.md)。

| 阶段 | 目标             | 交付物                                                                             | 验收重点                                                                       |
| ---- | ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | 协议与观测       | `BlackboardMode`、`BlackboardWorkerRole`、`BlackboardTurnStatus`、黑板事件 payload | 已完成黑板基础协议；direct 热路径不变                                          |
| 2    | Watch 升级       | turn restore point、watch 指标、`agent.blackboard.escalated` 事件                  | 工具 churn、重复失败、上下文压力能触发重跑；恢复后 session 不重复污染          |
| 3    | 黑板状态与 lease | `src/control/blackboard`、SQLite turn/step/decision/lease                          | 已完成基础状态、互斥 lease、TTL 释放和边界测试                                 |
| 4    | 默认参与者       | `flyflor-planner`、`flyflor-reviewer` worker provider、WorkerManager pool          | 已完成 provider 注册、pool 调度、黑板 runWorker、任意 worker name 和讨论流落盘 |
| 5    | Livelock 交还    | livelock detector、`flyflor-decision-form` 输出                                    | 已覆盖重复 blocker 交还用户；后续扩展无新事实、重复争议和工具失败路径          |
| 6    | 进程隔离与插件化 | Bun worker/subprocess envelope、worker manifest/registry、Sandbox 审计来源         | worker 可迁移到独立进程；事件 JSON 可序列化；二进制构建不引入动态依赖          |

## 待办

| 模块       | 事项                    | 说明                                                                                                                          |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Blackboard | 轮次调度                | 已基于 WorkerManager 驱动 turn.workers 顺序执行；后续把 worker plan 接入配置/插件 manifest。                                  |
| Blackboard | Livelock 交还           | 已支持重复 blocker、无新事实、重复讨论和轮次上限时输出 `flyflor-decision-form`，不内部无限争论。                              |
| Blackboard | 可见 transcript         | 黑板模式已在 chat 回复中返回“黑板讨论 / 最终回答”，`inspect:blackboard` 继续用于查看 turn、message transcript 和 step。       |
| Worker     | Agent/TUI 对接          | 基于 `json-process` / `persistent-json-process` 协议继续接 Codex、Claude、Kimi、OpenCode、deepseek-tui 等外部智能体 wrapper。 |
| Blackboard | 默认黑板模式            | 当前 runtime 不做复杂度判断，默认进入黑板；后续如需 direct/watch 只能在黑板稳定后重新设计并显式评审。                         |
| Blackboard | Watch 升级              | 暂缓 direct-with-watch 指标、restore point 和升级重跑；先保证黑板讨论稳定可见。                                               |
| Worker     | 后台任务边界            | consolidation、reflection、Qdrant rebuild 和 blackboard worker 后续迁移到 Bun worker/子进程。                                 |
| 反思       | Reflection worker       | 从 candidate/history/session/blackboard step 中提炼稳定结论，不阻塞聊天热路径，不绕过 Memory Action。                         |
| 方法论     | 方法论印证              | Blackboard 的 Methodology Reflection Draft 进入隔离方法论记忆，作为规划建议而非用户事实。                                     |
| 空间记忆   | 关联图模型              | 建立用户、项目、文件、工具、渠道、worker、决策之间的空间关系。                                                                |
| 插件       | Plugin manifest         | 定义 Flyflor 插件包 manifest、市场索引和二进制兼容检查，worker provider 也必须走显式 manifest/registry。                      |
| CLI/TUI    | Blackboard 面板         | 展示 complexity score、worker step、lease、livelock 和 `flyflor-decision-form` 交互。                                         |
| CLI/TUI    | Dream/Reflection 可视化 | 后续提供 `/dream-log`、`/dream-restore`、反思审计视图。                                                                       |
| 安全       | Tool/Sandbox 审计       | 工具执行必须保留 requestId、来源 worker、权限策略和可序列化事件。                                                             |

## 当前验证基线

每次修改 FCP、记忆、sandbox、插件或 MCP 边界后至少运行：

```bash
bun run format:check
bun run check
bun test
bun run test:session:stress
bun run test:memory:stress
bun run build:binary
```
