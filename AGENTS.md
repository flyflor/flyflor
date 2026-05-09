# Flyflor Agent Rules

本仓库使用 Bun + TypeScript 开发，并计划编译为独立二进制。所有自动化开发代理必须先遵守 [docs/BOUNDARIES.md](docs/BOUNDARIES.md)。

硬性规则：

- 只使用 Bun 命令管理依赖和脚本，不要求用户安装 Node.js。
- 配置固定走 `~/.flyflor/config.jsonc`，Docker dev 对应 `./docker/config/config.jsonc`；所有 JSON 配置必须兼容 JSONC。
- 业务配置不能走环境变量；provider、模型、渠道凭据、沙箱策略和网关行为必须走 config/secrets provider。
- 约定大于配置：默认目录、默认 provider、默认 channel registry 应在代码里有清晰约定，配置只覆盖差异。
- 该使用枚举/常量对象时不要裸写字符串；新增协议值先放入 `src/fpc/contracts/enums.ts` 并经 `src/fpc/contracts/index.ts` 暴露，或放入对应 registry。
- 目录入口统一为 `index.ts`；复杂源码文件使用点分命名，例如 `component.factory.ts`，不要新增连字符源码文件。
- 优先使用 `@Provide`、`@FlyFlor`、`@Gateway`、`@Channel`、`@Command`、`@Blackboard`、`@Memory`、`@Session`、`@Sandbox`、`@Runtime`、`@Skill`、`@Mcp`、`@McpService`、`@Plugin`、`@Tool`、`@Worker`、`@Component` 这类 FCP decorator metadata 组织注册，不写复杂工厂。
- `@Provide` 是注入底座；`@Gateway`、`@Blackboard`、`@Memory`、`@Session` 等 decorator 是语义化 provider，不能为了统一注入牺牲控制边界语义。
- 入口必须保持薄：`app.ts` 只启动 `@FlyFlor` 主类；依赖注入只能在 composition root 使用显式 token/provider 容器，不做反射扫描或动态加载。
- Docker dev 保持简单：挂载工作目录、`./docker/config` 和已编译 Linux 二进制；不要在 Compose 里安装依赖或构建项目。
- Provider 必须支持内置默认 profile + 用户覆盖；新增厂商时先预留空配置和默认模型列表。
- 新增运行时依赖前必须确认其兼容 `bun build --compile`，避免 native addon、postinstall、动态 require 和运行时读取 `node_modules` 资产。
- 保持目录边界：入口只装配，`src/control` 负责边界控制、WorkerManager/pool 和 runtime 编排，`src/core` 负责 LLM/workers/skills/MCP 等能力内核，`src/fpc` 负责公共协议。
- 不把密钥、`.env`、日志、会话数据库、用户工作区数据编译进二进制。
- 不绕过 sandbox 执行文件写入、shell、网络、插件或 MCP 工具。
- 跨模块通信使用显式类型；公共事件和协议必须可 JSON 序列化。
- 修改边界、高风险工具或依赖策略时，同步更新 `docs/BOUNDARIES.md`。

常用验证：

```bash
bun run check
bun run build:binary
```
