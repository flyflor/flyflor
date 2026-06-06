# LOGS

## 2026-06-02

- 建立首版工程红线计划后，开始落地 Bun + TypeScript 智能体内核骨架。
- 选择自研显式 DI，避免 InversifyJS/TSyringe 的 metadata 路线。
- 选择 `CapillaryModule` 作为血管层命名，并引入 RxJS 作为内部事件流实现。
- 收缩 DI 表面：移除 `@Worker`、`@Channel`、`@Plugin`，删除 `tokens.ts` 和 `types.ts`，改用 owner 文件内类型与 class token。
- 按最新规则恢复 `@Plugin` 修饰器；仍不恢复 `@Worker`、`@Channel`、`tokens.ts` 和 `types.ts`。
- 将 `@Module` 改为参考 NestJS 的对象式 metadata：`imports`、`providers`、`exports`，但不引入自动扫描或反射装配。
- 抽出 `src/ioc` 并用 Awilix 封装 IoC；新增 `@Prompt("../path")` 属性修饰器；将 socket path 从 `/ws` 改为 `/socket`。
- 新增红线：`src` 中只有 `src/bootstrap.ts` 可以使用 `new`，并禁止兜底逻辑和任何吞错行为。

## 2026-06-03

- 重订工程红线，权威化为根目录 `AGENTS.md`；新增 `docs/architecture.md`、`docs/boundaries.md`。
- **架构反转 1**：DI 由“自研显式 DI + WeakMap，避免 reflect-metadata”改为 **自研 + reflect-metadata 反射注入**（`@Inject() public a: A` 免 token），移除 awilix。
- **架构反转 2**：血管层 `CapillaryModule` 由 `extends RxJS Observable` 改为 **自研极简 typed pub/sub**，移除 RxJS（性能 / 二进制体积优先）。
- **架构反转 3**：唯一 `new` 站点由 `src/bootstrap.ts` 改为 `src/core/container.ts`（`Factory.create` 经容器构造）。
- 移除 `FlyflorDecorators` / `FlyflorDecoratorKinds` / `FlyflorDecoratorDescriptor` 镜像清单：约定大于配置，装饰器直接定义。
- 目录扁平化：删 `src/core/ioc/`（container 上移、decorators 合并进 `src/core/decorators.ts`）；`components/config` 上移为 `src/config`；新增 `src/guard`；IPC 内嵌 `src/capillary/ipc`。
- IPC 传输改为 `./flyflor.sock`（POSIX）+ `\\.\pipe\flyflor`（Windows），JSONL 帧；前期 consult 放行 true，为 Rust TUI 壳预留。
- 新增 `@Init`、`@Guard`、`@SandBox`（继承 `@Guard`）装饰器；新增 `rootPath` / `appPath` 常量。
