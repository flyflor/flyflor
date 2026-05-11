# Flyflor Agent Rules

本仓库使用 Bun + TypeScript 开发，并计划编译为独立二进制。所有自动化开发代理必须先遵守 [docs/boundaries.md](docs/boundaries.md)。

硬性规则：

- 只使用 Bun 命令管理依赖和脚本，不要求用户安装 Node.js。
- 配置固定走 `~/.flyflor/config.jsonc`，Docker dev 对应 `./docker/config/config.jsonc`；所有 JSON 配置必须兼容 JSONC。
- 业务配置不能走环境变量；provider、模型、渠道凭据、沙箱策略和网关行为必须走 config/secrets provider。
- 约定大于配置：默认目录、默认 provider、默认 channel registry 应在代码里有清晰约定，配置只覆盖差异。
- 该使用枚举/常量对象时不要裸写字符串；新增协议值先放入 `src/protocol/contracts/enums.ts` 并经 `src/protocol/contracts/index.ts` 暴露，或放入对应 registry。
- 目录入口统一为 `index.ts`；有明确角色的实现文件、脚本、提示词和内部模板必须使用点分后缀，例如 `runtime.module.ts`、`memory.service.ts`、`blackboard.worker.ts`、`worker.manager.ts`、`http.adapter.ts`、`sqlite.store.ts`、`blackboard.route.md`、`blackboard.route.zh.cn.md`；不要新增连字符或下划线命名的仓库文件。
- 只保留必要 decorator：`@Module`、`@Provide`、`@Inject`、`@Service`、`@Component`、`@Worker`、`@Channel`、`@Plugin`。
- `@Provide` 是注入底座；Gateway、Blackboard、Memory、Session、Runtime、Sandbox 通过 `class XModule extends X` 表达边界语义，不再新增专门 decorator。
- 入口必须保持薄：`app.ts` 只启动 FlyFlor 主类；依赖注入只能在 composition root 使用显式 token/provider 容器，不做反射扫描或动态加载。
- Docker dev 保持简单：挂载工作目录、`./docker/config` 和已编译 Linux 二进制；不要在 Compose 里安装依赖或构建项目。
- Provider 必须支持内置默认 profile + 用户覆盖；新增厂商时先预留空配置和默认模型列表。
- 新增运行时依赖前必须确认其兼容 `bun build --compile`，避免 native addon、postinstall、动态 require 和运行时读取 `node_modules` 资产。
- 保持目录边界：入口只装配，`src/agent` 负责 runtime、gateway、blackboard、session、sandbox、worker 和 MCP，`src/llm`、`src/crystal`、`src/neural` 负责三层智能体能力，`src/protocol` 负责公共协议，`src/agent/di` 负责 metadata 和显式 provider 容器。
- 不把密钥、`.env`、日志、会话数据库、用户工作区数据编译进二进制。
- 不绕过 sandbox 执行文件写入、shell、网络、插件或 MCP 工具。
- 跨模块通信使用显式类型；公共事件和协议必须可 JSON 序列化。
- 修改边界、高风险工具或依赖策略时，同步更新 `docs/boundaries.md`。

常用验证：

```bash
bun run check
bun run build:binary
```
