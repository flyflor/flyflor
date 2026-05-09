# Flyflor 开发边界规范

本文档是 Flyflor Bun/TypeScript 实现的硬性边界。后续开发、依赖引入、目录扩展和二进制发布都必须先满足这里的规则。

`DESIGN.md` 描述的是产品和架构目标，其中出现的 Go 路径只作为概念来源。本仓库的真实实现边界以本文档和当前 Bun/TypeScript 目录为准。

## 1. 项目定位

Flyflor 是一个可观察、可扩展、可编译成单文件二进制的智能体运行时，不是单纯聊天客户端。

核心目标：

- 输入渠道统一归一化为内部请求。
- 智能体执行过程可观察、可中断、可恢复、可审计。
- 工具、MCP、插件、技能和记忆系统都有明确边界。
- 运行时核心必须能通过 Bun 编译为独立二进制。

默认工程预期：

- 配置路径固定为 `~/.flyflor/config.jsonc`；Docker dev 对应 `./docker/config/config.jsonc`。
- 所有 JSON 配置兼容 JSONC。
- 业务配置不使用环境变量。
- 约定大于配置，配置只覆盖差异。
- 协议值使用枚举/常量对象，不裸写字符串。
- FCP 注册优先 decorator metadata。
- Docker dev 只挂载工作目录、配置目录和已编译二进制。
- 多 provider 是一等能力，内置常见厂商 profile，用户配置只覆盖 key、active 和少数差异。

## 2. 目录边界

当前目录必须保持语义稳定。可以扩展子目录，但不能把跨层职责混写。

| 路径                     | 职责                                                                          | 禁止                                         |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `app.ts`                 | 程序入口，只做版本/退出码处理并启动 FlyFlor 主类                              | 放业务逻辑、工具实现、模型循环               |
| `src/flyflor.ts`         | `@FlyFlor` composition root，显式注入 config/model/runtime/gateway 等单例依赖 | 放领域业务、平台私有协议                     |
| `command/cli`            | CLI 参数解析、终端命令入口、交互命令分发                                      | 直接访问 LLM provider、直接写长期记忆        |
| `command/tui`            | TUI 展示和用户交互状态                                                        | 放智能体决策、工具安全策略                   |
| `src/control/blackboard` | 黑板 turn、step、decision、session lease 和收敛交还状态控制                   | 直接执行工具、直接调用模型、直接写长期记忆   |
| `src/control/gateway`    | 渠道入口、请求归一化、会话和媒体元数据整理                                    | 执行工具、调用模型、保存记忆                 |
| `src/control/memory`     | session、history、长期记忆 promotion 和检索上下文控制                         | 直接执行模型或工具                           |
| `src/control/session`    | session identity、live context、timeline、history 固化边界                    | 长期记忆 promotion、模型调用                 |
| `src/control/runtime`    | turn loop、上下文装配、事件发布和控制器编排                                   | 放渠道私有协议、存储驱动细节                 |
| `src/control/sandbox`    | 工具、文件、shell、网络、插件和 MCP 权限边界                                  | 绕过审批或审计直接执行                       |
| `src/control/workers`    | worker registry、pool、队列、并发、超时和事件管理                             | 动态扫描目录、直接加载第三方包、绕过 Sandbox |
| `src/core/llm`           | 模型 provider 抽象、消息格式转换、流式响应                                    | 读取渠道私有状态、写长期记忆                 |
| `src/core/mcp`           | MCP server/client 适配、MCP tool schema 转换                                  | 放非 MCP 工具、放智能体路由策略              |
| `src/core/skills`        | 技能包、技能描述、技能解析和选择                                              | 存放密钥、会话数据、模型响应缓存             |
| `src/core/workers`       | worker provider 能力实现，例如 Planner/Reviewer                               | 管理 pool、直接写 memory、绕过 Runtime       |

允许新增的推荐目录：

| 路径                | 职责                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `src/fpc`           | Flyflor Composition Protocol：跨层协议、事件、decorator metadata、DI 容器、进程信封 |
| `src/fpc/contracts` | 跨层契约：枚举、常量对象、消息类型、错误类型和基础协议                              |
| `src/control`       | 控制边界、权限策略、状态流向和 runtime 编排                                         |
| `src/core`          | LLM、skills、MCP 等能力内核，不拥有控制权                                           |
| `src/config`        | 配置加载、默认值、XDG 目录解析和校验                                                |
| `src/fpc/events`    | 运行时事件类型、全局事件总线、审计日志适配                                          |
| `src/fpc/processes` | 子进程协议、supervisor、worker 生命周期                                             |
| `tests`             | 跨模块测试、fixture 和集成测试                                                      |

