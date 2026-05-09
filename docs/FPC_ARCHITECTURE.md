# FCP 架构说明

FCP（Flyflor Composition Protocol，旧称 FPC）是 Flyflor 的组合协议层。它借鉴 MVC 的分离思想，但不是 Web MVC 的翻版；Flyflor 面向的是智能体运行时，所以 FCP 更关注控制边界、能力组合、协议兼容、依赖注入和全链路可观察。

## 设计目标

- 入口薄：`app.ts` 只启动 `@FlyFlor` 主类，CLI、TUI 和 gateway 入口只做装配或输入归一化。
- 控制稳：Gateway、Blackboard、Memory、Session、Sandbox、Command 负责边界控制，不让能力模块直接决定协作、安全、记忆或会话流向。
- 能力隔离：LLM、workers、skills、MCP、tools、plugins、storage adapter 只提供能力，不反向依赖入口层。
- 协议兼容：Skill、MCP、plugin 都通过 metadata、manifest、config 和 registry 接入，兼容市面已有生态。
- 事件可观察：公共事件必须可 JSON 序列化，事件名来自 `FpcEventType`。
- 二进制友好：Decorator 只登记 metadata，不做运行时扫描、动态 require 或读取第三方包资产；DI 使用显式 token/provider 容器。

## 分层

| 层          | 职责                                           | 当前落点                                                                                            |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Composition | 装配根，只连线不做业务                         | `@FlyFlor`、`src/flyflor.ts`，未来 CLI/TUI composition root                                         |
| Control     | 控制边界、权限、状态流向和降级策略             | `src/control`、`@Gateway`、`@Channel`、`@Command`、`@Blackboard`、`@Memory`、`@Session`、`@Sandbox` |
| Runtime     | 编排一轮 turn，连接控制器和能力模块            | `@Runtime`、`AgentRuntime`                                                                          |
| Capability  | 提供模型、worker、工具、检索、文件、存储等能力 | `src/core`、LLM provider、worker provider、skills、MCP adapter                                      |
| Extension   | 兼容外部生态并接入插件扩展                     | `@Skill`、`@Mcp`、`@McpService`、`@Plugin`                                                          |
| Process     | 隔离子进程、worker 和 stdio 服务               | process envelope、supervisor                                                                        |
| Protocol    | 跨层稳定语言，不拥有业务状态                   | contracts、events、metadata                                                                         |

## Control 层

Control 层不是 MVC 里的页面控制器，而是智能体运行时的边界控制器。

- Gateway/Channel 控制外部输入如何进入统一消息协议。
- Blackboard 控制黑板 turn、step、decision、session lease 和交还状态，不直接执行 worker 模型调用。
- Session 控制 session identity、live messages、timeline 和 history 固化。
- Memory 控制长期记忆、检索记忆、promotion 链路和记忆权重，不拥有 session identity 规则。
- Sandbox 控制工具、文件、shell、网络、插件和 MCP 的执行权限。
- WorkerManager 控制 worker registry、pool、队列、并发、超时和事件；具体 worker 能力由 `src/core/workers` 提供。
- Command 控制 CLI/TUI 指令入口，不能绕过 Runtime 直接驱动 agent loop。

Control 层可以调用 Runtime facade 或领域能力，但 Capability 不能反向依赖 Control。任何工具、插件、MCP service 都必须经过 Sandbox 和 Runtime 的边界。

## Decorator Metadata

FCP decorator 只登记 class metadata，不自动扫描、不执行第三方代码。依赖注入由 `@FlyFlor` composition root 使用显式 token/provider 容器完成，不依赖反射 metadata。

当前支持：

- `@Provide`
- `@FlyFlor`
- `@Gateway`
- `@Channel`
- `@Command`
- `@Blackboard`
- `@Memory`
- `@Session`
- `@Sandbox`
- `@Runtime`
- `@Skill`
- `@Mcp`
- `@McpService`
- `@Plugin`
- `@Tool`
- `@Worker`
- `@Component`

Metadata 字段：

| 字段            | 说明                                                       |
| --------------- | ---------------------------------------------------------- |
| `kind`          | 组件类型，例如 `gateway`、`memory`、`skill`、`mcp-service` |
| `layer`         | FCP 分层，例如 `control`、`runtime`、`extension`           |
| `name`          | registry 或 manifest 使用的稳定名称                        |
| `compatibility` | 兼容协议说明，例如 `skill.md`、`mcp`、`mcp-server`         |
| `provider`      | 注入声明，例如 `scope: singleton`、`token: control.memory` |
| `tags`          | 轻量标签，供 registry、文档或后续插件市场使用              |

