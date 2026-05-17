# 架构总览

## 一句话定位

Flyflor 是 Bun + TypeScript 智能体运行时，目标是单文件二进制；入口装配在 `FlyFlor` composition root 完成，热路径由 `RuntimeModule` 编排，记忆系统按「流体 / 晶体 / 海马体」三层切分。

## 相关代码路径

- `app.ts` — 程序入口，仅做版本输出与命令分派
- `src/app.ts` — `FlyFlor` composition root，显式 DI 装配
- `src/components/` — shared component base classes `Gateway` / `Blackboard` / `Runtime` / `Memory` / `Sandbox` / `BrainComponent` / `GraphComponent` / `SQLiteComponent` / `RedisComponent` / `SurrealComponent` plus cross-module primitives such as SQL tagged templates; no domain `components/<domain>` directories
- `src/entities/` — memory / crystal / blackboard 领域实体、row 映射与 repo SQL；公共 repo 才进入 `src/entities/repo/`
- `src/agent/di/` — `@Module` / `@Provide` / `@Inject` metadata、`DependencyContainer`
- `src/protocol/` — 公共协议、枚举、事件、进程信封
- `src/neural/project/` — codename / project 固化、项目脚手架与资源指标触发器
- `src/agent/runtime/{blackboard,mcp,planning,routing,reflection,skills,streaming,turn}/` — RuntimeModule 的语义子目录；主 module 只做 turn 编排
- `src/llm/`、`src/crystal/`、`src/neural/`、`src/agent/`、`src/command/`、`src/config/`

## 三层智能模型

| 层 | 目录 | 角色 | 后端 |
| --- | --- | --- | --- |
| 流体智力 LLM | `src/llm` | 当前任务的理解、推理、生成、工具编排 | OpenAI 兼容 / Anthropic 兼容 |
| 晶体智力 Crystal | `src/crystal` | 反思候选 → Gem 升格、方法论沉淀 | local `crystal.db` + VectorIndex |
| 海马体 Neural | `src/neural` | 工作记忆 ring、激活、TTL 遗忘、热记忆压缩审计、计划/fork/场景摘要落 brain.db | local `MemoryComponent` + Markdown + SQLite + `crystal.db` |

## 分层结构图

```mermaid
flowchart TB
    Entry["app.ts"] --> Command["src/command<br/>CLI / TUI"]
    Entry --> AppRoot["src/app.ts<br/>FlyFlor composition root"]
    Command --> AppRoot
    AppRoot --> Container["DependencyContainer<br/>显式 token/provider"]

    AppRoot --> Gateway["GatewayModule<br/>src/agent/gateway"]
    AppRoot --> Runtime["RuntimeModule<br/>src/agent/runtime"]
    AppRoot --> Blackboard["BlackboardModule<br/>src/agent/blackboard"]
    AppRoot --> Workers["WorkerManager<br/>src/agent/worker"]
    AppRoot --> Model["ModelClient<br/>src/llm"]

    Runtime --> Memory["MemoryModule<br/>src/neural/memory"]
    Runtime --> Sandbox["SandboxModule<br/>src/agent/sandbox"]
    Runtime --> MCP["MCP Client<br/>src/agent/mcp"]
    Runtime --> Skills["Skill Loader<br/>src/skills"]
    Runtime --> Prompts["Prompts<br/>src/agent/prompts"]
    Runtime --> FastRouteCache["fastRoute cache<br/><cacheDir>/runtime.fast.route.snapshots.json"]

    Memory --> Markdown["Markdown 宪法层<br/>~/.flyflor/workspace/*.md"]
    Memory --> Working["MemoryComponent<br/>local WAL + snapshot"]
    Memory --> HotCompression["HotMemoryCompressionWorker<br/>隔离压缩审计"]
    Memory --> SQLite["SQLite 索引<br/>candidates/offers/search"]
    Memory --> Graph["CrystalComponent<br/>crystal.db + VectorIndex<br/>episode/memory_node/gem/summary_embedding"]
    Memory --> Crystal["CrystalMemoryComponent"]
    HotCompression --> SQLiteBrain["brain.db memory_events<br/>hot-memory-compression"]

    Blackboard --> BlackboardSqlite["SQLite 黑板存储<br/>turn/step/decision/lease"]
    Blackboard --> Workers
    Workers --> ModelWorker["通用模型 worker"]
    Workers --> JsonProcess["json-process / persistent"]

    Gateway --> Channels["channel adapters<br/>api / stdio / webhook / ..."]

    Protocol["src/protocol<br/>枚举 / 事件 / 进程信封"] -.- AppRoot
    Protocol -.- Runtime
    Protocol -.- Blackboard
```

