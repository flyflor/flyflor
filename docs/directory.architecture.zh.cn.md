# 目录架构

## 原则

目录是架构契约。路径必须先表达 owner、生命周期和副作用边界，不能靠配置或复用解释混乱。

Flyflor 代码保持 OOP + use composition：

- 业务 owner 用 class、Component、Module、Repo 和 Worker 表达。
- 跨 class 装配放在 `composition.ts`，并使用 `useXxx()`。
- `index.ts` 是 barrel，不是实现 owner。
- 正确 owner 内的少量重复，优先于生命周期不清的跨域 helper。

## 顶层源码 Owner

| 路径 | Owner |
| --- | --- |
| `src/app.ts` | FlyFlor composition root。 |
| `src/agent` | Runtime、Blackboard、context、sandbox、prompts、skills、MCP、plugins 和 workers。 |
| `src/cognitive` | Mindstream、Crystal 和 Hippocampus。 |
| `src/executive` | Capability / Tool / Trust / Loop。 |
| `src/socket` | `/ws`、`/health`、control/event 和 query snapshot 的 socket 血管层。 |
| `src/events` | Runtime event fabric。 |
| `src/protocol` | 可序列化 contract 和 wire envelope。 |
| `src/protocol/control` | `/ws` control/event envelope 和外部 thin-client protocol reader。 |
| `src/config` | JSONC config loading 和 defaults。 |
| `src/entities` | Entity mapping 和 repo SQL。 |
| `src/components` | 共享 Component base 和真正跨域基础设施。 |
| `src/types` | 只保留少量全局 type barrel。 |

## Agent

| 路径 | 职责 |
| --- | --- |
| `src/agent/runtime` | `RuntimeModule.handleMessage`、turn assembly、planning、routing、MCP/tool wiring、subagents 和 streaming。 |
| `src/agent/context` | 显式 `activeScope`、`contextForkId`、scope paths 和 continuity-owner derivation。 |
| `src/agent/blackboard` | Blackboard module/store 和 worker composition。 |
| `src/agent/sandbox` | Approval、quota、shell hook、audit 和 side-effect policy。 |
| `src/agent/mcp` | MCP stdio/SSE/HTTP transport、catalog 和 schema validation。 |
| `src/agent/plugin` | Plugin registry 和 runner。 |
| `src/agent/skills` | `SKILL.md` registry 和 selection surface。 |
| `src/agent/prompts` | 从 `templates/prompts` 加载和渲染模板。 |
| `src/agent/worker` | Worker manager 和 blackboard worker threads。 |
| `src/agent/di` | Decorator metadata 和显式 dependency container。 |

`src/agent/context` 在没有 scope/fork/codename 时刻意使用当前 turn id。Conversation/thread/user metadata 不是认知连续性。

## Cognitive

| 路径 | 职责 |
| --- | --- |
| `src/cognitive/mindstream` | Model provider clients 和 protocol conversion。 |
| `src/cognitive/hippocampus/ask` | 结构化 ASK block parsing。 |
| `src/cognitive/hippocampus/continuation` | Continuation decisions 和 ghost snapshots。 |
| `src/cognitive/hippocampus/memory` | Memory module、brain ledger store、working memory、hot memory、recall、decay、dream、consolidation、summary、scope memory 和 fork stores。 |
| `src/cognitive/hippocampus/scope` | Scope triggers、scaffolding、solidification、codename promotion 和 recall。 |
| `src/cognitive/crystal` | Crystal memory、Gem store 和 reflection promotion。 |

## Socket

`src/socket/module.ts` 拥有 server startup 和 HTTP surface。`src/socket/control.ts` 拥有 WebSocket control hub。`src/socket/query` 为 socket client 读取 ledger/detail snapshot。

规则：

- 不新增 `/health` 之外的 REST status surface。
- 不恢复 `/channels`。
- 不把 `gateway.*` 名称当作架构 owner；它们只是 wire-v1 compatibility 字符串。

## Executive

`src/executive` 包含 `registry.ts`、`planner.ts`、`tool.runtime.ts`、`trust.policy.ts`、`loop.guard.ts`、`manifest.ts`、`mcp.adapter.ts`、`computer.profile.ts` 和 `sidecar/runner.ts`。

这一层不读取自然语言推断意图。它消费 descriptor、config、channel capability、sandbox state、approval 和 numeric loop metrics。

## 运行态路径

| 路径 | 职责 |
| --- | --- |
| `~/.flyflor/.config/config.jsonc` | 主 JSONC 配置。 |
| `./docker/config/config.jsonc` | Docker dev 配置。 |
| `~/.flyflor/.config/prompts` | 已安装 prompt templates。 |
| `~/.flyflor/.config/templates/memory` | 已安装 memory templates。 |
| `~/.flyflor/.config/workspace` | 全局 Markdown constitution files。 |
| 当前月 `brain.db` | 可写生命账本。 |
| `brain/archive/` | 只读历史 ledger shards。 |
| `<scope.projectDir>/.flyflor/` | Scope-local memory、skills、MCP 和 plugin surface。 |

## 命名

- 目录入口：`index.ts`。
- 目录内单一 owner component：`component.ts`。
- 角色后缀：`module.ts`、`store.ts`、`repo.ts`、`worker.ts`、`manager.ts`、`adapter.ts`、`runner.ts`、`route.ts`。
- Prompt/template 文件使用点分后缀，例如 `blackboard.route.md` 和 `blackboard.route.zh.cn.md`。
- 不新增 `*.exports.ts`。
- 不新增连字符或下划线命名的仓库文件。

## 退役路径

以下路径不是活跃 owner surface，不得重新创建兼容壳：

- `src/fch`
- old execution-layer physical paths
- `src/skills`
- `src/context`
- `src/agent/gateway`
- 第一方 Bun CLI/TUI/channel adapter implementation surfaces
