# 记忆系统

## 一句话定位

Flyflor 的上下文装配只来自 `Memory + Crystal + explicit Scope/Fork`。`brain.db` 负责保存和查询生命经历，但不直接参与 prompt 装配。

这篇文档的核心目的，就是把“记忆系统”和“账本系统”明确拆开，并把 Flyflor 的热记忆、晶体智力、Scope 生命域和月分片生命账本区分清楚。

## 系统分工

```mermaid
flowchart LR
    subgraph Context["Context assembly"]
        Markdown["Markdown 宪法层"]
        Memory["Memory recall"]
        Crystal["Crystal recall"]
        Scope["activeScope"]
        Fork["contextForkId"]
    end

    subgraph Ledger["Ledger / query"]
        Brain["brain.db"]
        Archive["archived months"]
        Detail["fork / blackboard / history detail"]
    end
```

### Context assembly 负责什么

- 当前输入
- Markdown 宪法层
- Memory recall（热记忆）
- Crystal recall（晶体智力）
- 显式 scope
- 显式 fork
- Executive 可见能力面

### Ledger/query 负责什么

- 完整 turn 对话保存
- 历史查询
- fork 回放
- blackboard 详情
- 审计
- 月度归档

## `brain.db` 的真实职责

`brain.db` 是当前月唯一可写 ledger。

它保存：

- 全部 turn 对话
- 全部 fork 详细对话
- 全部 blackboard 深度思考详细信息
- 结构化状态、摘要、links、replay、plan、fork 索引

它不负责：

- 直接作为 prompt 原文来源
- 自动恢复“当前上下文”
- 成为 scope 容器
- 成为 user/handshake/chat/thread 的隐式连续性桶

## 月度模型

固定模型是：

- 当前月：可写 `brain.db`
- 历史月：只读 archive shards

也就是说，Flyflor 的生命账本不是单一总库，而是每个月诞生一份新的 `brain.db` 分片；历史月保留为只读审计与检索面。

不维护“当前总副本”。

## 相关代码路径

- `src/cognitive/hippocampus/memory/module.ts` — Memory 主入口
- `src/cognitive/hippocampus/memory/brain/store.ts` — `brain.db` store 门面
- `src/entities/memory/brain/*` — brain 表 owner 的 entity / repo
- `src/cognitive/hippocampus/memory/working/*` — working memory
- `src/cognitive/hippocampus/memory/scope/*` — scope-local memory 文件面
- `src/cognitive/hippocampus/scope/*` — scope 固化触发、codename 升格和脚手架
- `src/cognitive/crystal/*` — crystal recall / graph / gem

## Scope-local memory

显式 `activeScope` 存在时，runtime 可以读取 scope-local memory。

这层的职责是：

- scope 宪法
- scope 摘要
- scope 下可复用压缩结果
- scope 相关 recall 索引

它的设计主语不是“项目目录附属配置”，而是智能生命体对长期事情形成的独立生命工作域。

一个 Scope 一旦被确认并固化，它应当被理解为局部生命域，而不是简单标签：

- 它拥有独立的宪法层
- 它拥有独立的记忆入口与索引面
- 它拥有独立的召回装配资格
- 它可以承接后续的 codename、fork、task plan 和 replay 连续性

它不是：

- 从 `brain.db` 原始事件里直接拼 prompt
- 通过 `channel/chat/thread/user` 自动猜出来的工作域

## Fork

`ContextFork` 是显式分支，不是隐式连续性容器。

规则：

- 只有调用方显式传入 `contextForkId`，fork 才进入上下文
- fork 详情保存到 ledger/query plane
- fork 可有低频 sidecar，但摘要索引仍在 `brain.db`

## Codename

`codename` 保留，但降回轻量层：

- 锚点
- scope proposal 入口
- recall boost
- `codename -> scope` 升格前置层

codename 不再自动打开 scope，也不再充当隐式上下文容器。

## 没有显式 scope 时会发生什么

不会发生的事：

- 不创建 fallback scope
- 不创建 inbox scope
- 不按 chat/thread/channel/user 恢复工作域
- 不把 transport 连续性变成记忆连续性

会发生的事：

- 只做 `Memory + Crystal + explicit fork`
- recall 退回全局或 turn-local 语义
- blackboard 只在当前 turn 已装配的上下文上运行

## 当前实现口径

### Memory

Memory 负责：

- 热记忆召回
- 工作记忆 episode
- 行为快照
- ask/continuation/identity/replay/plan/fork 的记忆侧挂接
- scope-local memory 文件面

Memory 不负责：

- 从 transport tuple 恢复上下文
- 把 brain event 原文直接塞给模型

Memory 在这里更接近生命体的热缓冲区：它保留近期活动、近期偏移和仍在升温的事实，但不替代 Crystal 的长期稳定方法层。

### Crystal

Crystal 负责：

- 稳定、可复用的方法/知识/Gem
- 结构化长期 recall
- 漂移修复与长期图维护

Crystal 不负责：

- 临时 turn 容器
- 直接接管显式 scope

Crystal 不是更大的 Memory；它负责的是已经经得起沉淀的稳定能力。Memory 与 Crystal 的关系是分层协作，而不是容量升级或冷热缓存的简单替代。

## Ask、结晶与遗忘

Flyflor 的长期成长不是靠“把所有聊天留着”，而是靠 ask 闭环、结晶闭环和遗忘曲线：

- Ask 负责把边界不清、黑板封顶、scope 升格、工具 loop 配额耗尽等场景显式交还给用户
- 高质量 ask-answer、黑板收敛、反思证据和长期任务收束，会变成 Crystal 的结晶候选来源
- 遗忘不是简单删除，而是通过热记忆压缩、晶体向量偏移、漂移修复和 LLM 再组织完成的生命再编码

这也意味着 Flyflor 的成长不是“日志越来越大”，而是：

1. 经历先进入热记忆与生命账本
2. 经 ask / reflection / blackboard /长期任务收束形成结构化证据
3. 高价值部分再被结晶成长期可复用的能力

## Blackboard detail

blackboard 详细信息固定保存在 ledger/query plane。

原则：

- normalized tables 优先
- event 流只挂必要摘要和关联 id
- 查询层按需 join / replay

禁止做法：

- 把完整 blackboard 详情只塞进 event JSON
- 把 blackboard 结果直接当成 隐式连续性容器

## 历史查询

`history.list` 读取的是全局 ledger。

它不是：

- per-user 上下文恢复接口
- per-chat 恢复接口
- scope 恢复接口

scope、fork、replay、plan 只是 turn 上附着的结构化对象。

## 仍保留的红线

- 约定大于配置
- 目录和文件名优先
- 明确 owner，允许重复，不为去重强行抽象
- `oop + use composition`
- 零字符匹配红线
- `brain.db` 与 prompt 装配不能重新混回去

## 当前最重要的判断句

如果你在实现里看到下面这种思路，就说明偏了：

- “先把 chat/thread/user 找出来，再恢复上下文”
- “没有 scope 也先给它造个默认 scope / workspace”
- “从 brain.db 最近几条 event 直接拼 prompt”

正确方向永远是：

- 先看有没有显式 `activeScope`
- 再看有没有显式 `contextForkId`
- 再用 `Memory + Crystal` 做 recall
- `brain.db` 只作为 ledger/query plane 提供召回素材和审计事实
