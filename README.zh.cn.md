# Flyflor

Flyflor 是一个 Bun + TypeScript agent kernel。它使用 decorator、base class 和 reflect-metadata IOC container，让构造、生命周期、prompt 加载、IPC 和模型调用保持显式。

## 工程规则

Flyflor 使用共享的 `oop-code-redlines` skill 作为通用代码形态规则：

- OOP 承载业务行为。
- Composition API 只限明确边界。
- 默认使用语义目录加角色文件命名。
- 方法体 300 行为软上限，500 行为硬上限。
- 只有当抽取能形成真实命名动作、复用、副作用边界或复杂度下降时才拆 helper。

仓库特有规则在 [AGENTS.md](AGENTS.md)。

## 开发

```bash
bun install
bun run check
bun test
bun run dev
bun run build:binary
```

`bun run check` 会运行 TypeScript 和当前项目红线扫描，是最低健康门槛。

## 当前运行流程

1. `src/bootstrap.ts` 先导入 `reflect-metadata`，再调用 `Factory.create(AppModule)`。
2. `Container` 构建 module imports，注入 decorated properties，运行 `@Init()`，并保存 singleton instances。
3. `ConfigComponent` 加载 `./.config/config.jsonc`；secret 保持在环境变量。
4. `IPCService` 启动 Bun Unix socket 或 Windows named pipe。
5. `FSocket` 接收 bytes，并把 packet decoding 交给 `PacketService`。
6. `PacketService` 编解码 8-byte big-endian length-prefixed JSON packets。
7. `Synapse` 创建配置中的 active `Agent`，并把 decoded packets 路由给它。
8. `Agent` 向 `Memory` 请求 prompt/context messages，再从 `Brain` 流式输出。
9. `Intelligence` 通过 protocol adapters 打开配置中的 provider stream。

## 源码布局

```txt
src/core/          IOC、decorators、base classes、file/prompt/logger primitives
src/config/        runtime configuration object
src/agent/         agent、memory、brain、modes
src/neural/        synapse、IPC socket、packet encoding
src/entities/      repository/entity classes 和 SQL owners
src/plugins/       plugin module boundary
scripts/           local tooling
prompts/           canonical prompt sources 和 human mirrors
sql/               schema files
```

目录是语义名词。目录内文件使用 `service.ts`、`types.ts`、`constants.ts`、`decorator.ts`、`repository.ts` 和 `index.ts` 这类角色名。

## Prompt Runtime

runtime prompt files 是 canonical English `.md`。`.zh.cn.md` 这类 human mirror 只供阅读，运行时代码不打开。

Agent prompt directory 通过 `@Prompt()` 加载为 `FileService` object。agent 消费已加载的 file data，不直接读 prompt 文件。

## 更多文档

- [Architecture](docs/architecture.md)：runtime flow、decorator index、base class index 和 IOC details。
- [Boundaries](docs/boundaries.md)：directory ownership、core source locations、object ownership 和 import rules。