## Composition Root（`FlyFlor.create`）

```mermaid
sequenceDiagram
    participant CLI as app.ts / command
    participant Flyflor as FlyFlor.create
    participant Config as loadConfig()
    participant Tpl as loadPromptTemplates
    participant Sink as EventSink
    participant LLM as createModelClient
    participant WM as WorkerManager
    participant BB as BlackboardModule
    participant RT as RuntimeModule
    participant GW as GatewayModule
    participant DC as DependencyContainer

    CLI->>Flyflor: create({mode, argv})
    Flyflor->>Config: 读 ~/.flyflor/config.jsonc
    Config-->>Flyflor: FlyflorConfig + paths
    Flyflor->>Tpl: 装载 templates/prompts/*.md
    Flyflor->>Sink: 组合 Console/Null + FileAuditSink
    Flyflor->>LLM: 按 config.model 建 provider
    Flyflor->>WM: registerModelBackedBlackboardWorker
    Flyflor->>BB: new BlackboardModule(sqlite, events, WM)
    Flyflor->>RT: new RuntimeModule(config, model, events, BB)
    Flyflor->>GW: new GatewayModule(config, adapters, RT, events)
    Flyflor->>DC: bindSingleton 全部 token
    Flyflor-->>CLI: FlyFlor 实例
    CLI->>Flyflor: start()
    alt mode = gateway
        Flyflor->>GW: start()
    else mode = chat / cli / tui
        Flyflor->>RT: startHumanChat(RT)
    end
```

## 边界继承约定

所有边界模块继承 `src/components/index.ts` 中的 Flyflor 组件基类来表达语义；新代码必须直接依赖 `src/components`：

```ts
abstract class FlyflorComponent {}
abstract class Gateway extends FlyflorComponent {}
abstract class Blackboard extends FlyflorComponent {}
abstract class Runtime extends FlyflorComponent {}
abstract class Memory extends FlyflorComponent {}
abstract class Sandbox extends FlyflorComponent {}
abstract class ContextComponent extends FlyflorComponent {}
abstract class BrainComponent extends FlyflorComponent {}
abstract class GraphComponent extends FlyflorComponent {}
abstract class SQLiteComponent extends FlyflorComponent {}
abstract class RedisComponent extends FlyflorComponent {}
abstract class SurrealComponent extends FlyflorComponent {}
abstract class CrystalComponent extends FlyflorComponent {}
```

实现类形如 `class RuntimeModule extends Runtime`、`class MemoryModule extends Memory`、`class CrystalMemoryComponent extends CrystalComponent`、`class ContextScopeComponent extends ContextComponent`。本地存储也必须挂到组件基类：`BrainStore extends BrainComponent`、`SQLiteGraphStore extends GraphComponent`、`SQLiteMemoryStore extends SQLiteComponent`、Markdown/project working memory store extends `MemoryComponent`。`RedisComponent` / `SurrealComponent` 继续作为外部存储原型锚点保留，默认运行时不启用对应 backend；未来恢复外部 Redis / SurrealDB 时必须通过这两个 Component 边界接入。继承关系只用于身份标识，不在基类放业务逻辑；`@Module` 与 `@Component` 复用 `Provide` metadata 注册路径，运行期连线由 `DependencyContainer` 完成。`ContextComponent` / `MemoryComponent` / `CrystalComponent` / `BrainComponent` / `GraphComponent` / `SQLiteComponent` / `RedisComponent` / `SurrealComponent` 是默认且唯一对外描述的组件承载层。

