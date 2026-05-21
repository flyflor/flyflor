# {{title}} Agent 指南

这个文件是 AI coding agent 在当前显式 scope 中工作的共享上下文。

## 目标

{{goal}}

## 工作规则

- 将 scope-local capability 状态保存在 `.flyflor/` 下。
- 优先做显式、可审查的改动，不依赖隐藏工具行为。
- 不要在这个 scope 中保存密钥、日志、运行时数据库或用户私有数据。
- 语义决策必须由模型驱动；不要用关键词匹配替代意图、路由、记忆或反馈决策。
- 当工作范围或状态变化时，同步更新 `TODO.md`。

## Scope 元数据

- Scope id：`{{scopeId}}`
- 创建时间：`{{createdAt}}`
- 触发来源：`{{trigger}}`
- 关联 episode id：{{relatedIds}}
