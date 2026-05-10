# Flyflor 架构重构计划

这份文档记录当前达成的架构约定。代码已经移出历史过渡结构，收敛为 `llm` / `crystal` / `neural` / `agent` / `agent/di` / `protocol` 等语义目录。

## 已确认的核心分层

| 层         | 定位              | 说明                                                        |
| ---------- | ----------------- | ----------------------------------------------------------- |
| `llm`      | 流体智力          | 模型协议、OpenAI/Anthropic 兼容、流式输出、provider factory |
| `crystal`  | 晶体智力          | 反思候选、晶体化、skill 生成、方法论沉淀                    |
| `neural`   | 海马体 / 关联网络 | SurrealDB、空间记忆、符号关系、召回、遗忘曲线               |
| `agent`    | 智能体边界与能力  | runtime、gateway、blackboard、session、sandbox、worker、MCP |
| `agent/di` | 依赖注入层        | `@Module`、`@Provide`、`@Inject`、token/provider registry   |
| `protocol` | 语义协议层        | 枚举、事件、消息、错误、公共 contract                       |
| `config`   | 配置层            | JSONC 配置、默认值、路径、secrets provider                  |
| `app`      | 装配入口          | composition root、启动流程                                  |

## 明确不设独立层的内容

没有单独的 `interface` 层。

接口文件只允许作为模块内的局部约定存在，例如：

- `agent/runtime/interface.ts`
- `agent/blackboard/interface.ts`
- `llm/openai/interface.ts`

原则是：

1. `interface.ts` 贴着所属模块放。
2. 不把接口层抽成全局目录。
3. 接口文件只承载类型、协议和轻量声明，不承载业务实现。

同样不设独立 `service` 层。`@Service` 可以作为 provider 语义，但 service 文件必须贴着所属模块放，例如：

- `agent/runtime/runtime.service.ts`
- `neural/memory/recall.service.ts`
- `crystal/reflection/crystallizer.service.ts`

Service 的定位是模块内领域服务或应用服务，不是新的顶层分层。

## Decorator 约定

保留：

- `@Module()`
- `@Provide()`
- `@Inject()`
- `@Service()`
- `@Component()`
- `@Worker()`
- `@Channel()`
- `@Plugin()`

调整方向：

- `Gateway`、`Memory`、`Runtime`、`Session`、`Sandbox`、`Blackboard` 不再作为独立语义 decorator。
- 这些边界改用 `class XModule extends X` 表达面向对象语义，provider 由 `@Provide` + token 显式注入。
- `@Service` 是贴着模块使用的 `@Provide` 语义糖，不形成独立 service 层。
- `@Component` 保留给扩展组件声明，例如 `class A extends Skill`、`class B extends MCPService`、`class C extends MCPClient`。
- `Skill`、`MCPService`、`MCPClient` 应优先成为抽象基类或 interface，具体实现用 `@Component()` 声明，而不是继续扩散 `@Skill`、`@Mcp`、`@McpService` decorator。

## 迁移顺序

1. 先把 DI 基础改成 `@Module` / `@Provide` / `@Inject`。
2. 再把 `Gateway`、`Memory`、`Runtime` 拆成各自 module。
3. `protocol` 已抽离成独立语义层。
4. 目录搬迁已完成，后续只做模块内局部收敛。

## 当前落地状态

- 已新增 `@Module`、`@Service`、`@Inject` 元数据。
- 已新增并启用 `app`、`agent/di`、`protocol`、`llm`、`crystal`、`neural`、`agent` 语义入口。
- `src/app.ts` 已通过这些语义入口完成顶层装配导入。
- 历史过渡目录已移除；LLM、晶体记忆、海马体记忆、worker 能力、协议和 DI 均已物理归位。

当前 TypeScript 核心路径在：

- `src/agent/runtime`
- `src/agent/blackboard`
- `src/agent/session`
- `src/agent/worker`
- `src/neural/memory`
- `src/crystal/memory`
- `src/crystal/reflection`
- `src/llm`
- `src/protocol`
- `src/agent/di`
