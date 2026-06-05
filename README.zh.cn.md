# Flyflor

Flyflor 是 Bun + TypeScript 的 agent kernel，围绕可见运行时对象构建。它使用 decorators、base classes 和 reflect-metadata IOC container，让构造、生命周期、prompt 加载、IPC 和模型调用都保持显式。

## 对象模型

Flyflor 把架构名称当作工程约束：

- `Agent` 是类似“人”的对象，拥有 profile configuration、prompt constitution、chat context 和 subscriptions。
- `Prompt` 是 agent 的宪法和应用层协议。`@Prompt()` 注入已加载的 `FileService`，因此 agent 代码读取 `prompt.data` 和 `prompt.blocks`，不直接碰 filesystem。
- `FileService` 是可触摸的文件对象，绑定一个 path，加载 markdown data，提取 `<flyflor:xxx>` protocol blocks，并暴露显式 create/update/upsert/delete 方法。
- `Neural` 是信号层。`Synapse` 把 decoded packets 路由到 active agent。
- `IPC` 是外界感官边界。Packet 和 socket 对象负责 wire protocol。
- `IOC` 是构造边界。应用对象由 `Container` 创建，不允许分散的 `new` 调用。

## 开发

```bash
bun install
bun run check
bun test
bun run dev
bun run build:binary
```

`bun run check` 会运行 TypeScript 和项目 red-line checker，是最低健康门槛。

## 当前运行流程

1. `src/bootstrap.ts` 导入 `reflect-metadata`，然后调用 `Factory.create(AppModule)`。
2. `Container` 构建 module imports，注入 decorated properties，运行 `@Init()`，并保存 singleton instances。
3. `ConfigComponent` 加载 `./.config/config.jsonc`；密钥保存在环境变量中。
4. `IPCService` 启动 Bun Unix socket 或 Windows named pipe。
5. `FSocket` 接收 bytes，并把 frame parsing 交给 `PacketService`。
6. `PacketService` 编码/解码 8-byte big-endian length-prefixed JSON frames。
7. `Synapse` 创建配置中的 active `Agent`，并把 decoded packets 路由给它。
8. `Agent` 从 prompt sections 组装一个 system message，并追加 user/assistant context turns。
9. `Intelligence` 是 OpenAI-compatible streaming chat-completions client。

## 源码结构

```txt
src/core/          IOC, base classes, decorators, file/prompt/logger primitives
src/config/        runtime configuration object
src/agent/         agent, memory placeholder, brain services, modes
src/neural/        synapse, IPC socket, packet framing
src/entities/      SQL statement owners and entity shapes
src/plugins/       plugin module boundary
scripts/           local tooling
prompts/           canonical prompt sources and human mirrors
sql/               schema files
```

文件夹是语义名词，内部文件通常使用 `service.ts`、`types.ts`、`constants.ts`、`decorator.ts`、`index.ts` 这样的 compact role 名称。

## Prompt Runtime

运行时 prompt 文件是 canonical English `.md`。`.zh.cn.md` 这类 human mirror 只给人读，不由运行时代码打开。

Agent prompt directory 由 `@Prompt()` 加载：

```ts
@Prompt('agent', function wrapper(this: Agent) {
    return this.agentConfig.name;
})
public prompt!: FileService<AgentPrompt>;
```

Markdown protocol blocks 是应用层控制：

```md
<flyflor:ask_policy>
{
    version: 1,
    enabled: true,
    maxQuestions: 3,
}
</flyflor:ask_policy>
```

可渲染 markdown 进入 `prompt.data`；解析后的 protocol blocks 进入 `prompt.blocks`。

## 更多文档

- [Architecture](docs/architecture.md)
- [Boundaries](docs/boundaries.md)
