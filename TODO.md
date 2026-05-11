# Flyflor 工作进度 / Roadmap

当前目标：P0 基线已经收口，后续开发聚焦 Crystal graph/recall、reflection 后台化、TUI/Gateway 可观测、Sandbox 审计和扩展组件接入。

Current goal: keep the closed P0 baseline stable while moving the active backlog toward graph memory, background reflection, observability, sandbox audit, and extension components.

## 当前状态

| Area       | 状态        | 说明                                                                                                      |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| Runtime    | Done        | `RuntimeModule extends Runtime`，支持 direct / direct-with-watch / blackboard 路由                        |
| Gateway    | Done        | `GatewayModule extends Gateway`，所有 channel adapter 统一走 streaming dispatcher                         |
| Blackboard | Done        | `BlackboardModule extends Blackboard`，worker plan 由路由模板动态生成，支持首轮收敛、5 轮硬上限和编号反抛 |
| Memory     | Done        | Markdown + SQLite + internal vector index + Crystal candidate/skill 链路已接通                            |
| Crystal    | In progress | candidate、atom、skill、证据门已接通；graph edge、深度唤醒、遗忘曲线是下一阶段主线                        |
| CLI/TUI    | In progress | `src/command` 已迁移，配置、状态、Markdown 渲染和基础 TUI 已接通；审计/讨论视图待强化                     |
| Docker dev | Done        | `bun run docker:dev` 刷新模板、编译 Linux binary、重启 `flyflor-dev`                                      |
| DI         | Done        | 只保留 `@Module`、`@Provide`、`@Inject`、`@Service`、`@Component`、`@Worker`、`@Channel`、`@Plugin`       |
| Docs       | In progress | README 做入口，TODO 做路线图，细节归档到 `docs/*`                                                         |

## P0-P5 清理结果

| Priority | 结论          | 清理说明                                                                                         |
| -------- | ------------- | ------------------------------------------------------------------------------------------------ |
| P0       | Closed        | 工程结构、decorator 收敛、Docker dev、prompt 模板外置都已进入基线，后续只做回归守护              |
| P1       | Active        | Crystal graph、cluster、recall trace、deep activation、forgetting/reinforcement 是当前最高优先级 |
| P2       | Mostly closed | 黑板首轮收敛、needs-user 编号反抛已落地；`direct-with-watch` 自动升级仍保留为 P2 增强            |
| P3       | Active        | CLI/TUI、channel 状态、provider 兼容已经有底座，下一步补可观测、错误反馈和用户操作面             |
| P4       | Active        | Skill/MCP/Plugin manifest、Sandbox 审计、外部 worker 进程隔离进入扩展能力建设                    |
| P5       | Watch         | 一键安装和文档清爽度作为持续约束，不再阻塞当前开发                                               |

## 已清理基线

| Area         | 已完成                                                                                      | 回归守护                                        |
| ------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Architecture | `app.ts` 薄入口，`src/app.ts` composition root，`src/agent` 边界模块，`src/command` 命令层  | `bun run check`，边界测试                       |
| DI           | 显式 token/provider container；不做反射扫描，不做动态目录加载                               | decorator 目录只保留允许清单                    |
| Runtime      | direct / direct-with-watch / blackboard 路由模板接入                                        | 路由结果只校验枚举和 JSON shape                 |
| Gateway      | API、webhook、stdio、iLink 等 channel adapter registry                                      | `/channels`、CLI、TUI 消费同一 snapshot         |
| Blackboard   | SQLite turn/step/decision/lease，通用模型 worker，动态 worker plan，首轮 final/blocked 收敛 | 简单任务不进黑板，阻塞时输出编号问题            |
| Memory       | Markdown source of truth、SQLite session/history、内部向量索引、Crystal candidate           | 长期记忆 promotion 必须走结构化 action          |
| Crystal      | candidate -> atom -> skill 基础链路，SurrealDB store，零证据不升格                          | 垃圾候选压力测试不污染 skill                    |
| Templates    | `templates/prompts` 和 `templates/memory` 均有 `.zh.cn.md` 审查副本                         | Docker dev 同步到 `docker/config`               |
| Docker       | `docker:dev` 自动刷新模板、构建 Linux binary、重启 dev container                            | `/health` 返回 ok，容器内 `flyflor --help` 正常 |

## 活跃 Backlog

| Priority | Workstream                  | 下一步                                                                           | 验收                                                  |
| -------- | --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| P1       | Crystal graph               | 为 candidate、atom、skill、turn、worker step、evidence、verification 写入关系边  | SurrealDB 可追溯一条 skill 的来源、支持关系和使用记录 |
| P1       | Recall trace                | 记录每次 skill 唤醒原因、命中路径、使用结果和失败反馈                            | TUI/CLI 可查看某次召回为什么发生                      |
| P1       | Deep activation             | 实现 query -> seed skills -> graph expansion -> budgeted rerank                  | 有 hop、top-k、timeout、cache 预算和延迟报告          |
| P1       | Forgetting/reinforcement    | 为 skill/edge 增加 decay、reuse、failure、protected 状态                         | 旧方法会衰减，验证过或高风险方法不会被激进遗忘        |
| P2       | direct-with-watch           | direct 执行时观察工具 churn、重复失败、上下文压力，并支持 restore point 升级黑板 | watch 触发后能以 blackboard 重跑同一 turn             |
| P3       | TUI observability           | 补黑板讨论、channel 状态、晶体记忆审计、思考中状态                               | TUI 展示与 Gateway/Blackboard/Crystal 持久状态一致    |
| P3       | Gateway adapters            | 补引用/评论/输入中状态、平台级错误反馈和 channel 连接诊断                        | `/channels`、CLI、TUI 展示一致且可定位失败原因        |
| P3       | Provider compatibility      | 完善自定义 provider、多实例、streaming fallback 和凭据状态                       | base URL `/v1` 兼容，流式优先，失败可降级             |
| P4       | Sandbox audit               | 接入真实工具执行、审批、MCP/tool 权限事件和审计日志                              | 每次副作用有 requestId、来源、策略、结果              |
| P4       | Skill/MCP/Plugin components | 通过 manifest/registry 接入扩展组件，不做目录扫描                                | 可列出、校验、启停组件且兼容 binary                   |
| P4       | Worker isolation            | 扩展 `json-process` / `persistent-json-process`，补 raw stdio/PTY TUI adapter    | 外部 agent 复用 WorkerManager 队列、超时和事件语义    |
| P5       | Install/update              | 梳理轻量安装、更新、备份和卸载路径                                               | 安装只复制模板、配置和 binary，不污染 workspace       |
| P5       | Docs hygiene                | 保持 README 入口化，TODO 路线图化，docs 设计细节化                               | stale term 扫描、format/check 通过                    |

## 当前推荐执行顺序

1. P1 Crystal graph + recall trace。
2. P1 deep activation 的预算和压测报告。
3. P2 direct-with-watch 自动升级。
4. P3 TUI/Gateway 可观测补齐。
5. P4 Sandbox 审计和扩展组件 manifest。

## 验证基线

每次修改架构、DI、prompt、memory、gateway、sandbox、CLI/TUI 或 Docker dev 后至少运行：

```bash
bun run format:check
bun run check
bun test
bun run build:binary
```

关键链路变更时追加：

```bash
bun run test:session:stress
bun run test:memory:stress
bun run test:reflection:stress
bun run test:blackboard:stress
bun run docker:dev
curl http://127.0.0.1:18790/health
```
