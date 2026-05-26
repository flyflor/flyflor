# 黑板

## 定位

Blackboard 是复杂任务的当前轮 deliberation workspace。它不是 session store、隐藏 memory bucket、tool executor，也不是 transport continuity owner。

代码 owner：

- `src/agent/blackboard/module.ts`
- `src/agent/blackboard/store.ts`
- `src/agent/worker/blackboard.ts`
- `src/agent/runtime/blackboard/route.ts`
- `src/agent/runtime/blackboard/output.ts`

## 路由

`RuntimeBlackboardRouteComponent` 决定当前 turn 是否使用 Blackboard。它消费结构化 context、配置限制、route history、pressure signals 和模型 route output。它不能依赖关键词匹配。

Route output 的含义：

- direct：走普通 runtime path 回答。
- direct-with-watch：直接回答，同时保留 route evidence。
- blackboard：在当前 equipped context 下启动 worker deliberation。
- ask：无法安全选择 route 时停下来问用户。

## Runtime 作用

Blackboard 运行时：

1. Runtime 已经装配 current input、constitution、Memory、Crystal、显式 Scope/Fork 和 Executive visible capabilities。
2. Blackboard workers 在这个 equipped context 内 deliberation。
3. Normalized Blackboard store 记录 participants、notes、decisions、leases 和 detail references。
4. Runtime 通过 `RuntimeBlackboardOutputComponent` 把结果投影回主链。
5. 如果结果不能安全收敛，Runtime 返回 ASK。

## 边界

Blackboard 可以：

- 保存当前轮 structured deliberation
- fan out 到配置的 workers
- 把 detail 保存到 ledger/query plane
- 发出 RuntimeEvents
- 返回 synthesized result 或 ASK

Blackboard 不可以：

- 从 conversation/thread/user/client metadata 推断 active scope
- 绕过 Executive 直接执行工具
- 不经过 Memory runtime 侧就写长期记忆
- 成为 raw history 的 prompt container
- 绕过 sandbox/approval/audit gates
- 变成 CLI-local state machine

## ASK 交还

ASK 是安全上限。Worker discussion 遇到 limit、contradiction、lease conflict 或缺用户决策时，Blackboard 必须把状态作为 `AgentAsk` 交还，而不是虚构确定性。

ASK answer 之后可以成为 Memory 和 Crystal 的 evidence，但只能通过结构化 runtime persistence。

## CLI 可见性

`flyflor-cli` 只能通过公开 surface 渲染 Blackboard：

- `turn.final` 上的 metadata
- read-model query 返回的 `blackboard.snapshot`
- 通过 `event.subscribe` 订阅的稳定 `blackboard.*` RuntimeEvents
- 通过 `blackboard.detail.get` 刷新的 detail

CLI 可以在 Run timeline 展示过程，但不能本地调度 worker 或决定 convergence。

## Query Surface

Blackboard detail 通过 `src/socket/query/blackboard.reader.ts` 等 socket query/read-model 路径暴露。实时变化通过 events 暴露；历史/detail 检查读取 ledger/query plane。

## Tests

相关覆盖：

- `tests/blackboard.boundaries.test.ts`
- `tests/blackboard.worker.thread.test.ts`
- `tests/gateway.ws.test.ts`
