# Sandbox 血管侦查者

## 目的

RxJS 驱动的血管层侦查者，拦截**全部**需要中断的请求——Confirm（工具级权限）和 ASK（用户决策级询问）。侦查者挂在 SignalBus 上，通过 RxJS 管道进行模式匹配、异常检测和自动审批/拒绝，无法判断的升格为用户 ASK。

参考：codex 沙盒的安全边界分层（builtin → agent → user）、hermes-agent 的 execpolicy 分层架构。

## Confirm ≠ ASK

| 维度 | Confirm | ASK |
|------|---------|-----|
| 层级 | 工具执行级 | 用户决策级 |
| 触发者 | `guard.ask` 信号 | 侦查者无法判断时升格，或 LLM 主动发起 |
| 响应 | boolean（允许/拒绝） | 结构化选项（1-n 点，每点 1-3 选项） |
| 处理者 | SandboxGuard | CrystalService（经 Sandbox 中转） |

## 模块结构

```
src/sandbox/
  index.ts
  sandbox.module.ts
  sandbox.types.ts
  sandbox.guard.service.ts    # @Service() SandboxGuard
  sandbox.pattern.store.ts    # @Component() 学习模式持久化
```

## 信号契约

### 发射

| 信号 | payload | 说明 |
|------|---------|------|
| `sandbox.inspected` | `{ inspectId, toolName, turnId, riskScore, anomalyScore }` | 请求已侦查 |
| `sandbox.approved` | `{ inspectId, reason, patternConfidence }` | 自动批准 |
| `sandbox.denied` | `{ inspectId, reason, ruleViolated }` | 自动拒绝 |
| `sandbox.escalated` | `{ inspectId, reason, suggestedAsk }` | 升格为 ASK |
| `sandbox.pattern.learned` | `{ patternId, rule, confidence }` | 新判断模式已学习 |
| `sandbox.anomaly.detected` | `{ inspectId, anomalyType, toolName, riskIndicators }` | 异常检测到 |

### 订阅

| 信号 | 用途 |
|------|------|
| `guard.ask` | **主订阅**：拦截所有 Confirm 请求 |
| `guard.answer` | 观察审批结果，用于模式学习 |
| `tool.call` | 预侦查工具调用，异常检测 |
| `tool.started` | 追踪执行状态，检测时序异常 |
| `tool.denied` | 学习拒绝模式 |
| `tool.error` | 捕获工具错误，识别新风险 |
| `chat.message` | 检测用户直接覆盖指令 |
| `crystal.gem.elevated` | 将新 Gem 规则纳入侦查模式 |

## RxJS 侦查管道

### 管道 1：请求拦截 → 侦查

```
guard.ask$                                    // 所有 Confirm 请求
  → filter(isConfirm)                         // 排除 ASK（ASk 走 CrystalService）
  → mergeMap(buildInspectionContext)          // 构建侦查上下文
  → tap(ctx => emit('sandbox.inspected', ctx))
```

### 管道 2：模式匹配 → 自动判断

```
sandbox.inspected$
  → withLatestFrom(loadedPatterns$)            // 加载已学习的模式
  → map(matchAgainstPatterns)                 // 模式匹配
  → map(result => {
      confidence >= AUTO_APPROVE → emit('sandbox.approved')
      confidence >= AUTO_DENY   → emit('sandbox.denied')
      无法判断                   → emit('sandbox.escalated')  // 升格 ASK
    })
```

### 管道 3：异常检测

```
tool.call$
  → filter(isPotentiallyRisky)                // 风险工具（shell, write, edit）
  → mergeMap(checkRiskIndicators)             // 检查风险指标
  → filter(isAnomalous)                       // 异常？
  → tap(anomaly => emit('sandbox.anomaly.detected'))
```

### 管道 4：模式学习

```
merge(sandbox.approved$, sandbox.denied$)
  → withLatestFrom(guard.answer$)
  → bufferTime(60000)                         // 1 分钟窗口
  → filter(buffer => buffer.length >= 5)      // 足够样本
  → map(extractCommonPattern)                 // 提取共同模式
  → tap(pattern => emit('sandbox.pattern.learned'))
  → mergeMap(storePatternAsMemoryFact)        // 持久化为 MemoryFact
```

## 安全分层

参考 codex 沙盒的分层架构：

```
Layer 1: Builtin Rules（内置规则，不可覆盖）
  - 阻止 shell 危险命令（rm -rf, dd, mkfs, shutdown, fork bombs）
  - 阻止写入系统路径（/etc, /usr, /boot）
  - 阻止网络 SSRF（内网地址、云元数据端点）

Layer 2: Agent Profile Rules（agent profile 定义的工具边界）
  - Worker 只能使用其 profile.tools 中声明的工具
  - 只能在其 working directory 范围内操作

Layer 3: Learned Patterns（学习到的模式）
  - 从历史 Confirm 结果中学习的自动判断规则
  - 持久化为 MemoryFact（namespace='sandbox'）
  - 高置信度 → 自动批准/拒绝
  - 低置信度 → 升格 ASK

Layer 4: User Override（用户覆盖）
  - 用户通过 chat 直接指令可以覆盖 sandbox 判断
  - 覆盖模式被学习和持久化
```

## 学习模式存储

判断模式作为 MemoryFact 持久化：

```typescript
// 模式 shape
interface SandboxPattern {
  readonly patternKey: string;      // 如 "shell:git:status" 
  readonly toolName: string;        // 匹配的工具
  readonly rule: 'approve' | 'deny';
  readonly conditions: Record<string, unknown>; // 匹配条件
  readonly confidence: number;      // 0-1
  readonly hitCount: number;
}

// 存储为 MemoryFact
memoryComponent.upsertFact({
  namespace: 'sandbox',
  subject: patternKey,
  predicate: 'rule',
  object: rule,
  confidence,
  sourceKind: 'sandbox-guard',
  sourceId: patternKey,
});
```

## 内核改动

无需修改 `AgentRuntimeService`。SandboxGuard 是独立 `@Service()`。

唯一内核相关改动：
- `SocketServerService.attachRuntimeBroadcasts()` 添加 `sandbox.*` 信号
- `KernelModule` 导入 `SandboxModule`

## 红线确认

- RxJS 完全封装在 SandboxGuard 内部，不暴露到 SignalBus ✅
- OOP class 封装所有侦查逻辑 ✅
- Signal payload 保持纯 JSON ✅
- 通过 `@Subscribe` 挂在 SignalBus ✅
- 学习到的模式持久化到 MemoryComponent ✅
- 不修改 AgentRuntimeService ✅