目录和文件命名采用 NestJS 风格约定：

- 每个源码目录必须提供 `index.ts` 作为对外入口，跨目录导入优先指向目录入口。
- 复杂实现文件使用点分命名，例如 `component.factory.ts`、`dependency.container.ts`、`memory.stress.report.ts`。
- 不再新增连字符源码文件，例如 `component-factory.ts`、`session-inspect.ts`。
- 单职责短文件可保留语义名，例如 `server.ts`、`types.ts`、`scope.ts`。
- 目录内部可以导入私有实现文件；跨目录需要使用明确 public API，避免深层私有导入。

## 3. 导入方向

导入必须保持单向依赖，避免循环和隐式全局状态。

Flyflor 采用“约定大于配置”。配置只用于覆盖部署差异、凭据、启用项和安全策略；默认目录、默认注册、默认 provider 行为和默认 channel 形态应由代码约定给出。不要把简单约定设计成大型配置 schema。

代码组织采用 FCP（Flyflor Composition Protocol，旧称 FPC），它借鉴 MVC 的分离思想，但不是 Web MVC 的翻版。Flyflor 面向智能体运行时，核心关注是控制边界、能力组合、协议兼容、DI 装配和可观察事件。完整说明见 [FPC_ARCHITECTURE.md](./FPC_ARCHITECTURE.md)。

- Composition Root：`@FlyFlor` 主类集中装配并显式注入依赖，只连线不做业务。
- Control Component：平台入口、session 连续性、记忆流向、worker pool、sandbox 权限、CLI/TUI 命令入口和降级策略。
- Runtime Component：一轮对话编排、上下文装配、事件发布。
- Capability Module：LLM、workers、skills、MCP、tools、plugins、storage adapter。
- Extension Component：兼容 `SKILL.md`、MCP server/client、插件包和未来 marketplace。
- FCP Protocol：枚举、消息、事件、metadata、DI、进程信封和稳定契约。
- Process Worker：channel worker、MCP stdio、tool/sandbox 子进程。

Gateway、Blackboard、WorkerManager、Memory、Session、Sandbox 都属于 Control 层：它们负责控制外部输入、协作状态、worker pool、上下文/记忆流向、会话连续性和权限执行边界。Control 层可以调用 Runtime facade 或领域能力，但不能被 Capability 反向依赖，也不能绕过 Runtime 私自执行 agent loop。

注册点优先使用声明式 metadata 或轻量修饰器风格。能通过类自身声明 `name`、`kind`、`layer`、`compatibility`、`tags` 完成注册的，不要写复杂工厂和大 switch。项目允许使用 TypeScript decorator，但只用于登记 metadata，不做运行时魔法扫描。依赖注入只允许在 composition root 使用显式 token/provider 容器，不能依赖反射 metadata、自动扫描或动态加载。

允许方向：

```text
app.ts
  -> src/flyflor.ts
  -> command/*
  -> control/*
  -> core/*
  -> fpc/*, config/*
```

硬性规则：

