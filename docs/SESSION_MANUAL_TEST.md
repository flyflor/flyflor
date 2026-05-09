# Session 人工验证方法

本文档用于人工复核 Flyflor session 边界。自动压测报告见 [SESSION_STRESS_REPORT.md](./SESSION_STRESS_REPORT.md)。

## 方法一：可复现压测数据库

使用固定临时目录保留压测数据库：

```bash
rm -rf /tmp/flyflor-session-manual
bun run test:session:stress -- --root /tmp/flyflor-session-manual --sessions 4 --turns 12 --keep
```

查看 session 列表：

```bash
bun run inspect:sessions -- --db /tmp/flyflor-session-manual/data/memory/memory.sqlite --limit 20
```

预期：

- 有 4 个 session。
- 每个 session 的 `total` 是 `24`，因为 `12 turns * 2 messages`。
- 每个 session 的 `live` 不超过 `20`。

查看第一条 session 的 timeline：

```bash
bun run inspect:sessions -- --db /tmp/flyflor-session-manual/data/memory/memory.sqlite --session stdio:account-a:chat-0:thread-0 --limit 40
```

人工重点检查：

- `sequence` 从 `1` 到 `24` 连续递增。
- 内容只出现 `SESSION_MARKER_00`，不应出现 `SESSION_MARKER_01`、`SESSION_MARKER_02` 等其他 session marker。
- 原始 `sk-...` 和 JWT 不应出现，应看到 `[redacted-api-key]` 和 `[redacted-token]`。

查看另一条 session，确认隔离：

```bash
bun run inspect:sessions -- --db /tmp/flyflor-session-manual/data/memory/memory.sqlite --session webhook:account-b:chat-1 --limit 40
```

预期只出现 `SESSION_MARKER_01`。

## 方法二：Docker Chat 真实续接

可选：清空 Docker dev session 数据，避免旧记录干扰：

```bash
rm -rf docker/storage/flyflor/memory
```

启动 Docker dev：

```bash
bun run docker:dev
docker exec -it flyflor-dev flyflor
```

输入：

```text
session人工验证-001：这句话只应该属于 stdio:human-local。
临时密钥 sk-1234567890abcdefghijkl 和 jwt abcdefghijklmnopqrstuvwx.abcdef.abcdefghijklmnopqrstuvwx 只用于测试脱敏。
/exit
```

查看 Docker dev session：

```bash
bun run inspect:sessions -- --db docker/storage/flyflor/memory/memory.sqlite --limit 20
bun run inspect:sessions -- --db docker/storage/flyflor/memory/memory.sqlite --session stdio:human-local --limit 20
```

预期：

- session key 是 `stdio:human-local`。
- timeline 里包含人工输入和助手回复。
- 原始密钥不出现，只出现脱敏占位。

再次进入 chat：

```bash
docker exec -it flyflor-dev flyflor
```

输入：

```text
刚才的 session人工验证-001 是什么？
/exit
```

然后再次 inspect：

```bash
bun run inspect:sessions -- --db docker/storage/flyflor/memory/memory.sqlite --session stdio:human-local --limit 40
```

预期：

- 新消息追加到同一个 `stdio:human-local`。
- `sequence` 继续递增，不从 1 重新开始。
- 最近会话上下文可以被下一轮模型看到；如果 provider 网络失败或 mock 回复不复述，以 SQLite timeline 为准检查续接是否成功。

## 红线

- 不同 `channel/accountId/chatId/threadId` 的 session 不得串线。
- session 只能保证会话连续性，不等于长期记忆晋升。
- 临时 token、API key、JWT 必须在 session timeline 中脱敏。
- `live` 必须被 `maxLiveMessages` 约束，旧消息应固化为 history。
