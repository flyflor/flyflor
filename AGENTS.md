# Flyflor Agent Rules

本仓库使用 Bun + TypeScript 开发，并计划编译为独立二进制。所有自动化开发代理必须先遵守 [docs/boundaries.md](docs/boundaries.md)。

硬性规则：

- 只使用 Bun 命令管理依赖和脚本，不要求用户安装 Node.js。
- 配置固定走 `~/.flyflor/.config/config.jsonc`，Docker dev 对应 `./docker/config/config.jsonc`；所有 JSON 配置必须兼容 JSONC。
- 业务配置不能走环境变量；provider、模型、渠道凭据、沙箱策略和网关行为必须走 config/secrets provider。
- 约定大于配置：默认目录、默认 provider、默认 channel registry 应在代码里有清晰约定，配置只覆盖差异。
- 该使用枚举/常量对象时不要裸写字符串；新增协议值先放入 `src/protocol/contracts/enums.ts` 并经 `src/protocol/contracts/index.ts` 暴露，或放入对应 registry。
- 新增内部结构化协议块必须先登记到 `src/protocol/structured.block.ts`；业务模块只做对应 JSON payload 校验，不得各自手写 tag、边界符或剥离逻辑。
- 新增代码必须带必要注释说明边界、生命周期、副作用或协议意图；修改旧代码时同步补齐被触碰路径的关键注释，避免无上下文的隐式行为。
- 目录入口统一为 `index.ts`；禁止新增 `*.exports.ts`。有明确角色的实现文件、脚本、提示词和内部模板必须使用点分后缀，例如 `module.ts`、`memory.component.ts`、`blackboard.ts`、`manager.ts`、`http.adapter.ts`、`sqlite.store.ts`、`blackboard.route.md`、`blackboard.route.zh.cn.md`；每一份仓库 Markdown 源文件都必须有同目录同名 `.zh.cn.md` 中文副本；提示词工程模板的 canonical `.md` 用英文书写，`.zh.cn.md` 用中文同步维护；其他文档允许 `.md` 直接中文书写，但仍要同步 `.zh.cn.md` 便于中英对照审查；目录已经表达职责时使用短名，例如 `composition/component.ts`、`factory/container.ts`、`streaming/visibility.ts`，大模块按生命周期/职责拆子目录，例如 `memory/dream/worker.ts`、`memory/consolidation/worker.ts`、`memory/lifecycle/scheduler.ts`；不要回退到 `component.metadata.ts`、`dependency.container.ts`、`protocol.visibility.ts`、`dream.worker.ts` 这类重复命名；不要新增连字符或下划线命名的仓库文件。
- 只保留必要 decorator：`@Module`、`@Provide`、`@Inject`、`@Component`、`@Worker`、`@Channel`、`@Plugin`。
- `@Provide` 是注入底座；Gateway、Blackboard、Memory、Runtime、Sandbox 通过 `class XModule extends X` 表达边界语义，不再新增专门 decorator。
- 入口必须保持薄：`app.ts` 只启动 FlyFlor 主类；依赖注入只能在 composition root 使用显式 token/provider 容器，不做反射扫描或动态加载。
- Docker dev 保持简单：挂载工作目录、`./docker/config` 和已编译 Linux 二进制；不要在 Compose 里安装依赖或构建项目。
- Provider 必须支持内置默认 profile + 用户覆盖；新增厂商时先预留空配置和默认模型列表。
- 新增运行时依赖前必须确认其兼容 `bun build --compile`，避免 native addon、postinstall、动态 require 和运行时读取 `node_modules` 资产。
- 保持目录边界：入口只装配，`src/cognitive` 负责 mindstream、crystal、hippocampus 认知层，`src/executive` 负责 registry、planner、guard 执行层，`src/agent` 负责 runtime、gateway、blackboard、sandbox、context、skills、worker、MCP 和 plugin，`src/events` 负责事件广播中枢，`src/protocol` 负责公共协议，`src/agent/di` 负责 metadata 和显式 provider 容器。历史旧物理路径 `src/fch`、旧执行层路径、`src/skills`、`src/context` 已移除，禁止新增兼容壳或回写旧路径。
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
- 每次暂停、结束或准备切换环境前，必须先更新根目录 `TODO.md`、`LOGS.md`、`docs/development.workflow.md`、`docs/development.workflow.zh.cn.md`，并 push 所有需要保留的分支。
