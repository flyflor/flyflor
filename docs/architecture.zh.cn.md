# Architecture

Flyflor 是 code-first。本文件只描述当前已经实现的代码。

## 哲学隐喻

Flyflor 使用语义化对象模型：

- `Agent` 是人。它拥有 profile、prompt、memory component、intelligence services 和 message context。
- `Prompt` 是 agent 的宪法和应用层协议，通过 `@Prompt()` 作为 file object 加载。
- `FileService` 是物体，拥有一个 filesystem path 和 loaded state。
- `Neural` 是信号传导。`Synapse` 负责 active-agent routing。
- `IPC` 是外界感官边界。Socket 和 packet classes 把外部 bytes 翻译成 kernel packets。
- `IOC` 是创造和生命周期。Container 是唯一的 application-class construction point。

这些隐喻不是装饰。它们决定代码应该放在哪里。如果一个行为不能命名为有所有权的对象，它通常应该属于现有对象。

## Bootstrap

`src/bootstrap.ts` 在 decorated classes 加载前导入 `reflect-metadata`，然后调用 `Factory.create(AppModule)`。

`Factory` 委托给 `useContainer().getAsync(rootModule)`。Root module 是 `AppModule`，它导入 `PluginModule` 并注入 `IPCService` 和 `Synapse`。

## IOC

`src/core/ioc/container.ts` 拥有对象构造和生命周期：

- 先解析 module imports，再解析 dependents；
- 缓存 singleton instances；
- 从显式参数或 imported module instances 解析 constructor props；
- 先注入 `@Config()` providers，再注入普通 `@Inject()` dependencies；
- 注入 reflected property dependencies；
- injection 后运行一个 `@Init()` method；
- 初始化失败时移除 failed singleton；
- 对 path-bound file 这类不适合 singleton 的对象，通过 `create()` 创建 fresh object。

业务代码不能直接构造项目 class。如果对象属于运行时，就由 container 创建。

## Core Scopes

Core base classes 位于 `src/core/ioc/abstracts.ts`：

- `FlyFlor`: 根对象。
- `FService`: 无状态或拥有行为的 service object。
- `FComponent`: 有状态 component 或 lifecycle owner。
- `FFile`: path-bound file object。
- `FModule`: module boundary。
- `FRepo`: repository/entity SQL owner。
- `FPlugin`: plugin boundary。
- `FGuard` 和 `FSandBox`: policy scopes。
- `FAgent`: 由 RxJS subject 支撑的 autonomous agent object。

Decorators 位于 core module files：

- `src/core/decorator.ts`: 通用运行时 decorators，例如 `@Module`、`@Inject`、`@Init`、`@Config`。
- `src/core/prompt/decorator.ts`: `@Prompt`。
- `src/core/logger/decorator.ts`: `@Logger`。

decorator 表示意图；base class 表示对象类型。新增 runtime scope 时两者都要有。

## Prompt And File Layer

`@Prompt()` 把 agent property 绑定到已加载的 `FileService`。

`FileService` 加载一个 file 或 directory。对 directory，canonical markdown files 会变成 object keys，例如 `SOUL.md -> data.SOUL`。带额外 dotted stem 的文件会被 runtime 跳过，因此 human mirror 不进入执行。

Prompt protocol block 使用带 JSONC payload 的 `<flyflor:name>` tag。可渲染内容进入 `data`；解析后的 controls 进入 `blocks`。Malformed protocol 会在加载阶段抛错，因为 prompt 配置应该早失败。

## Agent Runtime

`Synapse` 从 `ConfigComponent` 读取 active profile，从 model config 解析默认值，然后让 container 创建 `Agent`。

`Agent` 拥有：

- 注入的 brain services；
- 注入的 memory component；
- 注入的已加载 prompt object；
- user/assistant context turns。

Provider-facing message list 由一个 `system` message 开始，随后是 user/assistant history。`SOUL`、`USER`、`AGENTS`、`MEMORY` 是 system message 内部的 Flyflor sections，不是模型 chat roles。

## Neural And IPC

`IPCService` 根据配置启动 public socket endpoint。在 Windows 上 endpoint 会在内部转换为 named pipe。

`FSocket` 拥有 Bun socket callbacks。它记录 lifecycle events，写入 open event，解码 inbound bytes，报告 malformed frames，并把 valid packets 路由到 `Synapse`。

`PacketService` 拥有 frame protocol：

- 8-byte unsigned big-endian body length；
- UTF-8 JSON body；
- per-connection decode buffers；
- partial headers 和 partial bodies；
- 一个 chunk 内多个 frames；
- oversized 和 malformed JSON frames。

## Logger

`src/core/logger` 有意保持紧凑：

- `service.ts`: `useLogger`、shared configuration、formatting、writing。
- `decorator.ts`: `@Logger`。
- `types.ts`: logger API 和 configuration types。
- `constants.ts`: formatting 和 default constants。

除非规模真的需要新对象，否则 formatting 和 writing 都是 `service.ts` 内部实现细节。

## Validation

`scripts/check.script.ts` 执行红线检查：

- application-class construction 只能在 IOC container；
- runtime code 不引用 human prompt mirrors；
- canonical docs/prompts 与 human mirrors 成对；
- source filenames 遵守 approved role conventions；
- exported functions 只出现在 decorator/container/logger/tooling surfaces。