- `src/core` 不得导入 `src/control`、`command`、入口层或控制器实现。
- `src/control/gateway` 只负责把外部输入变成 FCP 消息，不得知道具体模型 provider。
- `src/control/blackboard` 只负责黑板状态、step/decision、session lease 和可观察事件；不得直接执行 worker 模型调用、工具副作用或长期记忆 promotion。
- `src/control/workers` 只管理已注入 worker 实例或显式 manifest 的 registry、adapter、pool、队列、超时和事件；不得自动扫描目录、动态 import 第三方包或绕过 Sandbox 执行副作用。
- `src/control/session` 是 session key、live messages、timeline 和 history 固化的唯一控制边界；其他目录不得重新实现 session scope 计算。
- `src/control/memory` 可以调用 session facade，但不能拥有 session identity 规则；长期记忆 promotion 与 session continuity 必须分层。
- `src/control/sandbox` 是工具、shell、网络、插件和 MCP 执行权限的唯一控制边界；core 能力不得自行绕过它执行副作用。
- `command/*` 和 `src/control/gateway` 可以调用 runtime facade，不得绕过 runtime 直接驱动 agent loop。
- `plugins` 和 `skills` 只能依赖公开接口，不能导入控制层内部实现文件。
- `src/fpc` 不能成为垃圾桶；一旦类型、函数或协议只服务单一领域，必须放回对应领域目录。
- 禁止使用跨目录深层私有导入来绕过边界。需要跨域使用时，先在对应目录的 `index.ts` 暴露明确 public API。
- 新增 channel/provider/tool 时，优先新增一个独立语义模块并在 registry 列表里声明；禁止把平台差异塞进一个泛化 adapter。
- Channel registry 的轻量声明入口是 `src/control/gateway/channels/registry.ts`。新增渠道应声明 `name`、`transport`、`implemented` 和 `create()`，平台协议细节留在独立 adapter 文件中。
- FCP metadata decorator 定义在 `src/fpc/decorators/*`，按功能拆分，当前保留 `@Provide`、`@FlyFlor`、`@Gateway`、`@Channel`、`@Command`、`@Blackboard`、`@Memory`、`@Session`、`@Sandbox`、`@Runtime`、`@Skill`、`@Mcp`、`@McpService`、`@Plugin`、`@Tool`、`@Worker`、`@Component`。
- `@Provide` 是注入底座；`@Gateway`、`@Blackboard`、`@Memory`、`@Session` 等控制组件 decorator 必须保留语义化 kind/layer/name，同时登记 provider metadata。
- `@Worker` 只声明 worker provider 身份；worker 实例必须由 composition root 或显式 registry 注入 `WorkerManager`，不能通过目录扫描或动态加载获得。
- 外部 agent/TUI worker 优先使用 `json-process` 或 `persistent-json-process` adapter：stdin 接收 JSON `{ context, input }`，stdout 返回 JSON result；命令、cwd 和 env 必须来自显式 config/registry，stderr 只做诊断，不进入模型上下文。协议不走 SSE，不在通信层做复杂决策；adapter 只保证输入输出稳定、超时有界、进程断开可观察。
- FCP 函数组合逻辑放在 `src/fpc/composition/*`；组件构造、metadata 校验和显式 DI token/provider 容器放在 `src/fpc/factory/*`。
- 运行时事件名必须来自 `FpcEventType`，事件 payload 必须 JSON 可序列化；全局事件总线定义在 `src/fpc/events`。
- Skill 和 MCP 兼容层必须只通过 manifest/config/registry 接入；不得在 decorator 或 FCP metadata 读取第三方包资产、执行第三方代码或绕过 sandbox。

## 4. 类型和协议

所有跨目录通信必须经过显式 TypeScript 类型。

必须遵守：

- 公共类型放在领域内的 `types.ts`、`contracts.ts` 或 `index.ts` 中。
- 运行时事件必须是可序列化对象，字段名稳定，禁止携带 class instance、function、stream、socket。
- 外部输入进入核心前必须做 schema 校验或显式解析，不能把 `unknown`、`any` 直接传入核心。
- `any` 只能作为第三方边界的短暂隔离，必须在同一函数内收敛成明确类型。
- 错误必须保留机器可读 `code`，用户可见文案和调试信息分离。

## 5. Bun 和二进制编译规则

Flyflor 的运行时核心必须兼容 `bun build --compile`。

默认构建入口：

```bash
bun build --compile --target=bun --packages=bundle --reject-unresolved --outfile dist/flyflor app.ts
```

硬性规则：

- 运行时不得依赖 `node_modules` 在用户机器上存在。
- 运行时不得从依赖包目录读取模板、schema、wasm、二进制或其他资源文件，除非构建流程明确把它们打包或复制到发布产物旁边。
- 禁止无法静态解析的运行时代码加载，例如拼接路径后的 `import()`、`require()`、按用户输入加载 npm 包。
- 可以读取用户工作区、配置目录、会话目录和显式传入的文件路径；这些属于运行数据，不属于构建资产。
- 不得要求用户机器安装 Node.js。开发和发布命令都以 Bun 为准。
- 不得在核心路径依赖 Node-only 行为。优先使用 Web API、Bun API 和 TypeScript 标准语法。
- 如果必须使用 `node:` API，必须确认 Bun 支持且能在编译后二进制中工作。
- 构建必须启用 `--reject-unresolved`，不能把 unresolved dynamic import 留到运行时爆炸。
- 发布产物不得把 `.env`、本地日志、会话数据库、密钥或测试 fixture 编译进二进制。

