# EQ 模块（提案）

> Status: **proposal — 未落地**。本文是设计稿，不代表当前代码状态。代码内尚无 `eq` 目录，runtime 也未引用情绪建模。下面所有约定一律视为「等待评审」。

## 目标

为 Flyflor 提供「情绪状态」的轻量建模能力，让模型在 turn 之间能感知到用户当前情绪基线，并影响：

- 回复语气（保留在 SOUL.md 约束之下）
- skill 选择优先级（不绕过 boundaries 红线，仍走模型结构化字段）
- 是否触发安抚 / 缓冲性消息

## 不做的事

- **不做关键词检测**。情绪分类必须由模型在结构化字段中返回，参考 `feedback.classify.md`。
- 不替代 USER.md 长期偏好；EQ 只是短期状态。
- 不引入新的硬编码语义规则。

## 概念模型

```mermaid
flowchart LR
    Turn["完成 turn"] --> Classify["eq.classify.md<br/>模型返回 {valence, arousal, dominance, label}"]
    Classify --> Store["EQStore（待设计）"]
    Store --> Decay["valence 指数衰减（资源指标）"]
    Store --> Prompt["renderEqContextPrompt"]
    Prompt --> Sys["runtime.system.md"]
```

## 数据结构（草稿）

```ts
interface EqState {
    valence: number;        // -1..1
    arousal: number;        // 0..1
    dominance: number;      // 0..1
    label: "neutral" | "joy" | "anger" | "sadness" | "fear" | "surprise";
    confidence: number;
    updatedAt: string;
}
```

## 与边界的关系

- valence 衰减允许走纯资源指标（时间窗 / 计数器）。
- 标签 / 强度变化必须由模型结构化字段产生，禁止文本匹配。
- 数据落点：建议 SQLite 单表 `eq_state`，与 session 同 key。

## 落地清单（如批准）

1. 加 `eq.classify.md` 模板，约束模型返回 schema。
2. `src/agent/eq/` 模块（继承 `Service` decorator）。
3. `MemoryModule.buildPrompt` 注入 `eqContext`。
4. 决策点（skill 选择 / 回复策略）只读模型结构化字段，不读文本。
5. 测试覆盖：分类 schema、衰减、与 USER.md 偏好不冲突。

## 风险点

- 情绪建模容易引入隐形语义判断（必须严格走结构化字段）。
- 误触发安抚消息会显著破坏体验，需要明确审批通道。
- 与 SOUL.md 的语气约束可能冲突；SOUL.md 优先级更高。
