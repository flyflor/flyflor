# Awareness:无 Session 多连接注意机制

状态:设计已确认,实现进行中。

Flyflor 是一个生命体,不是请求/响应服务器。多个人可以通过各自独立的 IPC
连接同时对它说话。没有 session:一条连接**就是**一个说话人(`conn_N`)。
连接关闭等于这个人走开了;只有沉淀进 Context 的 summary 留下。

## 生物学映射

| 生物学结构 | 功能 | Flyflor 对象 |
| --- | --- | --- |
| 耳蜗/听觉神经 | 每个说话人独立声道 | `FSocket` 连接注册表,每条 socket 一个 `Connection` |
| 丘脑 | 感觉门控:所有刺激先经丘脑中继才进皮层 | `Awareness`(新增):刺激收件箱 + 注意门控 |
| 网状激活系统 | 显著性:被点名、危险、 awaited 回答天然高亮 | Awareness 显著性评分 |
| 前注意加工 | 廉价并行地判断"这和我正在想的事有关吗" | LLM 调度调用(类似 `Callosum.route`) |
| 全局工作空间理论 | 同一时刻只有一个意识内容;无数无意识处理器并行 | 单一注意焦点 turn + 后台 worker |
| 言语通道 | 嘴只有一张,说话严格串行 | Mouth lock:同一时刻只有一个 turn 在流式输出 |
| 记忆再巩固 | 被打断时保留可用部分,重新整合后再想 | 打断 = 部分结算 + 合并重想 |
| 朝向反射 | 紧急刺激抢占注意 | 抢占 (preempt) |

## 核心原则:LLM 即调度者

调度决策**不是**硬编码规则矩阵。Awareness 把整个局面——我在想什么、谁在
等我、等的是什么——交给 LLM 判断,就像人扫一眼围着自己的人,决定先理谁、
谁的问题和手头的是同一件事、谁必须马上回应。

调度输入(`prompts/awareness/SCHEDULE.md`):

- 所有 working turns 的 brief(goal、intent、思考进度、partial)
- 所有待处理 Stimulus(speakerId、文本、等待时长、是否追问)
- pending interactions(我在等谁的回答)

调度输出(一次性批量判决所有刺激):

```json
{ "dispositions": [{
  "stimulusId": "stim_3",
  "action": "merge | queue | concurrent | preempt | answer-first",
  "targetTurnId": "turn_2",
  "queueAfter": "turn_2",
  "priority": 1,
  "rationale": "同一说话人的追问,同一线程,紧随其后"
}]}
```

判决语义(生物先验写进 prompt,决策权归模型):

- `merge`:同一说话人、同一线程的追问 → 并入该线程,保持同 speaker 有序。
- `queue`:语义相关的思考共用工作记忆会互相干扰 → 串行排队,可指定排在
  哪个 turn 后。
- `concurrent`:无关的事 → 后台 worker 并行思考,结果排队等嘴。
- `preempt`:紧急/否定当前方向("别做了""不对") → 打断重想(再巩固流程)。
- `answer-first`:手头事先放一放,先回答这个。

确定性捷径(不经 LLM,控制成本):

- pending ask/confirm 的 answer → 永远直通。
- 无 working turn 且队列只有一条 → 直接处理。
- 调度触发点:新刺激到达、turn settled、turn interrupted;200ms 批处理
  窗口合并连续刺激。
- LLM 调度失败/超时 → 降级为 FIFO。

## 打断即再巩固

1. Brain 流式循环在 chunk 间隙(`Brain.reply` 流式回调)和工具循环迭代
   间隙(`Investigation.run`)检查 `awareness.preempted(turnId)`。
2. 命中后停止流;把已产出的部分回答 + evidence + 未完成事项部分结算进
   Context(`status: 'interrupted'`,partial summary)。
3. Awareness 把 partial summary 加新刺激合并成同一线程的新 TurnDraft 重新
   ingest —— 像人想了一半被打断,把结论捋一遍,带着新信息重新想。
4. 被打断 turn 的半截话不广播;mouth 向该连接发 `interrupted` 事件。

## 改造清单(按依赖顺序)

| # | 层 | 文件 | 改动 |
| --- | --- | --- | --- |
| 1 | 感官 | `src/neural/ipc/connection.ts`(新) | `Connection`:speakerId、独立 buffer、独立 pending 队列 |
| 2 | 感官 | `src/neural/ipc/packet.ts` | `IPCPacket` 去状态化,buffer 由 `Connection` 持有 |
| 3 | 感官 | `src/neural/ipc/socket.ts` | `FSocket` 改为注册表;入站包变成 Stimulus 交给 Awareness;`write(speakerId, packet)` 寻址 |
| 4 | 注意 | `src/neural/awareness/`(新:service/types/index) | `Awareness extends FService`:per-speaker lanes、调度循环、mouth lock、preempt 标志表、LLM 调度 + FIFO 降级 |
| 5 | 注意 | `prompts/awareness/*.md` + `.zh.cn.md` | SCHEDULE prompt(生物先验) |
| 6 | 记忆 | `src/agent/context/component.ts`、`types.ts` | Turn 加 `speakerId`;status 加 `'interrupted'`;`begin` 不变量放宽为每线程唯一 working;新增 `interrupt()` 部分结算和 `merge()` |
| 7 | 思考 | `src/agent/brain/brain.ts`、`investigation/service.ts` | chunk/迭代间隙抢占检查、上交 partial;ingest 带 speaker 视角 |
| 8 | 皮层 | `src/neural/synapse.ts` | `input` 由 Awareness 驱动;`output` 按 turn→speakerId 寻址;`interaction` 改 `Map<turnId, pending>`;无关刺激走 `spawnWorker` 后台思考 |
| 9 | 配置 | `.config/config.jsonc` | `awareness: { maxConcurrentThoughts, scheduleTimeoutMs, batchWindowMs }` |
| 10 | 测试 | 各层 `*.test.ts` | 多连接隔离、判决动作矩阵、answer 直通、mouth 串行、interrupt/merge、流式抢占;门槛:`bun run check` + `bun test` |

## 红线

- 无 session:身份 = connectionId;断连即遗忘;只有 Context summary 持久。
- 调度只归 Awareness;Context 不做调度。
- `index.ts` 只做 barrel。
- 回复只写回提问连接(私聊语义,不广播)。
