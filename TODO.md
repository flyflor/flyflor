# Flyflor 工作进度 / Roadmap

当前目标：保持运行时、Docker dev、CLI/TUI、记忆、黑板和 DI 结构可编译、可验证、可打包，然后围绕晶体智力和空间记忆继续迭代。

Current goal: keep the runtime buildable, testable, binary-friendly, and cleanly layered while evolving crystal intelligence and spatial memory.

## 当前状态

| Area       | 状态        | 说明                                                                                                      |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| Runtime    | Done        | `RuntimeModule extends Runtime`，支持 direct / direct-with-watch / blackboard 路由                        |
| Gateway    | Done        | `GatewayModule extends Gateway`，所有 channel adapter 统一走 streaming dispatcher                         |
| Blackboard | Done        | `BlackboardModule extends Blackboard`，worker plan 由路由模板动态生成，支持首轮收敛、5 轮硬上限和编号反抛 |
| Memory     | Done        | Markdown + SQLite + internal vector index + Crystal candidate/skill 链路已接通                            |
| Crystal    | In progress | candidate、atom、skill 已有；graph edge、深度唤醒、遗忘曲线仍需强化                                       |
| CLI/TUI    | In progress | `src/command` 已迁移，配置、状态、Markdown 渲染和基础 TUI 已接通                                          |
| Docker dev | Done        | `bun run docker:dev` 刷新模板、编译 Linux binary、重启 `flyflor-dev`                                      |
| DI         | Done        | 只保留 `@Module`、`@Provide`、`@Inject`、`@Service`、`@Component`、`@Worker`、`@Channel`、`@Plugin`       |
| Docs       | In progress | README 已压缩为入口文档；细节归档到 `docs/*`                                                              |

## P0-P5 问题清单

| Priority | Problem                    | 当前处理                                                                                                          | 验收                                                   |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| P0       | 工程结构必须干净           | 已移除历史过渡目录；worker 基础设施和能力实现已合并到 `src/agent/worker`                                          | `bun run check`、路径扫描无旧目录                      |
| P0       | Decorator 不能膨胀         | 已删除 Gateway/Session/Memory/Runtime/Sandbox/Blackboard 等专门 decorator；边界语义改为 `class XModule extends X` | decorator 目录只剩允许清单                             |
| P0       | Docker dev 必须立即可用    | 已刷新 Docker 模板并重建 `dist/flyflor-linux`；`flyflor-dev` 已重启                                               | `/health` 返回 ok，容器内 `flyflor --help` 正常        |
| P0       | Prompt 不能硬编码          | 必要提示词集中到 `templates/prompts`，Docker dev 同步到 `docker/config/prompts`                                   | 每个英文模板都有 `.zh-CN.md` 审查副本                  |
| P1       | 晶体智力需要证据门         | 零证据候选只审计，不生成 atom/skill                                                                               | 垃圾候选压力测试不污染 skill                           |
| P1       | 空间记忆需要关联图         | SurrealDB 已作为 Crystal store；graph edge、recall trace、cluster 仍需扩展                                        | candidate/atom/skill/turn/worker/evidence 可形成关系边 |
| P1       | 自动聚类不能写死           | 反思模板生成 symbols、bucketHint、coordinates；源码不维护固定 bucket                                              | 扫描源码无业务 taxonomy/关键词桶                       |
| P1       | 深度唤醒要兼顾延迟         | 待实现 hop/top-k/timeout/cache 预算                                                                               | 命中率压测和延迟分位数报告                             |
| P2       | 黑板收敛不能拖轮次         | 已支持首轮 final/blocked；非决定性才继续 QA                                                                       | 简单问题不进黑板，可结论问题首轮收敛                   |
| P2       | needs-user 要结构化        | 已按 1-n 编号 unresolved issues，避免重复大段 blocker                                                             | 封顶测试输出简洁问题列表                               |
| P2       | direct-with-watch 要补升级 | 当前作为可观测直通模式；工具 churn、重复失败、上下文压力升级仍待补齐                                              | watch 触发 restore point 并以 blackboard 重跑          |
| P3       | CLI/TUI 要工业化           | CLI 命令面已迁到 `src/command`，TUI 有基础面板                                                                    | 后续补 channel 连接状态、黑板讨论、晶体审计视图        |
| P3       | Channel 要稳定可观测       | Gateway status snapshot 已统一；平台 adapter 继续补交互细节                                                       | `/channels`、CLI、TUI 展示一致状态                     |
| P3       | Provider 要自动兼容        | OpenAI/Anthropic compatible factory 已拆分；custom provider 可多实例                                              | base URL `/v1` 自动兼容，支持流式优先                  |
| P4       | Skill/MCP 要组件化         | 后续使用 `@Component class A extends Skill/MCPService/MCPClient`                                                  | manifest/registry 接入，无动态扫描                     |
| P4       | Sandbox 要审计化           | `SandboxModule` 已有策略摘要；真实工具执行、审批、事件审计待接入                                                  | 每次工具执行有 requestId、来源、权限结果               |
| P4       | Worker 要进程隔离          | 已有 `json-process` / `persistent-json-process`                                                                   | raw stdio/PTY TUI adapter 复用 WorkerManager 语义      |
| P5       | 一键安装要轻量             | 模板可复制安装；Docker dev 验证二进制路径                                                                         | 安装只复制模板、配置和 binary，不污染 workspace        |
| P5       | 文档要保持清爽             | README 做入口，TODO 做路线图，docs 放细节                                                                         | stale term 扫描和 format/check 通过                    |

## 已完成

| Module       | Done                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Architecture | `app.ts` 薄入口，`src/app.ts` composition root，`src/agent` 边界模块，`src/command` 命令层   |
| DI           | 显式 token/provider container；不做反射扫描，不做动态目录加载                                |
| Runtime      | direct / direct-with-watch / blackboard 路由模板接入                                         |
| LLM          | OpenAI-compatible 与 Anthropic-compatible 分层，支持流式优先、非流式回落                     |
| Gateway      | API、webhook、stdio、iLink 等 channel adapter registry                                       |
| Blackboard   | SQLite turn/step/decision/lease，通用模型 worker，角色/数量由 `blackboard-route.md` 动态生成 |
| Memory       | Markdown source of truth、SQLite session/history、内部向量索引、Crystal candidate            |
| Crystal      | candidate -> atom -> skill 基础链路，SurrealDB store，证据门                                 |
| Templates    | `templates/prompts` 和 `templates/memory` 均有 `.zh-CN.md` 副本                              |
| Docker       | `docker:dev` 自动刷新模板、构建 Linux binary、重启 dev container                             |
| Tests        | command/memory/reflection/blackboard/workers 边界测试通过                                    |

## 进行中

| Module     | Next                                                                |
| ---------- | ------------------------------------------------------------------- |
| Crystal    | graph edge、cluster、recall trace、reuse feedback、forgetting state |
| Reflection | 后台 reflection worker，从热路径拆出可调度、可审计、可重跑          |
| TUI        | 黑板讨论格式化、channel 状态、晶体记忆审计、思考中状态              |
| Gateway    | 各渠道连接状态、引用/评论/输入中状态、平台级错误反馈                |
| Sandbox    | 工具执行审计、审批流、MCP/tool 权限边界                             |
| Plugins    | plugin manifest、marketplace index、binary compatibility checks     |

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
