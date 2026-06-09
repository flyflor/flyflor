# AGENTS.md - Flyflor 工程规则

本文件是项目代码规范的权威来源。代码是事实来源：文档必须描述已经实现的代码，不描述想象中的架构。

## 定位

Flyflor 是 Bun + TypeScript 的 agent kernel。运行时采用对象优先：agent、file、module、service、repository、socket、packet、prompt 都是可见对象，必须有名字、所有权、生命周期和边界。

架构语言是语义化的：

- `Agent` 是类似“人”的运行时对象，拥有 profile、prompt、conversation context 和 subscription。
- `Prompt` 是 agent 的宪法和应用层协议。`@Prompt()` 注入已加载的文件对象；`<flyflor:xxx>` 这类 prompt block 是应用控制，不是模型 chat role。
- `FileService` 是可触摸的文件对象，绑定一个 path，拥有已加载的 `data`、解析后的 `blocks` 和显式持久化方法。
- `Neural` 是信号层。`Synapse` 接收 packet 并路由到 active agent。
- `IPC` 是外界感官边界。socket 和 packet 类只负责 wire transport，不承载业务行为。
- `IOC` 是构造与生命周期边界。应用对象由 container 创建，不允许随处 `new`。

## 红线

1. 代码优先。代码变更后再更新文档；除非明确标记 planned，否则只描述已经实现的行为。
2. 使用对象边界。业务行为必须属于继承正确 core 基类的 class：`FModule`、`FService`、`FComponent`、`FFile`、`FRepo`、`FPlugin`、`FGuard`、`FSandBox`、`FAgent` 或 `FCortex`。
3. decorators 和 base classes 归 `src/core`。新的运行时 scope 必须通过 decorator + inheritance 表达，不使用松散 registry 或纯字符串 flag。
4. 只有 IOC container 可以构造应用 class。不要在 `src/core/ioc/container.ts` 之外对项目 class 调用 `new`；需要 singleton graph 用 `useContainer().getAsync()`，需要 path-bound 新对象用 `useContainer().create()`。
5. 保持 reflect metadata。`reflect-metadata` 必须在 decorated classes 之前加载；被注入的 class dependency 必须是 runtime import，不能是 type-only import。
6. 目录内 role 文件是主命名约定。允许的 role 文件名包括 `index.ts`、`service.ts`、`types.ts`、`constants.ts`、`decorator.ts`、`factory.ts`、`container.ts`、`abstracts.ts`、`socket.ts`。已有 dotted legacy 文件可以保留，但不要新增不必要的 dotted 拆分。
7. `index.ts` 只做 barrel re-export，不能承载行为。
8. 模块保持紧凑。不要把一个小行为拆成 `parser/compiler/diagnostic/transformer` 等文件，除非代码规模真的需要新的边界。
9. exported function API 只允许出现在 decorator、IOC/container helper、logger core helper、bootstrap/tooling script 和明确的 composition API 中。领域行为应是对象方法。
10. 跨领域源码 import 使用 `@/*`。同一目录边界内优先使用 relative import。
11. 仓库内每个文档 `.md` 都必须有 `.zh.cn.md` 人类阅读副本，包括根目录一级 `*.md`、`docs/**/*.md` 和 `prompts/**/*.md`。
12. 运行时 prompt source 是 canonical English `.md` 文件。`.zh.cn.md` mirror 只给人读，运行时代码不得读取。
13. 配置放在 `./.config/config.jsonc`；密钥放环境变量。
14. IPC frame 是 8-byte big-endian length-prefixed JSON。socket 代码必须处理 chunking、frame coalescing、malformed frame 和 split UTF-8 bytes。
15. `bun run check` 是变更健康的最低门槛；行为变更还要运行相关 `bun test`。

## 命名与文件夹

首选目录内 role 文件：

```txt
src/core/logger/
  index.ts
  service.ts
  decorator.ts
  types.ts
  constants.ts
  service.test.ts
```

当 folder 已经是语义名词时使用这种形态。目录说明“logger”，文件说明“service”。

仅在目录本身不是语义名词，或避免扩大已有 legacy 改动时，保留 dotted legacy 名称。不要批量重命名无关文件。

## 目录职责

- `src/core`: framework primitives，包括 IOC、base classes、decorators、file objects、prompt protocol、logger 和 bootstrap factory。
- `src/core/ioc`: container、reflect metadata helper、core abstract base classes、IOC types。
- `src/core/file`: path-bound file object 和持久化表面。
- `src/core/prompt`: `@Prompt()` 和 Flyflor prompt block protocol constants/types。
- `src/core/logger`: `@Logger()`、logger configuration、formatting、writing、constants 和 logger types。
- `src/config`: runtime configuration object 和 root path constant。
- `src/agent`: agent object、prompt-context assembly、memory placeholder、brain services、mode placeholders。
- `src/neural`: signal routing 和 IPC transport boundary。
- `src/neural/packet`: IPC frame encoding/decoding。
- `src/neural/ipc`: Bun socket listener 和 socket handler。
- `src/entities`: repository/entity classes 和 SQL statement owners。
- `src/plugins`: plugin module boundary。
- `scripts`: 本地 tooling；这里允许 procedural code。
- `prompts`: canonical runtime prompt sources 和 human mirrors。
- `sql`: schema files。

## 文档副本

每个 canonical `.md` 文档都必须有同 stem 的 `.zh.cn.md` sibling。英文/canonical 文档是 runtime 和 tooling source；中文 mirror 只给人读，不能被 runtime import 或打开。

## Worktree 策略

worktree 可能是 dirty 的。不要 revert 用户改动。无关改动忽略，除非它阻塞任务。并行工作使用 branch；除非明确要求，不创建持久 linked worktree。
