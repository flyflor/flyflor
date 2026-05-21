# 目录架构

## 一句话定位

目录和文件名是 Flyflor 的第一约定。

这里不讨论“理论上可以怎么抽象”，只讨论“当前主线代码必须怎么摆”。约定大于配置，owner 大于聪明，分层必须先于复用。

## 先看三条红线

1. 业务代码保持 `oop + use composition`。class / Component / Module 是默认表达方式；`useXxx()` 只做装配。
2. 目录先表达边界，再谈抽象。允许重复，不为了消灭少量重复去打散 owner。
3. 文件名必须服从目录语义。目录已经说明职责时，文件名用短名；只有同目录多 owner 时才加限定前缀。

## 主源码分层

| 路径 | owner | 责任 |
| --- | --- | --- |
| `src/app.ts` | composition root | 启动 Flyflor 主类，显式装配容器，不承载业务流程 |
| `src/agent` | Agent 外显层 | runtime、gateway、blackboard、sandbox、context、skills、worker、MCP、plugin |
| `src/cognitive` | Cognitive 认知层 | Mindstream、Crystal、Hippocampus |
| `src/executive` | Executive 外骨架 | capability、tool、trust、loop |
| `src/events` | 事件血管 | `RuntimeEvent` 发布、订阅、分类、广播 |
| `src/protocol` | 公共协议 | enum、contract、control envelope、structured block |
| `src/config` | 配置层 | JSONC 配置、默认值、路径约定 |
| `src/entities` | 数据实体层 | row / record 映射、repo SQL owner |
| `src/components` | 基础设施层 | 共享 Component 基类、SQL tagged template 等真正跨域基础设施 |
| `src/types` | 轻量共享类型层 | 少量全局 type barrel，不回流业务 owner |

## `src/agent`

`src/agent` 只承载“外显运行态”，不承载认知内核，也不充当历史兼容垃圾桶。

| 路径 | 责任 |
| --- | --- |
| `src/agent/runtime` | 单轮主链、turn 生命周期、流式回复、route / ask / blackboard / executive 接线 |
| `src/agent/context` | 显式 `activeScope`、`contextForkId`、可见 capability surface 的上下文装配 |
| `src/agent/gateway` | `/ws`、`/health`、`/channels` 最小血管层；只做 transport，不做隐式连续性 |
| `src/agent/blackboard` | 多 worker 讨论、收敛、cap 后 ask 交还 |
| `src/agent/sandbox` | shell / network / plugin / MCP / computer 的副作用边界 |
| `src/agent/mcp` | MCP transport、catalog、执行适配 |
| `src/agent/plugin` | plugin manifest、runner、bridge |
| `src/agent/skills` | `SKILL.md` 能力包接入与使用面 |
| `src/agent/prompts` | 运行时提示词渲染入口，只读取 `templates/prompts/*.md` |
| `src/agent/worker` | 后台 worker 与调度 |
| `src/agent/di` | `@Module`、`@Provide`、`@Inject` 元数据与显式容器 |

关键约束：

- `src/agent/context` 只认显式 scope/fork，不创建 fallback scope，不按 `channel/chat/thread/user` 恢复工作域。
- `src/agent/gateway` 不拥有 session 连续性；transport session 只属于外部协议握手。
- `src/agent/prompts` 只做模板渲染，不内嵌大段模型指令正文。

## `src/cognitive`

| 路径 | 责任 |
| --- | --- |
| `src/cognitive/mindstream` | 当前轮理解、推理、生成、模型协议转换 |
| `src/cognitive/crystal` | 反思、Gem、长期稳定知识与方法复用 |
| `src/cognitive/hippocampus` | 工作记忆、召回、压缩、遗忘、ledger/query 接线 |

这里尤其要分清两件事：

- 认知层可以读取 recall、summary、scope memory index
- 认知层不能把 `brain.db` 原始流水直接当 prompt

Scope 固化触发和 scope-local memory 的活跃代码路径分别是 `src/cognitive/hippocampus/scope/*` 与 `src/cognitive/hippocampus/memory/scope/*`。磁盘字段里仍可能保留 `projectDir` / `projectMemoryDir` 兼容名，但设计主语和代码入口统一为 `Scope`。

