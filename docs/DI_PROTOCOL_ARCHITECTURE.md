# DI / Protocol 架构说明

Flyflor 当前把公共装配与公共协议拆成两个语义层：

- `src/agent/di`：`@Module`、`@Provide`、`@Inject`、`@Service`、`@Component`、扩展声明、module metadata、显式 token/provider 容器、组件 registry。
- `src/protocol`：枚举、消息、事件、运行时 contract、进程信封和 supervisor 协议。

业务能力不放进这两个目录。只要类型、函数或状态只服务某个领域，就必须回到对应模块，例如 `llm`、`crystal`、`neural` 或 `agent`。

## 设计目标

- 入口薄：`app.ts` 只启动 FlyFlor 主类。
- 装配显式：依赖只在 composition root 使用 token/provider 绑定，不做反射扫描。
- 协议稳定：跨模块消息、事件和枚举必须可 JSON 序列化。
- 能力隔离：LLM、worker、skill、MCP、memory 不反向依赖入口层。
- 二进制友好：decorator 只登记 metadata，不动态读取第三方包资产。

## 当前分层

| 层         | 定位              | 职责                                                        |
| ---------- | ----------------- | ----------------------------------------------------------- |
| `llm`      | 流体智力          | 模型协议、OpenAI/Anthropic 兼容、流式输出、provider factory |
| `crystal`  | 晶体智力          | 反思候选、晶体化、skill 生成、方法论沉淀                    |
| `neural`   | 海马体 / 关联网络 | 空间记忆、符号关系、召回、遗忘曲线                          |
| `agent`    | 智能体边界与能力  | runtime、gateway、blackboard、session、sandbox、worker、MCP |
| `agent/di` | 依赖注入          | decorator metadata、module metadata、provider container     |
| `protocol` | 语义协议          | 枚举、事件、消息、错误、公共 contract                       |
| `config`   | 配置              | JSONC 配置、默认值、路径、secrets provider                  |
| `app`      | 装配入口          | root module、bootstrap、composition root                    |

## Decorator

当前保留的 decorator：

- `@Module()`：模块边界。
- `@Provide()`：可注入 provider。
- `@Inject(token)`：显式 token 注入。
- `@Service()`：模块内 provider 语义糖，不形成独立 service 层。
- `@Worker()`、`@Channel()`、`@Plugin()`：扩展声明。
- `@Component()`：保留给 `Skill`、`MCPService`、`MCPClient` 等扩展基类的具体实现声明。

Gateway、Blackboard、Memory、Session、Runtime、Sandbox 不再使用专门 decorator；边界语义通过 `class XModule extends X` 表达，注入 metadata 统一使用 `@Provide`，模块边界统一使用 `@Module`。

## DI 规则

- 只使用 `DependencyContainer` 的显式 token/provider 绑定。
- provider metadata 只声明注入身份，不自动实例化。
- `bindSingleton` 用于稳定依赖，`bindProvider` 用于懒加载单例，`bindFactory` 用于每次创建的新实例。
- 不使用 reflect metadata、自动目录扫描、动态 require/import 或第三方容器。
- 依赖在启动前集中注入，runtime 热路径只 resolve 已注册对象。

## Protocol 规则

- 公共事件名来自 `RuntimeEventType`。
- 事件 payload 必须可 JSON 序列化。
- 跨模块消息和公共协议必须从 `src/protocol` 暴露。
- 领域私有类型放回领域目录的 `types.ts` 或 `index.ts`。
- 进程 worker、stdio、MCP 子进程信封在 `src/protocol/processes`。

修改 `di`、`protocol` 或控制边界后至少运行：

```bash
bun run check
bun test
bun run format:check
```