`@Provide` 是 FCP 的注入底座。`@Gateway`、`@Blackboard`、`@Memory`、`@Session` 这类 decorator 是语义化 provider：它们底层登记 `provider` metadata，同时保留 `kind/layer/name`，让代码既能统一注入，也能保持控制边界语义。

## Composition Root 与 DI

`@FlyFlor` 是 Flyflor 的主类身份。`src/flyflor.ts` 在启动前构造并注入 config、event sink、model client、runtime、gateway 和 channel adapters；`app.ts` 只保留版本参数处理和 `getFlyFlor().start()`。

DI 规则：

- 只使用 `FpcDependencyContainer` 的显式 token/provider 绑定。
- provider metadata 只声明注入身份，不自动实例化；真实实例由 `@FlyFlor` composition root 或后续 registry 显式绑定。
- `bindSingleton` 用于已构造稳定依赖，`bindProvider` 用于懒加载单例，`bindFactory` 只用于确实需要每次创建的新实例。
- 不使用 reflect metadata、自动目录扫描、动态 require/import 或第三方容器。
- 依赖在启动前集中注入，runtime 热路径只 resolve 已注册对象，不临时拼装未声明 provider。
- CLI/TUI 后续复用同一个主类，避免入口重复装配。

## Skill 与 MCP 兼容

Flyflor 后续要兼容已有 Skill 和 MCP 生态，但兼容不等于让第三方代码直接进入热路径。

- Skill：以 `SKILL.md`/技能目录为兼容协议，`@Skill` 只标记 metadata；加载仍由 skills registry 和 manifest parser 控制。
- MCP：`@Mcp` 表示 MCP client/tool adapter，`@McpService` 表示 MCP server/service；连接、授权、stdio/http 生命周期仍由 MCP 模块和 process/sandbox 管理。
- Plugin：`@Plugin` 标记 Flyflor 插件包，后续 marketplace 需要做二进制兼容、权限声明和签名/来源审计。
- Tool：`@Tool` 标记本地能力，但执行必须经过 Sandbox。
- Worker：`@Worker` 标记黑板可调度能力，但执行仍必须经过 Runtime/Sandbox 边界。

## Worker 管理

Worker 是 Flyflor 后续常用的并行能力单元。FCP 用 `@Worker` 登记能力身份，`FlyFlor` composition root 把 worker 类实例注册到 `WorkerManager`。WorkerManager 不扫描目录、不动态加载包，只管理已经注入的实例。

当前默认 runtime 是 `in-process`，并已提供 `json-process` 和 `persistent-json-process` 动态 adapter。它们用 stdin/stdout 行 JSON 对接外部 agent/TUI wrapper，例如 Codex、Claude、Kimi、OpenCode、deepseek-tui；协议不走 SSE，不把讨论判断塞进通信层。每个 worker 拥有独立 pool，默认并发为 1，队列、超时和事件统一治理。迁移到 Bun Worker 或子进程时，外层仍通过同一个 WorkerManager 调用，不改变 Blackboard/Runtime 的语义。

## 事件

事件是全局可观察协议，不是业务控制流。

- 事件名必须来自 `FpcEventType`。
- payload 必须可 JSON 序列化。
- 不携带 class instance、function、stream、socket 或密钥。
- 事件 sink 可以是 console、审计日志、TUI 状态面板或未来 telemetry adapter。

## 当前状态

- `src/fpc` 已替代旧 `src/shared`，目录名暂时保留为兼容实现路径，但协议层对外语义已经是 FCP。
- `src/flyflor.ts` 承载 `@FlyFlor` composition root 和显式 DI 注入。
- `src/control` 承载 gateway、blackboard、runtime、memory、sandbox 等控制边界。
- `src/control/session` 已从 memory 中抽出，成为 session 连续性和 history 固化的控制组件。
- `src/core` 承载 LLM、workers、skills、MCP 等能力内核。
- `src/fpc/decorators/*` 已按组件类型拆分。
- `src/fpc/composition/*` 存放 metadata 和事件创建等纯组合函数。
- `src/fpc/factory/*` 提供 metadata 读取、kind/layer 校验和组件构造入口。
- `src/fpc/events/*` 提供 `FpcEventType`、event bus、sink 和全局事件出口。
- `FlyFlor`、`AgentRuntime`、`BlackboardController`、`AgentMemory`、`SandboxController` 已标记对应 FCP decorator。

修改 FCP 协议、decorator、events 或 Control 边界后，必须运行：

```bash
bun run format:check
bun run check
bun test
bun run test:memory:stress
bun run build:binary
```
