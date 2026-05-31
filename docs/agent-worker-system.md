# Agent Worker 系统

## 目的

多 Agent Worker 是比黑板讨论更通用的底层并发能力。用户可以配置自己的 agent profile，LLM 按需以并发/串行/队列方式启动 Worker。Worker 是独立 LLM 会话，配置过滤后的工具集和 system prompt。用于探索、讨论、调查、编码等场景。

参考：openclaw 的 Task + TaskFlow 持久化、hermes-agent 的 clarify/delegate_task 子代理模式、opencode 的子会话并发模式。

## 模块结构

```
src/worker/
  index.ts
  worker.module.ts
  worker.types.ts
  worker.service.ts          # @Service() WorkerService
  worker.profile.resolver.ts  # @Component() 从 config 解析 agent profile
```

## Agent Profile 配置

在 `.config/config.jsonc` 中新增 `agents` 段。

```jsonc
"agents": {
    "profiles": {
        "explore": {
            "description": "只读探索 agent，理解代码库结构",
            "model": null,
            "tools": ["read", "glob", "grep", "codegraph", "memory_recall"],
            "systemPrompt": "./prompts/agent-explore.md",
            "maxSteps": 12,
            "mode": "explore"
        },
        "discuss": {
            "description": "多角度讨论角色 agent",
            "model": null,
            "tools": ["memory_recall"],
            "systemPrompt": "./prompts/agent-discuss.md",
            "maxSteps": 5,
            "mode": "discuss"
        },
        "code": {
            "description": "编码执行 agent，可读写文件和执行 shell",
            "model": null,
            "tools": ["read", "write", "edit", "multi_edit", "glob", "grep", "shell", "git", "codegraph", "memory_recall", "memory_store"],
            "systemPrompt": "./prompts/agent-code.md",
            "maxSteps": 24,
            "mode": "code"
        },
        "investigate": {
            "description": "调查 agent，收集证据理解问题",
            "model": "claude-opus-4.6",
            "provider": "anthropic",
            "tools": ["read", "glob", "grep", "codegraph", "shell", "memory_recall"],
            "systemPrompt": "./prompts/agent-investigate.md",
            "maxSteps": 15,
            "mode": "investigate"
        },
        "general": {
            "description": "通用 agent，默认后备",
            "tools": ["read", "glob", "grep", "codegraph", "shell", "memory_recall"],
            "systemPrompt": "./prompts/agent-general.md",
            "maxSteps": 8,
            "mode": "general"
        }
    },
    "defaults": {
        "maxConcurrent": 4,
        "maxSteps": 8,
        "timeoutSeconds": 300
    }
}
```

## Worker 生命周期

```
                  LLM 发出 worker.spawn
                         │
                         ▼
              WorkerService 接收请求
                         │
                    ┌────┴────┐
                    │  并发？   │
                    └────┬────┘
              超过maxConcurrent│未超过
                    │         │
                排队等待       │
                    │         │
                    ▼         ▼
               Worker 启动（独立 LLM 会话）
                         │
              ┌──────────┼──────────┐
              │          │          │
           step1      step2  ...  stepN
              │          │          │
              ▼          ▼          ▼
         工具执行    工具执行    完成输出
              │          │          │
              └──────────┼──────────┘
                         ▼
              Worker 结果注入主体会话
                         │
                         ▼
              emit('worker.completed')
```

## 信号契约

### 发射

| 信号 | payload | 说明 |
|------|---------|------|
| `worker.spawn` | `{ workerId, agentProfile, prompt, parentTurnId }` | 请求启动 Worker |
| `worker.started` | `{ workerId, agentProfile, startedAt }` | Worker 已启动 |
| `worker.step` | `{ workerId, stepNumber, toolCall, result }` | 每步执行记录 |
| `worker.completed` | `{ workerId, summary, toolResults, completedAt }` | Worker 完成 |
| `worker.failed` | `{ workerId, error, failedAt }` | Worker 失败 |
| `worker.queued` | `{ workerId, position }` | Worker 排队中 |
| `worker.result.injected` | `{ parentTurnId, workerId, summary }` | 结果已注入主体 |

### 订阅

| 信号 | 用途 |
|------|------|
| `chat.message` | 不订阅——Worker 不直接响应用户输入 |
| `worker.spawn` | WorkerService 处理 spawn 请求 |
| `agent.error` | 检测主体失败，清理活跃 Worker |

## Worker 执行模型

```
WorkerService.runWorker(profile, prompt, parentContext)
  1. 解析 agent profile → 工具列表 + system prompt
  2. 构建子 context（过滤后的 tools）
  3. 调用 ModelProvider.stream() 进行独立 LLM 会话
  4. 循环：model response → parse tool calls → execute → inject results
  5. 达到 maxSteps 或 LLM 返回 stop → 返回 summary
  6. 结果注入父 conversation history
```

每个 Worker：
- **共享** MemoryComponent（读取全局热记忆）
- **隔离** BrainComponent（写入独立 worker turn 审计）
- **独立** LLM 会话上下文

## 并发控制

```typescript
class WorkerService {
  private activeWorkers = 0;
  private readonly queue: WorkerRequest[] = [];

  async handleSpawn(payload: WorkerSpawnPayload): Promise<void> {
    if (this.activeWorkers >= this.config.agents.defaults.maxConcurrent) {
      this.queue.push(payload);
      this.signalBus.emit('worker.queued', { workerId: payload.workerId, position: this.queue.length });
      return;
    }
    this.activeWorkers++;
    try {
      await this.runWorker(payload);
    } finally {
      this.activeWorkers--;
      this.drainQueue();
    }
  }
}
```

## 工具可见性

Worker 只暴露其 profile.tools 中声明的工具。WorkerService 调用 `ToolRegistry.list().filter(tool => profile.tools.includes(tool.name))` 构建子工具集。

## 结果流回主体

Worker 完成后：
1. BrainComponent.recordEvent('worker.completed', { workerId, summary })
2. MemoryComponent.store({ sourceKind: 'worker', content: summary })
3. SignalBus.emit('worker.result.injected', { parentTurnId, summary })
4. Worker 摘要作为 system message 注入主体 conversation

## 内核改动

`AgentRuntimeService` 无需改动。WorkerService 是独立的 `@Service()`。

唯一内核相关改动：
- `SocketServerService.attachRuntimeBroadcasts()` 添加 `worker.*` 信号
- `KernelModule` 导入 `WorkerModule`

## 红线确认

- OOP class 封装 Worker 逻辑 ✅
- Worker 执行通过 SignalBus 事件驱动 ✅
- 工具过滤复用 ToolRegistry ✅
- Brain audit 记录每个 Worker turn ✅
- Memory recall 可被 Worker 读取 ✅
- 不创建 root-level 文件结构（代码在 `src/worker/` 下） ✅
- 配置路径全部相对项目根 ✅