默认推断规则：

- `FlyflorComponent` 继承链推断 `kind` 与 `layer`：`Runtime → runtime layer`，`Gateway/Blackboard/Memory/Sandbox/ContextComponent/BrainComponent/GraphComponent/SQLiteComponent → control layer`，`RedisComponent/SurrealComponent` 与其他 component → capability layer。
- 类名推断 `name`：去掉 `Module/Component/Store` 后转 kebab-case。
- provider 默认 singleton；需要重新 `new` 的组件显式使用 `ProviderScope.Factory`。
- 只有默认推断不够表达边界时才写 `kind/layer/name/provider`，避免装饰器参数变成重复配置。
- DI key 优先是 class 对象本身，例如 `@Inject(RuntimeModule)`、`container.resolve(ConfigComponent)`；`*.component.ts` 必须定义真实组件边界，禁止新增只为当 token 存在的空壳类。

## DI 容器

- `DependencyContainer`（`src/agent/di/factory/dependency.container.ts`）只暴露三种绑定：
  - `bindSingleton(token, value)` — 已构造的稳定依赖
  - `bindProvider(token, factory)` — 懒加载单例
  - `bindFactory(token, factory)` / `bindTransient(token, factory)` — 每次 resolve 创建新实例
  - `bindComponent(token, factory, metadata)` — 按 `@Module` / `@Component` 的 provider scope 绑定
- 仅在 composition root 注入；运行时只 `resolve` 已注册 token。
- `@Module` / `@Provide` / `@Inject` / `@Component` / `@Event` / `@Worker` / `@Channel` / `@Plugin` 仅登记 metadata，**不做反射扫描或自动加载**。
- `EventsComponent` 是运行时全局事件入口：`emit()` 发布结构化 RuntimeEvent，`on()` 注册显式 handler，`registerHooks(instance)` 只读取实例类上由 `@Event(type)` 写入的 metadata。
- Runtime 只保留 turn pipeline 主干；可旁路的统计 / 审计 / 后处理优先抽成 `src/agent/runtime/events/*.event.ts` 全局 handler。当前 `RuntimeSkillUsageEventHandler` 通过 `skill.context.built` / `mcp.tool.call.executed` / `agent.turn.end` 聚合并写 usage sidecar。
- DI 入口不再维护 `FlyFlorTokens` 这种集中式 token 目录；`RuntimeModeComponent / ConfigComponent / EventsComponent / ModelComponent / AdaptersComponent` 这类边界直接用各自域内的真实 `*.component.ts` 类作为 DI key，composition root 显式构造并 `bindSingleton` / `resolve`。

## Repo / SQL 分层

SQLite 数据访问按 `entity/repo -> store -> component` 分层：

- `src/entities/**/*.entity.ts`：表 row / record 映射、JSON 列编解码与轻量 shape 校验。
- `src/entities/**/*.repo.ts`：写入 DTO、SQL function、row 查询。只做数据访问层，不承载业务决策。
- 模块内 `store.ts`：数据库连接生命周期、schema 初始化、事务组合、backup / recovery；当一个模块有多个 store，用子目录表达语义后仍命名为 `store.ts`，例如 `src/neural/memory/brain/store.ts`。
- `*.component.ts`：向 runtime / neural / crystal 暴露能力边界。

Repo SQL 统一使用 `query\`SELECT ... ${value}\`` tagged template，插值只会生成 SQLite `?` 参数；表名、列名、排序字段必须留在 repo 内部字面量中。当前 `brain.db` 的 event、state、project、task plan、context fork、scene record、summary、link、codename、EQ state 已迁移到 `src/entities/memory/brain.*.repo.ts`，BrainStore 只保留单库生命周期、schema 初始化和对外门面。

## 模块边界硬约束

