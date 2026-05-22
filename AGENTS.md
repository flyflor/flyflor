# Flyflor Agent Rules

本仓库使用 Bun + TypeScript 开发，并计划编译为独立二进制。所有自动化开发代理必须先遵守 [docs/boundaries.md](docs/boundaries.md)。

硬性规则：

- 只使用 Bun 命令管理依赖和脚本，不要求用户安装 Node.js。
- 本仓库只承载 Bun + TypeScript 内核；Rust 外壳实现不在本仓库内规划、落地或验证，相关文档只作为后续独立 Rust 仓库的 `/ws` 契约交接材料。
- 配置固定走 `~/.flyflor/.config/config.jsonc`，Docker dev 对应 `./docker/config/config.jsonc`；所有 JSON 配置必须兼容 JSONC。
- 业务配置不能走环境变量；provider、模型、渠道凭据、沙箱策略和网关行为必须走 config/secrets provider。
- 约定大于配置：默认目录、默认 provider、默认 channel registry 应在代码里有清晰约定，配置只覆盖差异。
- Flyflor 是智能生命体内核，不是 chat/session agent。LLM 是流体智力，`MemoryComponent` 是热区记忆，`CrystalComponent` 是晶体智力，显式 `Scope` / `ContextFork` 是固化工作域，`ASK` 是不确定性、结晶、升格和长线 loop 的闭环器官。
- `brain.db` 是按月生命账本，只负责 ledger/query/replay/audit/detail；它不参与 prompt/context assembly，不是 session store，也不是 prompt 容器。上下文装配主语只能是当前输入、`MemoryComponent`、`CrystalComponent`、显式 `Scope/Fork` 和 Executive 可见能力面。
- `src/socket` 是外显 socket 血管层，承载 live turn、event、operation、ledger query/replay；WebSocket 只是当前默认 transport，不是目录主语。`gateway.*` wire 名称只作为 `flyflor.ws.v1` compatibility 保留，不代表架构仍是 Gateway/session/chat 模型。
- `clientId`、`conversationKey`、`user.id`、`threadId`、connection 和 transport metadata 只允许用于 live peer、routing、audit、dedup、reply anchor；它们不承担认知连续性，也不能决定当前 scope、memory owner 或 prompt 装配。
- 该使用枚举/常量对象时不要裸写字符串；新增协议值先放入 `src/protocol/contracts/enums.ts` 并经 `src/protocol/contracts/index.ts` 暴露，或放入对应 registry。
- 新增内部结构化协议块必须先登记到 `src/protocol/structured.block.ts`；业务模块只做对应 JSON payload 校验，不得各自手写 tag、边界符或剥离逻辑。
- 新增代码必须带必要注释说明边界、生命周期、副作用或协议意图；修改旧代码时同步补齐被触碰路径的关键注释，避免无上下文的隐式行为。
- 目录入口统一为 `index.ts`；禁止新增 `*.exports.ts`。有明确角色的实现文件、脚本、提示词和内部模板必须使用点分后缀，例如 `module.ts`、`memory.component.ts`、`blackboard.ts`、`manager.ts`、`http.adapter.ts`、`sqlite.store.ts`、`blackboard.route.md`、`blackboard.route.zh.cn.md`。`templates/**` 中所有 Markdown 模板必须保持 canonical `.md` 与 `.zh.cn.md` 一一对应；运行时只加载 canonical `.md`，`.zh.cn.md` 只是中文镜像审查副本，不进入 manifest 或上下文装配。`README.md` 必须是英文入口并索引 `docs/*.md`，`README.zh.cn.md` 是中文对照并索引 `docs/*.zh.cn.md`；`AGENTS.md`、`TODO.md`、`LOGS.md` 默认中文书写，不创建、不保留 `.zh.cn.md` 副本。目录已经表达职责时使用短名，例如 `composition/component.ts`、`factory/container.ts`、`streaming/visibility.ts`，大模块按生命周期/职责拆子目录，例如 `memory/dream/worker.ts`、`memory/consolidation/worker.ts`、`memory/lifecycle/scheduler.ts`；不要回退到 `component.metadata.ts`、`dependency.container.ts`、`protocol.visibility.ts`、`dream.worker.ts` 这类重复命名；不要新增连字符或下划线命名的仓库文件。
- 只保留必要 decorator：`@Module`、`@Provide`、`@Inject`、`@Component`、`@Worker`、`@Channel`、`@Plugin`。
- `@Provide` 是注入底座；Socket、Blackboard、Memory、Runtime、Sandbox 通过 `class XModule extends X` 表达边界语义；Gateway 只保留为 v1 wire/compatibility alias，不再新增专门 decorator。
- 入口必须保持薄：`app.ts` 只启动 FlyFlor 主类；依赖注入只能在 composition root 使用显式 token/provider 容器，不做反射扫描或动态加载。
- Docker dev 保持简单：挂载工作目录、`./docker/config` 和已编译 Linux 二进制；不要在 Compose 里安装依赖或构建项目。
- Provider 必须支持内置默认 profile + 用户覆盖；新增厂商时先预留空配置和默认模型列表。
- 新增运行时依赖前必须确认其兼容 `bun build --compile`，避免 native addon、postinstall、动态 require 和运行时读取 `node_modules` 资产。
- 保持目录边界：入口只装配，`src/cognitive` 负责 mindstream、crystal、hippocampus 认知层，`src/executive` 负责 registry、planner、guard 执行层，`src/socket` 负责 socket 血管层，`src/agent` 负责 runtime、blackboard、sandbox、context、skills、worker、MCP 和 plugin，`src/events` 负责事件广播中枢，`src/protocol` 负责公共协议，`src/agent/di` 负责 metadata 和显式 provider 容器。历史旧物理路径 `src/fch`、旧执行层路径、`src/skills`、`src/context` 以及迁移后的 `src/agent/gateway` 已移除或待退场，禁止新增兼容壳或回写旧路径。
- 不把密钥、`.env`、日志、运行态数据库、用户工作区数据编译进二进制。
- 不绕过 sandbox 执行文件写入、shell、网络、插件或 MCP 工具。
- 跨模块通信使用显式类型；公共事件和协议必须可 JSON 序列化。
- 修改边界、高风险工具或依赖策略时，同步更新 `docs/boundaries.md`。
- **零字符匹配红线**：业务语义判断（意图、路由、记忆动作、反馈分类、固化触发、矛盾检测、复杂度评估等）只能由模型同轮返回的结构化字段或专用提示词模板的 JSON 输出驱动。禁止任何 `text.includes(...)`、正则识别意图、关键词列表、句式启发式、情感词典、句末标点判断等硬编码语义规则。性能优化只能用资源指标（token 数、向量相似度、TTL、cluster size）短路，不得用关键词短路。详见 `docs/boundaries.md`「业务语义判断零字符匹配（全局红线）」章节。

常用验证：

```bash
bun run check
bun run build:binary
```

协调者附加规则：

- 当前主线目标是完成“智能生命体内核”的大重构，而不是只维持局部 seal。
- 当工作再次扩成多切片时，优先通过 `git worktree + tmux + Codex` 拆并行切片，提高吞吐。
- 每次暂停、结束或准备切换环境前，必须先更新根目录 `TODO.md`、`LOGS.md` 和 `docs/development.workflow.md`，并 push 所有需要保留的分支。
- 主线迭代优先收缩暴露面：能删的 HTTP 状态口优先删，若 WS 控制面已经提供同等结构化快照，就不要再保留重复 REST 入口。
- HTTP surface 固定收缩为 `/ws` 与 `/health`；`/channels` 不恢复。需要状态、能力、历史、事件和 live turn 时走 socket control/event wire，不新增重复 REST 状态口。
- 当前 release-seal 下一阶段聚焦 Bun 内核真实封板：OpenAPI/Apifox 契约、真实配置模型的 socket 场景、prompt 优化、DB/context guard、release/binary 验证；不得把精力转回本仓库内 Rust 实现。
