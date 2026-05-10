# Flyflor Session 压力测试报告

<!-- prettier-ignore-start -->

生成时间：2026-05-09T19:42:12.856Z

## 测试范围

本报告专门验证 `src/agent/session` 边界和 SQLite session 存储：session key 隔离、timeline 顺序、live context、history 固化、凭据脱敏和响应延迟。

## 压测规模

| 项目                     | 数值      |
| ---------------------- | ------- |
| session 数              | 12      |
| 每个 session turn 数      | 60      |
| 总 turn 数               | 720     |
| 总 session message 数    | 1440    |
| maxLiveMessages        | 20      |
| consolidationBatchSize | 10      |
| maxPromptMessages      | 12      |
| 总耗时 ms                 | 653.958 |

## Session 汇总

| Session Key                      | Total | Live | History | Last Consolidated | Min Recent Seq | Max Seq |
| -------------------------------- | ----- | ---- | ------- | ----------------- | -------------- | ------- |
| stdio:account-a:chat-0:thread-0  | 120   | 20   | 10      | 100               | 109            | 120     |
| webhook:account-b:chat-1         | 120   | 20   | 10      | 100               | 109            | 120     |
| stdio:chat-2:thread-2            | 120   | 20   | 10      | 100               | 109            | 120     |
| webhook:account-a:chat-3         | 120   | 20   | 10      | 100               | 109            | 120     |
| stdio:account-b:chat-0:thread-4  | 120   | 20   | 10      | 100               | 109            | 120     |
| webhook:chat-1                   | 120   | 20   | 10      | 100               | 109            | 120     |
| stdio:account-a:chat-2:thread-6  | 120   | 20   | 10      | 100               | 109            | 120     |
| webhook:account-b:chat-3         | 120   | 20   | 10      | 100               | 109            | 120     |
| stdio:chat-0:thread-8            | 120   | 20   | 10      | 100               | 109            | 120     |
| webhook:account-a:chat-1         | 120   | 20   | 10      | 100               | 109            | 120     |
| stdio:account-b:chat-2:thread-10 | 120   | 20   | 10      | 100               | 109            | 120     |
| webhook:chat-3                   | 120   | 20   | 10      | 100               | 109            | 120     |

## 延迟统计

| 路径          | Avg ms | P50 ms | P95 ms | Max ms |
| ----------- | ------ | ------ | ------ | ------ |
| recordTurn  | 0.622  | 0.423  | 1.234  | 23.501 |
| consolidate | 0.228  | 0.058  | 0.946  | 6.426  |
| timeline    | 0.542  | 0.461  | 0.840  | 0.960  |
| recent      | 0.172  | 0.101  | 0.442  | 0.550  |

## 红线检查

- 红线失败数：0

## 人工复核命令

如果需要保留本次临时数据库供人工查看，请使用 `--keep` 重新运行：

```bash
bun run test:session:stress -- --sessions 12 --turns 60 --keep
bun run inspect:sessions -- --db /var/folders/n5/wyt93n392vd8w49l3h8yz30r0000gp/T/flyflor-session-stress-w6c7xH/data/memory/memory.sqlite --limit 20
bun run inspect:sessions -- --db /var/folders/n5/wyt93n392vd8w49l3h8yz30r0000gp/T/flyflor-session-stress-w6c7xH/data/memory/memory.sqlite --session stdio:account-a:chat-0:thread-0 --limit 30
```

人工重点看：

- `total` 必须等于 `turns * 2`。
- `live` 必须小于等于 `maxLiveMessages`。
- `sequence` 必须连续递增。
- 同一个 session 的消息只包含自己的 `SESSION_MARKER_xx`。
- 第一条 session 的 raw token 不应出现，只应看到 `[redacted-api-key]` 和 `[redacted-token]`。

<!-- prettier-ignore-end -->