| 模块 | 允许 | 禁止 |
| --- | --- | --- |
| `app.ts` / `src/app.ts` | 装配、显式注入 | 业务逻辑、领域协议 |
| `src/command` | CLI/TUI 入口、状态展示 | 直接驱动 agent loop、绕过 Gateway/Runtime |
| `src/agent/gateway` | 渠道归一、status 快照 | 调用模型、写记忆 |
| `src/agent/runtime` | turn 编排、上下文装配、事件发布 | 持有渠道私有协议、储存驱动细节 |
| `src/agent/blackboard` | turn/step/decision/lease | 执行工具、写长期记忆 |
| `src/agent/worker` | registry / pool / adapter / 超时 | 动态扫描、动态 import、绕过 Sandbox |
| `src/agent/sandbox` | mcp-tool / shell-hook / plugin 审批 | 被业务模块绕过 |
| `src/agent/mcp` | server/client 适配 | 跑非 MCP 工具、维护路由策略 |
| `src/llm` | provider 协议转换、流式输出 | 读取渠道状态、写长期记忆 |
| `src/crystal` | reflection、`gems`、drift | 持有渠道协议、绕过证据门、直接改写外部 Skill 包 |
| `src/neural` | 海马体策略、回放、衰减、调度 | 调用模型决策 |
| `src/context` | 显式 project / fork / capability scope 装配 | 业务语义判断、隐式 session |
| `src/protocol` | 枚举、事件、信封 | 业务决策、状态存储 |

## 进程模型

```mermaid
flowchart LR
    Main["Flyflor 主进程<br/>HTTP/WebSocket/事件总线"]
    subgraph Children
      MCPStdio["MCP stdio server<br/>Bun.spawn"]
      JsonWorker["json-process worker"]
      PersistWorker["persistent-json-process"]
      ShellHook["shell-hook 子进程"]
    end
    Main -- 信封协议 --> MCPStdio
    Main -- stdin JSON --> JsonWorker
    Main -- 多任务复用 --> PersistWorker
    Main -- Bun.spawn --> ShellHook

    Main -. RuntimeEvent .-> Audit["FileAuditSink<br/>~/.flyflor/logs/audit.jsonl"]
    Main -. RuntimeEvent .-> Console
```

所有跨进程消息走 `src/protocol/processes/protocol.ts` 信封，要求 JSON 可序列化、有 start/ready/stop/crash/restart backoff 生命周期。

## 关键数据结构

```ts
interface FlyFlorDependencies {
    adapters: Map<ChannelName, ChannelAdapter>;
    blackboard: BlackboardModule;
    config: FlyflorConfig;
    container: DependencyContainer;
    events: EventSink;
    gateway: GatewayModule;
    memory: MemoryModule;
    mode: RuntimeMode;       // chat | cli | gateway | tui
    model: ModelClient;
    runtime: RuntimeModule;
    workers: WorkerManager;
}
```

`MemoryModule` 已在 composition root 中显式构造并注入 `RuntimeModule`，测试可通过 `FlyFlor.create({ memory })` 替换实现。

## 运行边界

- `RuntimeModule` 已拆为 prepare / assemble / generate / persist / async 五个 phase，但文件仍较大；工具循环、reply 解析和 persist helper 必须继续留在 runtime 子目录 owner 内，不回流到根 module。
- `Sandbox` 已把 MCP tool / plugin / shell-hook 收口到 `gateCapabilityExecution`；新增可执行能力必须先扩展 `CapabilityExecutionKind` 与统一 gate，不允许开旁路。
- 三层智能模型在代码上仍有少量回流依赖：`neural/memory` 会 import prompt 渲染与 project promotion；导入方向以当前子目录 owner 为准：`neural/memory/actions.ts` 只解析 `MemoryActions` 结构化块，不再 import agent prompt registry；`DreamWorker` 与 feedback interpreter 已迁入 `src/neural/memory`，runtime 不再保留兼容壳。
- `brain.db` 已成为 prompt recall / turn event write 权威；Behavior Snapshot、TaskPlan / ContextFork / SceneRecord 摘要与提示词优先级冲突表已接入 runtime / memory / prompt 模板链路。