## 6. 依赖准入规则

依赖必须先审查，再安装。所有包使用 `bun add` 或 `bun add -d`，并提交 `bun.lock`。

生产依赖必须同时满足：

- ESM 或 Bun bundler 可静态打包。
- 无必须执行的 `postinstall`、`install`、`preinstall` 脚本。
- 无强制 native addon、`node-gyp`、平台专用 prebuild，除非该依赖被隔离在可选适配器中。
- 不要求运行时读取自身 package 目录下的资产。
- 不要求 Node.js 进程、npm CLI 或 shell wrapper 才能运行。
- license 可接受，维护状态可接受，包体和传递依赖数量与收益匹配。

开发依赖要求：

- 只能用于类型检查、测试、格式化、构建辅助。
- 不得被运行时代码导入。
- 如果工具会下载二进制、启动守护进程或执行安装脚本，必须在 PR/提交说明中写明原因。

禁止事项：

- 禁止为了小函数引入大依赖。
- `lodash-es` 是允许的基础工具库，适合低频配置归并、对象判断和集合整理。热路径、流式处理、模型循环和大 payload 处理优先原生实现，避免无谓分配。
- 禁止引入会在 import 时修改全局状态的库。
- 禁止引入默认联网、默认收集遥测、默认读取用户目录的库。
- 禁止在没有适配层的情况下把 provider SDK 深埋进核心逻辑。

新增生产依赖前必须回答：

1. 编译成二进制后是否仍可运行？
2. 是否需要 native addon、postinstall 或外部命令？
3. 是否能被替换为 Bun/Web 标准 API 或少量本地代码？
4. 失败时是否能降级，还是会阻断整个 runtime？

## 7. 配置和密钥

配置必须集中加载和校验，禁止在业务代码里散落读取环境变量。

全局配置目录必须提前稳定。原生运行默认遵守 XDG 与 home 约定：

- `~/.flyflor`：Flyflor 全局 home。
- `~/.flyflor/config.jsonc`：全局 JSONC 配置文件。
- `$XDG_DATA_HOME/flyflor` 或 `~/.local/share/flyflor`：持久数据目录。
- `$XDG_CACHE_HOME/flyflor` 或 `~/.cache/flyflor`：可重建缓存目录。
- `~/.flyflor/workspace`：默认隔离工作区目录。
- `~/.flyflor/logs`：日志和审计事件目录。
- `~/.flyflor/plugins`：本地插件目录。
- `~/.flyflor/skills`：本地技能目录。
- `~/.flyflor/mcp`：MCP 配置和状态目录。

Docker dev 把 `./docker/config` 映射到容器内 `/root/.flyflor`，避免污染宿主机真实全局 agent 配置。模型、provider、渠道凭据、沙箱策略和网关行为必须来自 `config.jsonc` 或后续 secrets provider，不能来自业务环境变量。

推荐目录语义：

```text
~/.flyflor/
  config.jsonc                 # JSONC 全局配置：provider、gateway、默认 agent、权限默认值
  agents/<agentId>/config.json # JSONC 单 agent 覆盖配置
  profiles/<profile>.json      # JSONC 可选 profile 配置

$XDG_DATA_HOME/flyflor/
  agents/<agentId>/sessions/   # 会话 JSONL、摘要和索引元数据
  agents/<agentId>/memory/     # 结构化记忆、向量索引元数据、本地方法论记忆
  credentials/                 # 本地 token/OAuth 状态；不得进入模型上下文
  audit/                       # 安全审计事件

~/.flyflor/workspace/
  AGENTS.md
  SOUL.md
  USER.md
  MEMORY.md
  memory/
  skills/                      # workspace 级技能，优先级高于全局技能

~/.flyflor/plugins/            # 全局插件
~/.flyflor/skills/             # 全局技能
~/.flyflor/mcp/                # MCP server/client 配置和运行状态
~/.flyflor/logs/               # 运行日志，不作为记忆源自动读取
$XDG_CACHE_HOME/flyflor/       # 可删除缓存
```

