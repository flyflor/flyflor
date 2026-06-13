# AGENTS.md - Flyflor 项目规则

Flyflor 默认使用共享的 `oop-code-redlines` skill 作为工程纪律。在本仓库写代码、审查、重构、修 bug、加测试或写文档前，都要加载并遵守该 skill。

本文件只保留 Flyflor 的项目级补充。如果共享规则和项目规则冲突，本仓库以项目规则为准。

## Flyflor 代码规则

1. 代码是事实源。文档只能描述已经实现的行为，或者明确标注为计划。
2. 运行时代码以 OOP 为主。业务行为必须归属到继承正确核心基类的 class 上：`FModule`、`FService`、`FComponent`、`FRepo`、`FPlugin`、`FGuard`、`FSandBox`、`FAgent` 或 `FCortex`。
3. Composition 风格的 exported function 只允许出现在明确边界：decorator、factory、bootstrap、scripts、protocol adapter 和低层 framework helper。
4. 方法体 300 行是软上限，500 行是硬上限。500 行以内不要乱抽 helper；只有当拆分能命名真实对象动作、隔离副作用、形成复用或降低真实复杂度时才拆。
5. 目录名表达语义名词。文件名表达目录内角色，例如 `index.ts`、`service.ts`、`types.ts`、`constants.ts`、`decorator.ts`、`factory.ts`、`container.ts`、`abstracts.ts`、`socket.ts`、`module.ts`、`entity.ts`、`repository.ts` 和 `*.test.ts`。
6. `index.ts` 只能做 barrel re-export，不能承载行为。
7. 不要新增泛化的 `utils`、`manager`、`parser`、`compiler` 或 `diagnostic` 文件，除非真的出现对象边界并且代码规模持续需要。
8. 跨 source domain import 使用 `@/*`。同一目录边界内优先使用相对 import。

## 运行时边界

1. `reflect-metadata` 必须先于 decorated classes 加载。
2. 只有 IOC container 可以构造应用 class。不要在 `src/core/ioc/container.ts` 之外对项目 class 调用 `new`；需要容器对象时使用 `useContainer().getAsync()`，需要 fresh path-bound object 时使用 `useContainer().create()`。
3. 被注入的 class dependency 必须是 runtime import，不能是 type-only import。
4. decorator 和 base class 位于 `src/core`。新的 runtime scope 必须通过 decorator 加 inheritance 表达，不能靠松散 registry 或字符串 flag。
5. 配置放在 `./.config/config.jsonc`；secret 放在环境变量。
6. IPC frame 是 8-byte big-endian length-prefixed JSON。Socket 代码必须容忍 chunking、frame coalescing、malformed frame 和 split UTF-8 bytes。

## 文档规则

1. 仓库内每个文档 `.md` 都必须有 `.zh.cn.md` 人类镜像，包括根目录 `*.md`、`docs/**/*.md` 和 `prompts/**/*.md`。
2. runtime prompt source 是 canonical English `.md`。`.zh.cn.md` 只是人类参考，运行时代码绝不能读取。
3. 不要让 README、docs 或 prompts 变成第二套规则系统。共享工程风格在 `oop-code-redlines`；Flyflor 特有规则在本文件。

## 健康门槛

认为改动健康前，至少运行 `bun run check`。行为变更还要运行相关 `bun test`。

## Worktree 策略

worktree 可能是 dirty。不要回滚用户改动。无关改动忽略，除非它们阻塞当前任务。
