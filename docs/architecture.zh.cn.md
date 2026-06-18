# Architecture

本文档描述当前实现。共享代码形态规则在 `oop-code-redlines` skill；Flyflor 项目特有规则在 [AGENTS.md](../AGENTS.md)。

## 运行流程

1. `src/bootstrap.ts` 在 decorated classes 加载前导入 `reflect-metadata`。
2. `Factory.create(AppModule)` 把构造委托给 IOC container。
3. `AppModule` imports `PluginsModule`，并注入 `IPCService` 和 `Synapse`。
4. `IPCService` 启动配置中的 socket endpoint。
5. `FSocket` 接收 bytes，请 `PacketService` decode packets，并路由 valid packets。
6. `Synapse` 持有 active agent pool，并把 user packets 发给 active `Agent`。
7. `Agent` 拥有一个 turn：通过 `Memory` 组装 messages，流式输出 `Brain`，然后提交成功 turn。
8. `Brain` 把 assembled memory messages 映射成 model signal output。
9. `Intelligence` 通过 protocol adapters 打开配置中的 provider stream。

## IOC

`src/core/ioc/container.ts` 是 application classes 的唯一构造点。

- `useContainer()` 返回进程级 `Container` singleton。
- `getAsync()` 是常规构造路径，处理 module imports、singleton cache、constructor arguments、property injection 和 `@Init()`。
- `get()` 是同步路径。它可以返回已经初始化过的 singleton，但会拒绝需要 `@Init()` 或 async injection factory 的 fresh graph。
- `create()` 创建不注册 singleton 的 fresh IOC-owned instance，主要用于 loaded prompt/file 这类 path-bound object。
- `registerObject()` 可以把已有对象按 class 或 symbol key 放进 singleton map。
- `defineMetadata()`、`getMetadata()` 和 `getOwnMetadata()` 包装 decorators 使用的 `Reflect` metadata helpers。

业务代码不能直接构造项目 class。

### IOC 生命周期细节

`getAsync(Module, ...props)` 顺序如下：

1. 把 class 记录到 `classList`。
2. 如果存在 `@Singleton()` metadata 且已经缓存，直接返回现有 singleton。
3. 在构造当前 class 前递归解析 `@Module({ imports })`。
4. 构造函数参数优先使用显式 `props`，然后按 reflected constructor parameter type 从已经初始化的 imported module instances 中匹配。
5. 在 container 内构造 class。
6. 如果是 singleton，提前缓存 instance，使 dependency cycle 能看到同一个对象。
7. 先注入 `@Config()` 这类 registered instance provider。
8. 再解析 `@Inject()` 和 `@Scope()` properties，包括 callback 生成或 scope 推导出的被注入 class constructor args。
9. 执行一个被 `@Init()` 标记的方法。
10. 如果初始化失败，从 cache 移除失败 singleton 并重新抛错。

constructor injection 基于 import graph：只有当某个 initialized imported module instance 与 reflected parameter type 精确匹配时才会注入。property injection 基于 metadata：decorator 记录 property key 和 class type，container 再用 `getAsync()` 解析每个 property。scoped property injection 依赖声明顺序：后声明的 `@Scope()` property 可以使用同一个 host instance 上先注入完成的 property。

`get(Module, ...props)` 使用相同的图规则做同步构造，但如果需要执行 `@Init()` 或等待 async injection callback，会直接抛错。

## Decorator Index

通用 decorators 位于 `src/core/decorator.ts`：

- `@Module(metadata)`：标记 `FModule` boundary，使其成为 singleton，并记录 `imports`。
- `@Inject()`：按 reflected `design:type` 注入 property。
- `@Inject(ClassType)`：使用显式 class type 注入 property。
- `@Inject(callback)`：在 host instance 上调用 callback，并把返回值作为被注入 class 的 constructor args。
- `@Scope()`：读取被注入 class 的 constructor metadata，并从当前 host scope 解析 constructor args。
- `@Init()`：标记一个 injection 之后运行的 lifecycle method。
- `@Config(key?)`：提前注入 `ConfigComponent`，并可暴露 nested config value。
- `@Singleton()`：标记 class 会缓存到 container singleton map。
- `@Provide()`：标记 class 是 IOC provider，但不做 singleton cache。
- `@Service()`、`@Component()` 和 `@Plugin()`：service/component/plugin class 的 provider aliases。
- `@Repo()`：把 repository 标记为 singleton。
- `@Controller()`：把 controller-style class 标记为 singleton。
- `@Guard()` 和 `@SandBox()`：policy/sandbox classes 的 singleton markers。

专用 decorators 通过 `src/core/index.ts` 导出：

- `@Prompt()` 来自 `src/core/prompt/decorator.ts`：把 property 绑定到 loaded `FileService`，支持 global 或 agent-scoped path resolution。
- `@Logger()` 来自 `src/core/logger/decorator.ts`：把 property 绑定到 lazy scoped logger。

## Base Class Index

核心 base classes 位于 `src/core/ioc/abstracts.ts`：

- `FlyFlor`：framework objects 的 root marker class。
- `FModule`：module boundary。
- `FService`：behavior-owning service object。
- `FComponent`：stateful component 或 lifecycle owner。
- `FRepo`：repository/entity SQL owner。
- `FPlugin`：plugin boundary，也是 plugin signals 的 RxJS `Subject`。
- `FGuard` 和 `FSandBox`：policy scopes。
- `FAgent`：`Agent` 使用的 autonomous agent subject。
- `FCortex`：signal transform subject；`Brain` 继承它并实现 `transform(input)`。

Decorators 位于 `src/core`。decorator 表达 intent；base class 表达 object kind。

## Prompt And File Layer

`@Prompt()` 注入一个已加载的 `FileService`。

`FileService` 拥有一个 filesystem path、加载后的 `data`、directory child file objects 和 persistence methods。runtime prompt code 只读取 canonical English `.md`；`.zh.cn.md` mirror 只是人类参考。

`PromptService` 加载 agent prompt package，并能为 editable prompt sections 保存完整 markdown replacement。

## Agent Runtime

`Synapse` 解析 active configured profile，并通过 container 获取 `Agent`。

`Agent.next(text)` 向 `Memory.messages(text)` 请求：

- assembled provider message list；或
- 当 memory analysis 已处理该 turn 时的 direct reply。

对于模型 turn，`Agent` 把 `Brain.transform(input)` 的 delta signals 通过自己的 subject 流出。只有成功完成后才提交 user/assistant context。

`Memory` 拥有 working context 和 prompt-section assembly。`Brain` 拥有 inference streaming。`Intelligence` 拥有 provider communication 和 cancellation。

## Neural And IPC

`PacketService` 拥有 length-prefixed JSON packet protocol：

- 8-byte unsigned big-endian body length；
- UTF-8 JSON body；
- per-connection decode buffers；
- partial headers and bodies；
- one chunk 中的 multiple packets；
- malformed 和 oversized packet reporting。

`FSocket` 拥有 Bun socket callbacks，并把每个 turn 的 streamed agent output 限定到发起请求的 socket。

## Validation

`bun run check` 当前运行 TypeScript 和 `scripts/check.script.ts`。checker 只执行脚本里已经实现的规则；它不能替代共享 `oop-code-redlines` 的 review discipline。