## `src/executive`

`src/executive` 是能力外骨架，不是第二套 runtime。

常见 owner：

- `registry.ts`
- `planner.ts`
- `tool.runtime.ts`
- `loop.guard.ts`
- `trust.policy.ts`
- `mcp.adapter.ts`

这一层只消费结构化能力描述、权限、approval、sandbox policy 和数值指标，不做自然语言语义判断。

## `src/events`

`src/events` 是唯一事件血管 owner。

它拥有：

- `bus.ts`
- `classifier.ts`
- `runtime.event.ts`
- sinks / types / component

它不拥有：

- gateway 协议
- runtime 私有状态
- 记忆召回规则

## `src/protocol`

| 路径 | 责任 |
| --- | --- |
| `src/protocol/contracts` | enum、record、transport 共享类型 |
| `src/protocol/control` | `/ws` control/event envelope、payload schema、semantic lane |
| `src/protocol/processes` | 进程间 envelope |
| `src/protocol/structured.block.ts` | 模型结构化块登记表 |

`src/protocol/control` 是 Rust 外壳和 thin client 的长期接线面。这里可以兼容读取 `activeProject`，但 canonical 字段只能是 `activeScope`。

## `src/entities`

`src/entities` 只做数据层 owner，不做 service。

典型职责：

- row / record 编解码
- repo SQL
- 结构化表 owner

典型边界：

- 可以知道表结构
- 不可以知道模型提示词
- 不可以知道 gateway 连接
- 不可以做业务语义判断

## `src/components`

`src/components` 只放真正跨模块的基础设施。

允许：

- 共享 Component 基类
- SQL helper
- 少量无领域归属的底座

不允许：

- `src/components/memory`
- `src/components/crystal`
- `src/components/gateway`

领域 owner 必须回到自己的目录，不准在 `src/components` 里造假边界。

## `src/types`

`src/types` 只保留少量全局 type barrel。

一旦某个类型明显属于某一层或某一模块，就应回到对应目录的 `types.ts` 或 `index.ts`，不要把 `src/types` 变成第二个杂物间。

## 文件命名规则

硬规则：

- 目录入口统一 `index.ts`
- 目录内唯一组件 owner 直接叫 `component.ts`
- 角色文件使用点分后缀：`module.ts`、`worker.ts`、`manager.ts`、`adapter.ts`、`store.ts`、`repo.ts`
- 禁止新增 `*.exports.ts`
- 禁止新增连字符或下划线命名的仓库文件

例子：

- `src/agent/di/composition/component.ts`
- `src/agent/runtime/streaming/visibility.ts`
- `src/cognitive/hippocampus/memory/dream/worker.ts`
- `src/entities/memory/brain/event/repo.ts`

反例：

- `dependency.container.ts`
- `protocol.visibility.ts`
- `dream.worker.ts`
- `memory_context.ts`

## 运行态目录

源码目录之外，运行态也有明确 owner：

| 路径 | 责任 |
| --- | --- |
| `~/.flyflor/.config/config.jsonc` | 主配置 |
| `~/.flyflor/.config/commands.jsonc` | future client 本地命令协议 |
| `~/.flyflor/.config/prompts` | 提示词 override |
| `~/.flyflor/.config/workspace` | 用户工作区 |
| `~/.flyflor/.config/brain.db` | 当前月 ledger |
| `~/.flyflor/.config/brain/archive/` | 历史月只读归档 |

这些路径属于运行态，不得被重新解释成源码层抽象。

## 已移除的旧物理路径

以下路径已经从主源码移除，不允许新增兼容壳或回写：

- `src/fch`
- `src/executive`
- `src/skills`
- `src/context`
- 第一方 CLI/TUI/channel adapter 主源码面

它们的历史解释价值只留在 `abandon/` 和 `docs/old-docs/`。主源码移除之后，活跃文档必须只描述今天仍然真实存在的 owner。
