# Boundaries

Flyflor 使用 folder 作为名词，file 作为角色。目录应该说明“这是什么东西”，目录内文件说明“这个东西的哪类职责”。

## Naming

首选 module shape：

```txt
src/core/prompt/
  index.ts
  decorator.ts
  constants.ts
  types.ts
```

允许的 compact role files：

- `index.ts`
- `service.ts`
- `types.ts`
- `constants.ts`
- `decorator.ts`
- `factory.ts`
- `container.ts`
- `abstracts.ts`
- `socket.ts`
- `*.test.ts`

Legacy dotted files 可以在已存在的位置保留。当 folder 已经提供语义名词时，不要为了模仿 Angular/Nest 新增 dotted split。

`index.ts` 永远是 barrel，不能承载逻辑。

## Object Rule

面向对象代码意味着行为属于一个可见的东西：

- Agent behavior 属于 `Agent`。
- Prompt loading 属于 `@Prompt()` 和 `FileService`。
- File persistence 属于 `FileService`。
- Packet framing 属于 `PacketService`。
- Socket callbacks 属于 `FSocket`。
- Model completion 属于 `Intelligence`。
- SQL statement ownership 属于 repositories。

除非真的出现新的对象边界，否则不要新增 manager/parser/compiler/diagnostic 文件。

## Core

`src/core` 只拥有 framework primitives：

- `decorator.ts`: common decorators。
- `factory.ts`: bootstrap factory。
- `ioc/`: base classes、container、metadata types。
- `file/`: path-bound file object。
- `prompt/`: prompt decorator 和 protocol types/constants。
- `logger/`: logger decorator/service/types/constants。

业务领域应从 `@/core` import primitives。除非是在扩展 core 本身，不要深入无关 core internals。

## IOC

Container 是唯一 application class construction point。`getAsync()` 用于 singleton graph objects。`create()` 用于 fresh IOC-owned objects，例如 path-bound files。

业务代码不要对项目 class 使用 `new`。`Error`、`Map`、`Set`、`Date`、`TextDecoder`、`Response`、`RegExp` 等 built-ins 允许使用。

## Decorators

Decorators 是 core API，因此允许导出 decorator functions。

通用 decorators 放在 `src/core/decorator.ts`。专用 decorators 放在自己的语义模块中：

- `@Prompt` 位于 `src/core/prompt/decorator.ts`
- `@Logger` 位于 `src/core/logger/decorator.ts`

不要把新的 runtime scope 藏在 config string 后面。如果 scope 是真实对象，应新增 base class 和 decorator。

## Prompt And Files

运行时代码只读取 canonical `.md` prompt files。Human mirror files 是文档辅助，runtime rules 会拒绝读取它们。

`FileService.data` 是可渲染内容。`FileService.blocks` 是 prompt application protocol index。除非 agent 实际消费，否则不要添加额外 public state。

## Agent

`src/agent` 拥有 person-like runtime object：

- prompt context assembly；
- user/assistant turn history；
- injected brain 和 memory objects；
- profile-specific runtime state。

不要把 provider wire logic 放进 `Agent`；它属于 `Intelligence`。不要把 packet/socket concerns 放进 `Agent`；它们属于 `neural`。

## Neural

`src/neural` 拥有 signal flow：

- `Synapse` 把 decoded packets 路由到 active agent。
- `ipc/` 拥有 transport listener 和 socket handler。
- `packet/` 拥有 byte framing。

外部 client 通过 IPC 通信。业务对象不应该打开临时 socket。

## Config

`src/config` 拥有 configuration object 和 root path constant。配置从 `./.config/config.jsonc` 加载；secrets 必须来自环境变量。

## Entities

`src/entities` 拥有 SQL statement objects 和 entity shapes。当前 repositories 返回 parameterized SQL statements。不要记录还不存在的 persistence behavior。

## Scripts

`scripts` 是 tooling boundary。这里允许 procedural code，包括必要的 exported helper functions。生产源码优先使用 object methods。
