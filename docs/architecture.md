# Flyflor 架构（Architecture）

> 配套红线见根目录 `AGENTS.md`。本文件描述**实现机制**。

## 1. 依赖注入（自研 + reflect-metadata）

```
Factory.create(RootModule)
  └─ 遍历 @Module 元数据 imports→providers→exports，register 每个类
  └─ container.getAsync(RootModule)
        └─ get(Ctor): 命中单例缓存→返回；否则 new Ctor()（全库唯一 new）
              ① 先把实例放入缓存（两阶段：先建后注，破解循环依赖）
              ② 读 Reflect.getMetadata("flyflor:inject", Ctor) 得 @Inject 属性键集合
              ③ 每个键用 Reflect.getMetadata("design:type", instance, key) 得依赖类
              ④ 递归 get(依赖类) 并赋值
        └─ 若 Ctor 有 @Init 方法：await 之（initialized Set 保证幂等）
```

- **免 token**：依赖类型由 `design:type` 反射得到，无需字符串 / symbol token。前提：`tsconfig.json` **直接**写 `experimentalDecorators` + `emitDecoratorMetadata`（不可经 `extends` 继承），且 `app.ts` 首行 `import "reflect-metadata"`。
- **`listModule(Base)`**：容器维护 `registered: Set<Ctor>`，按原型链过滤 `Base.prototype.isPrototypeOf(ctor.prototype) || ctor === Base`，逐个 `get` 返回。这是 rule 10「继承式 Scope」的实现——`class A extends B` 即归入 B 的 Scope，无枚举无配置。
- **循环依赖**：构造函数无参，属性注入发生在实例入缓存之后，环路解析到已缓存的（半构造）实例。**故依赖只能在 `@Init` 之后访问**。

## 2. 血管层 Capillary（自研 pub/sub）

`CapillaryModule` 不再继承 RxJS。内部维护 `Set<listener>` 通道：

| 方法                                                   | 语义                                   |
| ------------------------------------------------------ | -------------------------------------- |
| `subscribe(topic, listener)`                           | 订阅广播，返回取消函数                 |
| `broadcast(packet)` / `notice(topic, payload)`         | 广播副作用事件，await 监听器           |
| `ask(topic, payload): Promise<CapillaryConsultResult>` | 开放式询问（沙盒 ASK），首个 Deny 阻断 |
| `confirm(topic, payload): Promise<boolean>`            | 是/否确认；`await confirm(...).then`   |
| `packet(kind, topic, payload)`                         | 造 JSON 安全包（randomUUID + clock）   |

- **前期放行**：无 consult 监听器 **或** `config.sandbox.defaultDecision === "allow"` 时，`ask` 返回 `{ decision: Allow }`、`confirm` 返回 `true`，**不抛错**。
- 包结构 `CapillaryPacket` 全程 JSON 可序列化，可镜像到 IPC / 审计日志。

## 3. IPC（外部↔内核边界，内嵌血管层）

- `resolveIpcEndpoint()`：套接字地址由全局 `ConfigComponent.socketEndpoint` 统一封装——`process.platform === "win32"` 返回命名管道 `\\.\pipe\flyflor`，否则返回 unix socket 文件 `./flyflor.sock`。**消费者只见单一 endpoint，平台分支被隐藏**（约定大于配置，socket 路径不进 config 文件）。
- `Bun.listen({ unix })` 监听；帧 = **换行分隔 JSON（JSONL）的 `CapillaryPacket`**，统一 IO。
- 入站帧 → `capillary.broadcast` / `capillary.ask`；血管层出站包 → 写回 socket。
- 前期 consult 直接放行，为后续 Rust TUI 壳预留稳定帧协议。

## 4. 配置与路径

- 单一 `./.config/config.jsonc`（全相对路径），由 `ConfigComponent` 加载，类型见 `src/config/component.ts`。
- 全局 `ConfigComponent` 同时承载路径：`rootPath`（进程根，承载 `.config` / `flyflor.sock` / `sql` / `prompts`）、`appPath`（源码根）、`resolveFromRoot(rel)`、以及封装好的 `socketEndpoint`。路径常量字面量集中在 `src/core/constants.ts` 的 `PATHS`。

## 5. 关键风险

- **R1**：`bun build --compile` 下 `design:type` 元数据是否存活——头号风险，回退方案为 `@Inject(() => Dep)` 显式工厂（仍免字符串 token）。
- **R2**：Bun 在 Windows 经 `unix` 选项的命名管道支持需实测；façade 已隔离，回退 Win10+ AF_UNIX 文件。