workspace 不是全局配置目录。agent 可以读写 workspace，但不能默认修改全局配置、凭据、sessions 或 managed skills；这些目录必须经过明确权限和工具策略。

规则：

- 只能由 `config` 层读取 `HOME`、XDG 目录环境变量、配置文件和默认值。
- provider、模型、渠道凭据、沙箱策略和网关行为必须来自 `config.jsonc` 或后续 secrets provider，不能来自业务环境变量。
- 所有 Flyflor 读取的 JSON 配置都必须兼容 JSONC，允许注释和尾逗号。
- provider key、MCP token、插件 token 不得写入日志、事件 payload、错误详情或记忆。
- 配置对象进入核心后应视为只读。
- 默认配置必须能离线启动；需要联网的能力必须显式启用。
- 测试不得依赖真实密钥。

## 8. 工具和沙箱

工具调用是安全边界，不是普通函数调用。

Bun 多进程和子进程边界必须从第一版开始保留：

- gateway 主进程只负责 HTTP/WebSocket 长连接、渠道路由、配置快照和事件发布。
- 长轮询渠道、WebSocket 渠道、MCP stdio server、sandbox/tool exec、插件运行时必须能迁移到 Worker 或子进程。
- 主进程和子进程之间的基础信封定义在 `processes/protocol.ts`，新增 worker 类型时先扩展协议，再接实现。
- 跨进程消息必须是 JSON 可序列化协议，禁止传递 class instance、function、socket、stream 和可变全局对象。
- 子进程必须有明确生命周期：start、ready、heartbeat、stop、crash、restart backoff。
- 子进程输出必须走结构化事件和大小限制，不能把 stdout/stderr 原样塞回模型上下文。
- 使用 Bun.spawn/Bun.Subprocess 时必须显式设置 cwd、env 白名单、超时、stdin/stdout/stderr 策略和退出码处理。
- YOLO 模式只取消交互式审批，不取消审计、路径边界、超时和输出限制。

必须遵守：

- 每个工具必须声明名称、输入 schema、输出 schema、权限需求和副作用类型。
- 文件写入、shell、网络、进程、插件执行都必须经过 sandbox 策略。
- 工具结果进入模型上下文前必须做大小限制、敏感信息过滤和结构化摘要。
- 高风险工具必须产生审计事件。
- 工具失败必须返回结构化错误，不能直接抛出未分类异常到 agent loop。

## 9. 插件和技能

插件是运行时代码扩展，技能是行为/能力描述。两者不能混用。

插件规则：

- 插件必须有 manifest，声明入口、能力、权限和兼容版本。
- 插件只能通过公开 host API 访问 Flyflor。
- 插件不得直接写核心内部状态、替换全局 fetch、修改全局原型。
- 插件默认不可信，必须受权限和 sandbox 约束。

技能规则：

- 技能必须是可审计的文本、模板或轻量资源。
- 技能选择和注入由 runtime/agent 控制，技能自身不执行副作用。
- 技能内容不得包含密钥和机器本地绝对路径。

## 10. 记忆和数据边界

记忆系统必须区分事实、偏好、会话过程和方法论。

规则：

- 用户当前指令优先级最高。
- 长期记忆只能保存稳定偏好、项目事实、明确结论和可复用方法。
- 工具输出、日志、stack trace 和大文件内容不能无筛选写入长期记忆。
- 记忆写入必须记录来源、时间、session key 和 schema version。
- 删除会话时必须能删除对应索引、摘要和向量记录。

## 11. 可观察性

核心流程必须发出结构化事件，供 CLI、TUI、日志和未来 Web UI 使用。

事件规则：

- 事件命名使用 `domain.action`，例如 `agent.turn.start`。
- 事件必须可 JSON 序列化。
- 事件必须能在无 UI 环境中消费。
- 事件不得包含原始密钥、完整 `.env`、未脱敏 header。
- 大 payload 必须摘要化，并提供可控的 debug 开关。

## 12. 开发检查

提交功能前至少运行：

```bash
bun run check
bun run build:binary
```

当改动涉及工具、MCP、插件、文件系统、shell、网络、记忆或 provider 时，必须增加对应测试或最小验证脚本。

允许早期没有完整测试框架，但不允许无验证地合入高风险边界改动。
