# Crystal Reflection

## 定位

Crystal 是晶体智力：由 evidence 生成的稳定可复用知识、方法和 Gem。它不同于 hot Memory，也不同于 ledger。

代码 owner：

- `src/cognitive/crystal/memory/component.ts`
- `src/cognitive/crystal/memory/vector.index.ts`
- `src/cognitive/crystal/gems/component.ts`
- `src/cognitive/crystal/reflection/crystal.reflection.ts`
- `src/agent/runtime/reflection/worker.ts`

## 流程

1. Runtime 和 Memory 从 ASK answers、fork merges、blackboard convergence、task outcomes、replay records 和 reflection candidates 创建结构化 evidence。
2. Crystal reflection 归一化 candidate 并检查质量。
3. 稳定 candidate 可以成为 Gem knowledge。
4. Crystal recall 后续为 context assembly 提供稳定方法或事实。
5. Drift repair 处理陈旧或矛盾的 crystallized knowledge。

Crystal promotion 不是自动 transcript copy。原始 event count 不足以升格；candidate 必须携带有用 evidence 和质量。

## 与 Memory 的关系

Memory 是热的、适应性的。Crystal 是稳定的、可复用的。

Memory 可以 decay、compress 和 recall 近期材料。Crystal 应保存通过 evidence 检查的可复用方法或知识。两层都可以引用 ledger provenance，但都不会把原始 `brain.db` event rows 直接变成 prompt context。

Executive/ASK 证据也可以进入 reflection candidate，但仍不能直接升格 Gem：

- `subagent.batch` Durable Job 暂停、完成或失败会把 `jobId`、progress、child status、tool counts 和 ASK id 写入 `brain.db` execution-job ledger。
- 高权限 ASK 可以携带 `crystalCandidates`，例如 `execution-job` 或 `tool-stability`。
- `ReflectionWorker` 把这些结构化字段转成 `sourceKind = "executive-ask-candidate"` 的候选证据。
- 证据权重只让 candidate 留档和等待质量门；Gem 升格仍必须通过 `CrystalReflectionComponent.evaluateGemQualityGate()`。
- `other` ASK 回答可以作为 evidence provenance，但 runtime 不解析其自然语言语义。

## Vector 与 Drift

Crystal vector 逻辑支持 recall 和 repair，不做业务 intent routing。Tokenizer、hash、cosine 和 freshness 逻辑属于 crystal vector owner。Recall scores 是资源指标，不是语义关键词规则。

## Gem 边界

Gem 是已结晶的可复用 artifact。它可以作为稳定知识影响未来 prompt，但不应携带原始隐藏对话日志。

## 测试

相关覆盖：

- `tests/crystal.local.backend.test.ts`
- `tests/reflection.boundaries.test.ts`
- `tests/reflection.gem.consolidation.test.ts`
- `tests/reflection.worker.test.ts`
