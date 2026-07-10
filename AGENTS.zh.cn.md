# AGENTS.md - Flyflor 项目规则

Flyflor 默认使用项目内 `.agents/skills/oop-code-redlines/SKILL.md` 作为工程纪律。编写、审查、重构、调试、测试或记录仓库代码前必须加载它。当本文件更严格时，以本文件为准。

## 内核原则

Flyflor 是持续存在、无 Session 的智能生命体。所有设计只服务于：理解用户需求、调查事实、摘要证据并准确完成任务。

- Synapse 是 singleton 大脑皮层；
- Context 是 singleton 且是 Turn 唯一所有者；
- Agent 是 Agent pool 中持续存在的一个人；
- Memory 是该人物私有的有界临时记忆，绝不持有 Turn；
- Tools 直接执行具体动作。

## 代码规则

1. 代码是事实来源，文档描述已经实现的行为。
2. Runtime 代码以 OOP 为先。行为属于继承正确基础类的 class：`FModule`、`FService`、`FComponent`、`FAgent`、`FCortex`、`FTool`。
3. 导出 function 仅限 decorator、bootstrap、script、protocol adapter 与底层 framework helper。
4. Method body 300 行软限制、500 行硬限制。只提取真实对象动作、复用行为、隔离副作用或实际阶段。
5. 源码 domain 为 `core`、`config`、`prompt`、`model`、`agent`、`neural`、`tool`、`transport`；`src/app.ts` 与 `src/bootstrap.ts` 是组合边界。
6. Directory 名是一个小写英文单词，filename 描述本地角色，`index.ts` 只能作为 barrel。
7. 禁止新增通用 utils、manager、parser、compiler、diagnostic、event framework、XML service 或 session directory。
8. 跨 domain 使用 `@/*` import；同一 directory boundary 内使用相对 import。
9. 每个 runtime class、constructor、method、accessor 都有简洁 EN/ZH JSDoc，说明所有权、生命周期或输入输出。

## 严格失败规则

1. Source、script、test 中禁止 CatchClause、`.catch()`、rejection fallback handler、吞错、友好兜底回答、协议兜底与 endpoint 兜底。
2. 只释放资源且不改变 rejection 的 `try/finally` 允许存在。
3. Tool 失败原样 reject。Spawn 错误 reject；非零退出与 timeout 保留为显式进程数据。
4. 缺少 config、prompt file、prompt mapping、XML block、socket connection、switch branch，以及非法 model/tool JSON 都立即 reject。
5. Observable 与 IOC lifecycle rejection 原样传播；受影响回路 fail-stop。

## 依赖规则

1. 业务依赖方向是 `app -> neural -> agent -> model/tool`。
2. Neural 可以依赖 Transport；Transport 永不导入 Neural。
3. Agent 永不导入 Neural；信号通过 `AgentBus` 与 Agent 内稳定判别结构跨边界。
4. Model 与 Tool 互不依赖，由 Agent cognition 组合两者结构契约。
5. Core、Config、Prompt 是共享基础设施，不得用于绕过业务所有权。

## IOC 与生命周期

1. `reflect-metadata` 必须先于 decorated class 加载。
2. Bootstrap 调用 `Factory.create(AppModule)`，`@Init` 持有 lifecycle wiring。
3. 只有 IOC 可以构造 application class；container 外使用 `useContainer().getAsync()` 或 `useContainer().create()`。
4. Decorator 只允许 `Module`、`Provide`、`Singleton`、`Inject`、`Scope`、`Init`、`Config`、`Prompt`。
5. Singleton 只有在 injection 与 Init 成功后才缓存。
6. 每个持久 Agent 获得一个隔离 resolution scope；其 Brain、Callosum、Investigation、Identity、Memory、Model 在 scope 内复用，与其他人物完全隔离。
7. Synapse 为每个完整配置保留唯一 Agent，绝不修改共享 profile config。

## 神经边界

1. Observable 继承 FlyFlor，只暴露 `pipe`、`switch`、`subscribe` 与 FIFO `next`。
2. Synapse 持有相互独立的感觉、交互、委派、表达回路。
3. Ask 与 Confirm 共用串行交互回路；Task 使用委派回路；Reply 与根 Complete 使用表达回路。
4. Agent stimulus 进入该人物私有 FIFO；同一人物串行思考，不同人物可并发调查。
5. Callosum 对每次根输入只感知一次，只返回 `reply`、`research` 或 `soul`。
6. Investigation 在 Init 中一次性构建 Ask、Confirm、Task、Complete 分支；委派运行看不到 Task。
7. Filesystem、Shell、Execute 是直接动作，不是神经信号。

## Context 与 Memory

1. Turn 只存在于 `src/agent/context`，永不从 barrel 导出，且只能由 Context 创建或修改。
2. 外部调用者只得到复制后的 `ContextBrief` 与 `TurnSummary`。
3. Complete 是最终摘要，Context 直接保存，不执行 settlement 模型调用。
4. Memory 只保存所属 Agent 的有界 notes，不含 Turn、status、provider replay 或 session state。
5. Reconnect 与 browser refresh 只重置 transport state。

## Prompt 规则

1. PromptService 是唯一 prompt package 与 XML rendering 边界；禁止新增 XmlService 或手写 dynamic XML。
2. Runtime 加载规范英文 `.md`，忽略 `.zh.cn.md` 镜像。
3. Package policy 控制有序 sections、document blocks、editable files、locked files、runtime-ignored files。
4. Identity write 按 package policy 只允许 `SOUL.md`、`USER.md`、`EXTENSION.md`，并在任何写入前完成全部验证。
5. 仓库内每个文档 Markdown 都有 `.zh.cn.md` 人工镜像。

## Model、Tool 与 Transport

1. Provider endpoint、authentication、path、wire parsing 位于 `src/model/protocol`；每个 provider 只映射一个协议与 endpoint。
2. Tools 持有 Ask、Filesystem、Shell、Execute、Task；不存在 standalone Confirm tool。
3. Task 只验证委派描述；Synapse 派发持久 Agent 并等待 Complete 摘要。
4. Transport 通过 awaited callback 报告输入，永不导入 Synapse。
5. IPC 使用八字节 big-endian JSON body length，随后是 UTF-8 JSON；Socket 处理 chunking、coalescing、split UTF-8、malformed packet 与 backpressure。

## 健康门

`bun run check` 是最低健康门，并包含 failure rule、IOC-only construction、JSDoc、method limit、private Turn、forbidden Session type 的 AST 检查。聚焦变更运行相关测试。完成内核级重构前必须运行 `bun test` 与 `bun run build:binary`。

当真实模型 credential 可用时，完成 cognition prompt、provider protocol、neural routing、具体 tool 或 Web/IPC boundary 变更前必须运行 `bun run test:live`。Live suite 必须使用一次性文件，不得修改持久 identity 或用户日志。

## Worktree 策略

Worktree 可能已有修改。不得回退用户变更；无关修改只在阻塞任务时处理。
