# AGENTS.md - Flyflor 项目规则

Flyflor 默认使用项目内 `.agents/skills/oop-code-redlines/SKILL.md` 作为工程纪律。在本仓库写代码、审查、重构、修 bug、加测试或写文档前，先加载并遵守该文件。发生冲突时，以下 Flyflor 项目规则优先于 skill。

## 代码规则

1. 代码是事实源。文档只描述已经实现的行为，或者明确标记计划内容。
2. 运行时代码以 OOP 为主。行为必须归属到继承正确基类的 class：`FModule`、`FService`、`FComponent`、`FAgent`、`FCortex` 或 `FTool`。
3. Exported function 只允许出现在明确边界：decorator、bootstrap、scripts、protocol adapter 和低层 framework helper。
4. 方法体 300 行是软上限，500 行是硬上限。只有真实对象动作、可复用行为、隔离副作用或真实复杂度才值得抽取。
5. 每个目录名都是单个小写英文单词。顶层源码根目录只能是 `app`、`core`、`config`、`prompt`、`model`、`agent`、`neural`、`tool`、`transport`。
6. 文件名表达目录内角色，例如 `index.ts`、`service.ts`、`types.ts`、`constants.ts`、`decorator.ts`、`container.ts`、`abstracts.ts`、`socket.ts`、`packet.ts`、`module.ts`、`entity.ts`、`*.test.ts`。
7. `index.ts` 只能做 barrel，不能承载行为或副作用。
8. 没有长期稳定的对象边界时，不要新增泛化的 `utils`、`manager`、`parser`、`compiler`、`diagnostic` 文件。
9. 跨 source domain 使用 `@/*` import。同一目录边界内优先使用相对 import。

## 依赖规则

1. 业务依赖固定为 `app -> neural -> agent -> model/tool`。
2. `neural` 可以依赖 `transport`；`transport` 绝不能 import `neural`。
3. `agent` 不能 import `neural`。跨边界信号使用 agent bus contract 和稳定 action string。
4. `model` 与 `tool` 不能互相依赖，由 agent orchestration 组合它们的结构化 contract。
5. `core`、`config`、`prompt` 是共享设施，不能用来绕过业务所有权。

## 运行时边界

1. `reflect-metadata` 必须先于 decorated class 加载。
2. 只有 IOC 可以构造应用 class。在 `src/core/ioc/container.ts` 之外使用 `useContainer().getAsync()` 或 `useContainer().create()`。
3. 被注入的 class dependency 必须是 runtime import，不能是 type-only import。
4. Decorator 只保留 `Module`、`Provide`、`Singleton`、`Inject`、`Scope`、`Init`、`Config`、`Prompt`。
5. `Turn` 是唯一会话实体。`Memory` 是它的唯一所有者，并且错误边界必须把 active Turn 标记为 failed。
6. Brain 持有认知。Callosum 每条输入只感知一次。Synapse 持有输入、协调、交互和 Agent pool。
7. Model endpoint、auth、path 和 wire parser 是 `src/model/protocol` 下的协议约定；配置不能重新建立 protocol registry。
8. `Tools` 显式持有具体工具。每个工具自己持有 schema、cwd 约定、prompt 描述和审批决策。不要新增 standalone confirm tool。
9. Transport 通过 callback 或 packet contract 上报输入，不能 import Synapse。
10. 配置位于 `.config/config.jsonc`；secret 位于环境变量。
11. IPC packet 使用 8-byte big-endian JSON body length 加 UTF-8 JSON body。Socket 必须容忍 chunking、coalescing、malformed packet、split UTF-8 bytes 和 backpressure。

## Prompt 规则

1. Prompt 按目录和文件名约定加载。运行时只读取 canonical English `.md`，忽略 `.zh.cn.md` mirror。
2. Identity 写入在代码中固定限制为 `SOUL.md`、`USER.md`、`EXTENSION.md`。不要重新引入通用 XML 写入 policy。
3. 仓库内每个文档 `.md` 都必须有 `.zh.cn.md` 人类镜像，包括根目录文件、`docs/**/*.md` 和 `prompts/**/*.md`。
4. README 和 docs 是实现参考，不是额外规则系统。

## 健康门槛

`bun run check` 是最低健康门槛。行为变更要运行相关 `bun test`。完成内核级重构前运行 `bun test` 和 `bun run build:binary`。

## Worktree 策略

worktree 可能是 dirty。不要回滚用户改动。无关改动忽略，除非它们阻塞当前任务。
