# AGENTS.md — Flyflor 工程红线（权威）

> 本文件是 flyflor 的**唯一权威编程红线**。任何代码、重构、评审都以此为准。
> 与历史 `LOGS.md` 早期决策冲突处，**以本文件为准**（见文末「架构反转」）。
> 命名思想：**约定大于配置（convention over configuration）**。重复代码可以接受，**分层 / 文件夹 / 文件名 必须明确**。

---

## 0. 项目定位

flyflor 是一个 **Bun + TypeScript**、可编译为**单二进制**的智能体内核（「无会话智能生命体」）。
内核保持纯净；一切横切关注点（订阅、ASK/Confirm 中断、沙盒、IPC）经由**血管层 Capillary** 流动，对内核的上下文蒸馏 / 召回逻辑**零侵入**。

---

## 1. 编程红线（10 条 + 2 补充）

1. **DI 容器**：参考 NestJS / Angular 的依赖注入思想，**自研**实现（基于 `reflect-metadata`），不引入 InversifyJS / tsyringe / awilix。装饰器清单见 §2。
2. **约定大于配置 + OOP + Composition API**：分层、文件夹、文件名必须明确；整体面向对象 + 组合式（每个领域目录配 `composition.ts` 暴露 `useXxx()`）。**禁止面向过程 function 泛滥**。
3. **全局 CapillaryModule（血管层）**：实现 `subscribe` 与 `ask` / `confirm` 中断等待。内核遇到 Confirm / 沙盒 / ASK 等校验时 `await ask(...)` / `await confirm(...)`；订阅者可在 runtime constructor 或 `@Init` 中借 DI 注册。血管层让内核与外部解耦，对蒸馏召回影响最小。
4. **强制备注**：每个 `class` / composition api（`useXxx`）/ `interface` / `enum` **必须**有详细备注——用途、入参含义、产物含义、使用场景。
5. **0 魔法字符串工程**：业务代码中**不得散落硬编码字符串 / 数字字面量**，统一集中到 `enum` / `src/core/constants.ts` / 协议类型。**提示词**一律放顶层 `prompts/`，每份 `.md`（英文，**运行时唯一来源**）+ `.zh.cn.md`（中文副本，**项目不引用**）。`prompts/**/*.md` 必须有对应的 `.zh.cn.md` 兄弟，反之亦然；**任何 `*.ts` 不得 `import` 或 `readFileSync` 任何 `.zh.cn.md`**——`scripts/check.ts` 扫描拦截。提示词章节顺序以 `enum` 声明（如 `SoulSection`），不写死静态字符串。
6. **Bun 单二进制 + 性能是最高优先级**：`bun build --compile` 是硬需求；慎用伤性能的语法糖；二进制体积与启动/分发速度优先。
7. **配置全相对路径**：单一文件 `./.config/config.jsonc`；模型 / agent / 工具配置形态参考 `../reference/hermes-agent`。运行时路径常量 `rootPath` / `appPath` 见 `src/core/paths.ts`。
8. **IPC 统一对外**：智能体对话 / 行为 / 事件经 IPC 交互；跨 Windows / macOS / Linux；统一 IO，不给客户端造成负担。套接字文件 `./flyflor.sock`（Windows 用命名管道 `\\.\pipe\flyflor`）。IPC 是外部↔内核边界，**故血管层至关重要**。前期可不 await 直接放行 `true`，为后续 Rust TUI 壳做准备。
9. **反射注入 + alias 路径**：开启 `reflect-metadata`；`@Inject() public a: A` 按类型**免 token** 直接注入。**仅 DI/IOC 入口（`container.get`）可 `new`，其余地方一律禁止 `new`**。
10. **作用域装饰器 + Core 继承模式**：`@Component` `@Service` `@Module` `@Plugin` 标识作用域 / 生命周期。用 `class A extends B`（Core 模式）划分 Scope，**不堆枚举 / 配置，重在约定**。`listModule(B)` 取出 B 的全部子类实例；`getAsync(A)` 支持 `@Init` 异步初始化。

**补充 1**：再次强调——**只有 IOC 初始化入口能 `new`，其余地方禁止 `new`**（`scripts/check.ts` 会扫描拦截）。
**补充 2**：新增 `rootPath` / `appPath` 路径常量；新增 `@SandBox` 装饰器，**继承 `@Guard`**（装饰器组合），语义更清晰。

