# Boundaries

共享边界纪律来自 `oop-code-redlines` skill。本文档只说明 Flyflor 当前各目录拥有什么。

## 命名

Flyflor 使用语义目录加角色文件。

```txt
src/core/prompt/
  index.ts
  service.ts
  decorator.ts
  constants.ts
  types.ts
```

`index.ts` 只能做 barrel。不要在里面添加行为。

优先使用 `service.ts`、`types.ts`、`constants.ts`、`decorator.ts`、`factory.ts`、`container.ts`、`abstracts.ts`、`socket.ts`、`module.ts`、`entity.ts`、`repository.ts` 和 `*.test.ts` 这类角色文件。

legacy dotted names 可以等专门迁移再处理。新代码不应在 folder 已经命名对象时再新增 dotted split。

## Source Boundaries

- `src/core`：framework primitives、decorators、IOC、base classes、file/prompt/logger primitives。
- `src/config`：runtime configuration object 和 root path constants。
- `src/agent`：agent object、memory、brain、intelligence services 和 mode placeholders。
- `src/neural`：signal routing、IPC socket handling 和 packet encoding。
- `src/entities`：repository/entity classes 和 SQL statement ownership。
- `src/plugins`：plugin module boundary 和 built-in tool plugin objects。
- `scripts`：local tooling；这里允许 procedural code。
- `prompts`：canonical runtime prompt sources 和 human mirrors。
- `sql`：schema files。

## Core Index

- Decorators：
  - `src/core/decorator.ts`：general IOC/runtime decorators。
  - `src/core/prompt/decorator.ts`：`@Prompt()`。
  - `src/core/logger/decorator.ts`：`@Logger()`。
- Base classes：
  - `src/core/ioc/abstracts.ts`：`FlyFlor`、`FService`、`FComponent`、`FModule`、`FRepo`、`FPlugin`、`FGuard`、`FSandBox`、`FAgent` 和 `FCortex`。
- IOC：
  - `src/core/ioc/container.ts`：`Container`、`useContainer()`、construction、injection、lifecycle 和 metadata helpers。
- Barrels：
  - `src/core/index.ts` 导出 public core surface，并导入 `reflect-metadata`。
  - directory-local `index.ts` 只能 re-export local surfaces。

## Object Ownership

- `Agent` 拥有 turn，并通过自己的 subject 流式输出。
- `Memory` 拥有 prompt assembly 和 working conversation context。
- `Brain` 拥有一个 inference transform。
- `Intelligence` 拥有 provider communication 和 cancellation。
- `Synapse` 拥有 active-agent routing。
- `FSocket` 拥有 Bun socket callbacks。
- `PacketService` 拥有 length-prefixed JSON packet encoding 和 decoding。
- `FileService` 拥有 path-bound file state 和 persistence。
- Repositories 拥有 SQL statements 和 entity shapes。

不要把行为移出拥有相关 state 或 boundary 的对象。

## Imports

跨 source domain 使用 `@/*` imports。同一目录边界内使用 relative imports。

被注入的 class dependencies 必须是 runtime imports，确保 reflect metadata 可用。

## Scripts

`scripts` 是 tooling boundary，可以使用 procedural helper functions。生产 runtime code 应使用 object methods，除非属于 `oop-code-redlines` 允许的 boundary API。
