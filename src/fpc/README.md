# Flyflor Composition Protocol

`src/fpc` 是 Flyflor 的公共协议层。目录名暂时保留，但语义上已经是 FCP（Flyflor Composition Protocol，旧称 FPC）：它不承载业务决策，也不变成工具箱；它只保存跨层稳定契约、组件登记方式、事件协议、依赖注入和进程信封。

FCP 借鉴 MVC 的分离思想，但不是 Web MVC 的翻版。Flyflor 面向的是智能体运行时，所以更关注“边界控制、能力组合、协议兼容、可观察事件、可拔插装配”。它的目标是让系统保持“入口薄、控制稳、能力隔离、协议清楚、注入清晰”：

- `contracts` 定义跨模块枚举、常量对象、消息、模型、路由和运行上下文类型。
- `decorators` 提供轻量 class metadata，例如 `@Provide`、`@FlyFlor`、`@Gateway`、`@Channel`、`@Command`、`@Blackboard`、`@Memory`、`@Session`、`@Sandbox`、`@Skill`、`@Mcp`、`@McpService`、`@Plugin`、`@Tool`、`@Worker`、`@Component`。
- `factory` 读取 metadata、做组件构造/类型校验，并提供显式 token/provider DI 容器，避免 registry 里出现复杂 switch。
- `composition` 存放必须复用的纯组合函数和 metadata 存储，不放领域业务。
- `events` 定义全局事件类型、sink 和全局 event bus；事件创建这类纯组合函数放在 `composition`。
- `processes` 定义 worker/subprocess 的信封协议与 supervisor。

FCP 子目录统一通过 `index.ts` 暴露 public API。复杂实现文件使用点分命名，例如 `component.metadata.ts`、`runtime.event.ts`、`dependency.container.ts`；跨目录导入优先使用目录入口。

## 分层哲学

| 层          | 角色                                         | 典型组件                                                                                            |
| ----------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Composition | 装配根，只连线不做业务                       | `@FlyFlor`、`src/flyflor.ts`、未来 CLI/TUI composition root                                         |
| Control     | 控制边界、权限、状态流向和降级策略           | `src/control`、`@Gateway`、`@Channel`、`@Blackboard`、`@Memory`、`@Session`、`@Sandbox`、`@Command` |
| Runtime     | 编排一轮 turn，连接控制器和能力模块          | `@Runtime`                                                                                          |
| Capability  | 提供模型、worker、工具、检索、文件等具体能力 | `src/core`、LLM provider、worker provider、skills、MCP adapter                                      |
| Extension   | 兼容外部生态并接入插件扩展                   | `@Skill`、`@Mcp`、`@McpService`、`@Plugin`                                                          |
| Process     | 隔离子进程、worker 和 stdio 服务             | process envelope、supervisor                                                                        |
| Protocol    | 跨层稳定语言，不拥有业务状态                 | contracts、events、metadata                                                                         |

Control 层不是 MVC 里的“页面控制器”。在 Flyflor 里它表示智能体系统的边界控制器：

1. Gateway/Channel 控制外部输入如何进入统一消息协议。
2. Session 控制 session identity、live messages、timeline 和 history 固化。
3. Blackboard 控制黑板 turn、step、decision、session lease 和交还状态，不能直接执行 worker 模型调用或长期记忆 promotion。
4. Memory 控制长期记忆、检索记忆、promotion 链路和记忆权重，不能让模型输出绕过记忆边界。
5. Sandbox 控制工具、文件、shell、网络和插件权限，不能让能力模块自行决定安全策略。
6. WorkerManager 控制 worker registry、pool、队列、并发、超时和事件；具体 worker 能力由 `src/core/workers` 提供。
7. Command 控制 CLI/TUI 指令入口，不能绕开 runtime 直接驱动 agent loop。

Runtime 层只编排 turn，不拥有渠道协议、记忆存储细节或 sandbox 执行细节。Capability 层只提供能力，不反向依赖 gateway 或 app 入口。

## Provider 语义

`@Provide` 是 FCP 的注入底座。它登记 provider token 和 scope，但不负责实例化、不扫描目录、不执行第三方代码。

`@Gateway`、`@Blackboard`、`@Memory`、`@Session` 是语义化 provider：底层统一进入 `@Provide`，同时保留各自的 `kind/layer/name`。这样 registry、插件和 composition root 可以按 provider 统一装配，工程师读代码时仍能看到明确的控制边界。

## 插件兼容

FCP 的扩展面必须兼容市面上已有的 Skill 和 MCP 生态：

- `@Skill` 面向 `SKILL.md`/技能目录格式，metadata 标记为 `protocol: "skill.md"`。
- `@Mcp` 面向 MCP client/tool adapter。
- `@McpService` 面向 MCP server/service 定义，metadata 标记为 MCP server 协议。
- `@Plugin` 面向 Flyflor 插件包和未来 marketplace。
- `@Tool` 面向本地工具能力，但仍必须受 Sandbox 控制。
- `@Worker` 面向黑板 worker provider，但仍必须受 Runtime/Sandbox 控制。

这些 decorator 只登记 metadata 和兼容协议，不做自动扫描、不执行第三方代码、不绕过 config/secrets/sandbox。真实加载仍由对应 registry、manifest parser 或 service adapter 完成。

## Worker Pool

Worker provider 是类实例，不是目录扫描结果。`FlyFlor` composition root 负责构造实例并注册到 `WorkerManager`；`WorkerManager` 从 `@Worker` metadata 读取语义名称，再统一管理 pool、队列、并发、超时和事件。

默认 runtime 是 `in-process`，FCP 协议已预留 `thread` 和 `process`。后续迁移到 Bun Worker 或子进程时，只替换 WorkerManager adapter，不改变 Blackboard 调用方式。

## Composition Root 与 DI

`@FlyFlor` 标记唯一主类。`app.ts` 只处理版本参数并启动主类；config、model client、runtime、gateway、channel adapters 和 event sink 都在 `src/flyflor.ts` 中提前构造，再通过 `FpcDependencyContainer` 以显式 token/provider 容器注入。入口既可以直接 `new FlyFlor(...)`，也可以走 `getFlyFlor()` 单例 helper。

DI 不能使用反射 metadata、自动扫描、动态 import 或读取 `node_modules` 资产。CLI、TUI 和 gateway 后续复用同一个 `FlyFlor.create()` 约定，避免各入口复制装配逻辑。

DI 绑定语义必须清楚：

- `bindSingleton`：注入已经构造好的稳定依赖。
- `bindProvider`：注册懒加载单例，适合插件 service、channel adapter、MCP service 等可拔插组件。
- `bindFactory`：每次 resolve 都创建新对象，只用于短生命周期对象。

## 规则

新增公共协议时优先放在领域模块内；只有两个以上上层目录确实需要共享，才提升到 FCP。

Decorator 只登记 metadata，不做自动扫描或隐藏执行；DI 只能由 composition root 使用显式 token/provider 容器完成。Event 是全局可观察协议，payload 必须 JSON 可序列化，事件名必须来自 `FpcEventType`。