---

## 2. 装饰器清单

> **不维护任何「装饰器描述符数组 / Kinds 清单 / 字符串匹配注册表」**——装饰器直接定义即可，约定自带语义。运行时注册表只保留 DI 真正需要的最小元数据（`@Inject` 属性键、`@Module` 元数据）。

全部装饰器集中在 **`src/core/decorators.ts`**：

| 装饰器           | 目标     | 作用                                               |
| ---------------- | -------- | -------------------------------------------------- |
| `@Module(meta?)` | class    | 模块边界，声明 `imports` / `providers` / `exports` |
| `@Service()`     | class    | 无状态可注入服务                                   |
| `@Component()`   | class    | 有状态组件（持本地态 / 生命周期）                  |
| `@Plugin()`      | class    | 外部插件边界                                       |
| `@Repo()`        | class    | `src/entities` 数据仓库                            |
| `@Prompt(path)`  | property | 绑定 `prompts/<name>.md` 模板路径                  |
| `@Inject()`      | property | 按 `design:type` 反射注入（免 token）              |
| `@Init()`        | method   | 异步初始化钩子，`getAsync` 触发，幂等              |
| `@Guard()`       | class    | 守护 / 策略订阅者（订阅血管层 consult）            |
| `@SandBox()`     | class    | **继承 `@Guard`** + 追加 sandbox 标记              |

> 角色装饰器（`@Service` / `@Component` / `@Plugin` / `@Repo` / `@Guard` / `@SandBox`）**不带 `name`、不写任何容器可匹配的 key**，是纯意图标记；行为由对应基类与结构提供。仅 `@Module` / `@Inject` / `@Init` / `@Prompt` 承载 DI 接线元数据。

全部基类集中在 **`src/core/ioc/superclz.ts`**：`FService → FComponent → FModule`，并列 `FRepo` `FPlugin` `FGuard` `FSandBox extends FGuard`，并与 FService 平级增 **`FAgent`**（自主智能体 / "人" 语义的同源基类，平行于 FService；`listModule(FAgent)` 暴露所有主人格与子人格）。**装饰器标 DI 角色；基类提供 `listModule(Base)` 的继承式 Scope 分组。**

**生命周期 / Scope（纯结构，禁止 key/枚举分类）**：容器把每个被解析的类视为 DI 树上的**唯一节点（全单例）**，不用任何 key/枚举做生命周期分类。Scope 由**继承**表达——`listModule(Base)` 按原型链取出某基类全部子类实例（如 `listModule(FGuard)` 取全部守卫）。**结构（类继承 + `@Module` 图 + `@Inject` 边）是 DI 的唯一真相。**

---

## 3. 单 `new` 与 0 兜底

- 除 `src/core/container.ts` 容器内部，**全库禁止 `new`**。所有实例经 `@Inject` / `container.get` 获取。
- **禁止吞错、禁止兜底返回**：失败必须抛出带结构化 `detail` 的错误，不得静默返回默认值。
- 依赖只在 `@Init` 之后使用：构造函数内不得访问 `@Inject` 属性（两阶段「先建后注」期间可能为 `undefined`）。

---

## 4. 性能与打包

- 以 `bun build --compile` 可产出可运行 `dist/flyflor` 为验收门槛。
- reflect-metadata 必须在 `--compile` 下存活（`design:type` 不被裁剪）——这是头号风险，每次涉及装饰器改动都要回归。
- 热路径避免不必要的对象分配 / 闭包 / 深拷贝；JSON 序列化只在 IPC 边界发生。

---

## 5. 架构反转（覆盖 LOGS.md 早期决策）

1. **DI**：由「自研显式 DI + WeakMap，避免 reflect-metadata」→ **自研 + reflect-metadata 反射注入**，移除 awilix。
2. **血管层**：由 `CapillaryModule extends RxJS Observable` → **自研极简 typed pub/sub**，移除 RxJS。
3. **唯一 `new` 站点**：由 `src/bootstrap.ts` → **`src/core/container.ts`（`Factory.create` 经容器构造）**。
