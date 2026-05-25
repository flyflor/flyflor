# Blackboard

## 定位

Blackboard 是复杂任务的当前 turn deliberation workspace。它不是 session store，不是隐藏 memory bucket，也不是 transport continuity owner。

当前代码 owner：

- `src/agent/blackboard/module.ts`
- `src/agent/blackboard/store.ts`
- `src/agent/worker/blackboard.ts`
- `src/agent/runtime/blackboard/route.ts`
- `src/agent/runtime/blackboard/output.ts`

## Runtime 职责

`RuntimeBlackboardRouteComponent` 判断当前 turn 是否使用 Blackboard。它消费结构化 context、配置限制和模型 route output，不能依赖关键词匹配。

Blackboard 运行时：

1. Runtime 已经装配当前输入、Memory、Crystal、显式 Scope/Fork 和 Executive visible capabilities。
2. Blackboard workers 在该已装备 context 中讨论。
3. Normalized Blackboard store 记录 participants、notes、decisions 和 detail references。
4. Runtime 通过 `RuntimeBlackboardOutputComponent` 投影结果。
5. 如果结果不能安全收敛，Runtime 返回 ASK。

## 边界

Blackboard 可以：

- 保存当前 turn 的结构化 deliberation
- fan out 到已配置 workers
- 将 detail 写入 ledger/query plane
- 发出 RuntimeEvents
- 返回 synthesized result 或 ASK

Blackboard 不可以：

- 从 conversation/thread/user metadata 推断 active scope
- 绕过 Executive 直接执行工具
- 不经过 runtime 的 Memory 侧写长期记忆
- 成为 raw history 的 prompt 容器
- 绕过 sandbox/approval/audit gates

## ASK 交还

ASK 是安全上限。Worker discussion 命中限制、矛盾或缺少用户决策时，Blackboard 将状态交还为 `AgentAsk`，而不是伪造确定性。

ASK answer 后续可以成为 Memory 和 Crystal 的 evidence，但必须通过结构化 runtime persistence。

## 查询面

Blackboard detail 通过 `src/socket/query/blackboard.reader.ts` 等 socket query/read-model 路径暴露。实时变化走 events；历史/detail 检查读取 ledger/query plane。

## 测试

相关覆盖：

- `tests/blackboard.boundaries.test.ts`
- `tests/blackboard.worker.thread.test.ts`
- `tests/gateway.ws.test.ts`
