# 遗忘系统

## 目的

遗忘≠删除。实现类似人类记忆系统的时间驱动衰减：热记忆被压缩成摘要（不删除原文），晶体 Gem 发生语义偏移。遗忘曲线参考艾宾浩斯曲线——记忆快速衰减然后趋于平缓。被召回的记忆重置衰减计时器；未被引用的记忆加速衰减。

参考：openhuman 的 recency_decay + hotness 评分、admission gate 机制。

## 模块结构

```
src/forgetting/
  index.ts
  forgetting.module.ts
  forgetting.types.ts
  forgetting.service.ts       # @Service() ForgettingService
```

## 遗忘曲线模型

```
记忆强度
  1.0 |*
      | *
      |  *
  0.5 |   *                   ← 24h 后降至 50%
      |     *
      |       *  *  *  *  *   ← 趋于平缓
  0.1 |________________*______
      0   1h  1d   7d   30d

公式: strength = 1 / (1 + ageHours / 24)
```

| 年龄 | 强度 | 操作 |
|------|------|------|
| < 1h | 1.0 → 0.96 | 无 |
| 1h – 24h | 0.96 → 0.50 | 重要性微调 |
| 1d – 7d | 0.50 → 0.22 | LLM 压缩为摘要 |
| 7d – 30d | 0.22 → 0.03 | 深度压缩 + 漂移 |
| > 30d | < 0.03 | 仅保留摘要，原文归档到 brain.db |

## 两种遗忘模式

### 热记忆衰减

MemoryChunk 的重要性随时间降低。

```
衰减流程:
  ForgettingService 周期扫描 memory_chunks
    → 计算 ageHours
    → 应用艾宾浩斯衰减: newImportance = importance * strength
    → 如果 newImportance <= COMPACTION_THRESHOLD (0.3):
        → 调用 LLM 将原文压缩为摘要
        → memory.store(摘要，sourceKind='compacted')
        → memory.forgetChunk(原文) 或降低重要性标记
    → 如果 newImportance <= ZERO_THRESHOLD (0.05):
        → 原文仅保留在 brain.db 审计中
        → memory.forgetChunk(原文)
```

### 晶体记忆偏移

Gem 的语义随时间发生微小偏移。由 LLM 执行。

```
偏移流程:
  ForgettingService 周期扫描 crystal_gems
    → 计算 ageDays
    → 如果 ageDays >= DRIFT_THRESHOLD (14d):
        → 调用 LLM 根据最近使用情况微调 Gem 的 summary
        → 更新 confidence -= drift_penalty
        → 如果 confidence <= EXPIRE_THRESHOLD (0.3):
            → mark status='stale'
            → emit('crystal.gem.expired')
```

## 信号契约

### 发射

| 信号 | payload | 说明 |
|------|---------|------|
| `forgetting.cycle.started` | `{ cycleId, triggeredBy, startedAt }` | 遗忘周期开始 |
| `forgetting.chunk.compacted` | `{ chunkId, originalLength, compactedLength, summary }` | Chunk 被压缩为摘要 |
| `forgetting.chunk.faded` | `{ chunkId, previousImportance, newImportance, ageHours }` | 重要性衰减 |
| `forgetting.fact.aged` | `{ factId, previousConfidence, newConfidence, ageHours }` | 结构化事实老化 |
| `forgetting.gem.drifted` | `{ gemId, gemName, previousSummary, newSummary, driftVector }` | Gem 语义偏移 |
| `forgetting.cycle.completed` | `{ cycleId, chunksCompacted, chunksFaded, factsAged, gemsDrifted, elapsedMs }` | 周期完成统计 |
| `forgetting.schedule.adjusted` | `{ reason, previousIntervalMs, newIntervalMs }` | 调度间隔调整 |

### 订阅

| 信号 | 用途 |
|------|------|
| `context.compacted` | 预压缩/中压缩触发遗忘扫描 |
| `memory.store` | 新存储的 chunk/fact 重置衰减计时器 |
| `memory.recall` | 被召回的 chunk/fact 获得 recency boost |
| `recovery.scan` | 恢复后触发遗忘扫描 |
| `tool.started` | 工具活跃时抑制定时遗忘（避免干扰） |
| `tool.completed` | 工具完成后重新评估 |

## 定时调度

```
默认间隔: FORGETTING_INTERVAL_MS = 3_600_000 (1小时)

调度调整:
  - 活跃时段: 不触发
  - 工具运行中: 抑制
  - 恢复后: 立即触发
  - 上下文压缩后: debounce 5s 后触发
```

## 内核改动

无需修改 `AgentRuntimeService`。ForgettingService 是独立 `@Service()`。

唯一内核相关改动：
- `SocketServerService.attachRuntimeBroadcasts()` 添加 `forgetting.*` 信号
- `KernelModule` 导入 `ForgettingModule`

## 红线确认

- 遗忘不删除 BrainComponent 审计数据 ✅
- 压缩内容存入 MemoryComponent 作为新 chunk ✅
- 周期通过 RxJS timer 驱动 ✅
- OOP class 封装 ✅
- 不修改 AgentRuntimeService ✅
