# Flyflor 目录与分层边界（Boundaries）

> 红线见 `AGENTS.md`，机制见 `docs/architecture.md`。本文件锁定**目录职责**。

```
src/
  core/        内核：DI 容器 + 全部装饰器 + 全部基类 + bootstrap + 路径/常量
    container.ts   自研 IoC 容器；【唯一允许 new 的文件】get/getAsync/listModule
    decorators.ts  全部装饰器（不维护镜像描述符数组）
    superclz.ts    全部基类（继承式 Scope 锚点）
    factory.ts     Factory.create(RootModule) bootstrap 入口
    constants.ts   全局枚举 / 常量 + PATHS 路径字面量（0 魔法字符串归集地）
    index.ts       barrel
  capillary/   血管层（自研 pub/sub，无 RxJS）
    module.ts      CapillaryModule
    composition.ts useCapillaryModule()
    index.ts
    ipc/         IPC 边界（外部↔内核，内嵌血管层）
      service.ts   跨平台 socket façade + JSONL 帧
      module.ts    IpcModule（经 CapillaryModule 导出）
      index.ts
  config/      配置加载（单一 JSONC）
  guard/       @Guard / @SandBox 策略订阅者
  entities/    @Repo 数据层（参数化 SQL，schema 在 sql/）
  agent/       智能体运行时内核（runtime / worker）
  module.ts    根 AppModule
prompts/   <name>.md（运行时唯一来源）+ <name>.zh.cn.md（副本，不引用）
sql/       NNN-*.sql（仅建表 / 索引 / seed）
.config/   config.jsonc（单一，全相对路径）
scripts/   check.ts（红线校验：禁 new + prompts 双语 + 魔法串）
```

## 边界规则

- 每个领域目录配 `index.ts`（barrel）与 `composition.ts`（`useXxx()` 组合根）；跨类装配只在 `composition.ts` 发生。
- `core/` 不依赖任何业务域；业务域只经 `@/core` barrel 取装饰器 / 基类 / 容器。
- IPC 归属 `capillary/ipc/`：它是外部世界进入内核的唯一通道，必须经血管层，不得直连内核业务类。
- `entities/` 只产出参数化 `{sql, params}`，不做持久化假装；真实存储后端后续接入。
- 别名：源码内统一用 `@/*` 指向 `src/*`（见 `tsconfig.json` paths）。
