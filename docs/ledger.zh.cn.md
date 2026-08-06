# 生命账本

生命账本是 Flyflor 对所有对话的永久、逐字、只增记录。它刻意区别于易失的进程内 `History`：
落账的内容永远不会被压缩、折叠、摘要或淘汰。记忆召回、压缩和向量索引明确不属于账本自身的范围。

## 存储布局

```
<cwd>/.ledger/
  ledger-2026-08.db      # 当月热分片（WAL）
  ledger-2026-07.db      # 已封存的冷分片
```

- 每个自然月一个 SQLite 数据库，按事件自身的本地时间 `YYYY-MM` 分片。
- 每条事件携带 epoch 毫秒 `created_at`，跨分片排序始终精确。
- 迟到事件（例如跨零点才完成的轮次）会路由进其时间戳所属的分片。最多同时持有两个分片句柄：
  当月分片加一个迟到分片。
- 封存分片会写入 `meta.sealed_at`，执行 `PRAGMA wal_checkpoint(TRUNCATE)`，然后关闭句柄。
  已封存的分片是自包含文件，未来的冷层可以直接 gzip 或迁走。
- 目录默认 `./.ledger`，按进程 cwd 解析，绝不使用 `__dirname`，因此编译后的单文件二进制与
  开发运行行为一致。可用 `.config/config.jsonc` 的 `ledger.directory` 覆盖；
  `ledger.enabled: false` 可关闭账本。

## Schema（每个分片一致，`meta.schema_version = 1`）

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  focus_id    TEXT,
  message_id  TEXT,
  speaker_id  TEXT,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_events_focus   ON events(focus_id);
CREATE INDEX IF NOT EXISTS idx_events_message ON events(message_id);
```

分片 pragma：`journal_mode = WAL`、`synchronous = NORMAL`。schema 以 TypeScript 字符串常量的形式
放在 `src/ledger/schema.ts`；运行时绝不从磁盘读取 `.sql` 文件，保证 `bun build --compile`
产出的二进制完全自包含。

## 记录的事件

| kind          | 挂钩点                                   | payload                                        |
| ------------- | ---------------------------------------- | ---------------------------------------------- |
| `stimulus`    | `AgentManager.accept()` 去重通过之后     | 完整 `Stimulus`，含只进到队列的输入            |
| `turn`        | `Context.complete()` 在 `History.record` 之前 | `{ focus, report }`，逐字未压缩            |
| `interaction` | `AgentManager.answer()`                  | ask/confirm 往返的 `{ request, response }`     |
| `cancellation`| `AgentManager.cancel()`                  | `{ focusId, revision, speakerId }`             |
| `agent_event` | `AgentManager.forwardAgentEvent()`       | 完整 `AgentRuntimeEvent`（工具动作）           |

不记录：流式 chunk（与最终答复重复）和被拒绝的重复 messageId（传输重试噪音）。

## 失败策略

- 启动时：账本目录建不了或热分片打不开，启动直接抛错。进程绝不静默裸奔、不记账运行。
- 运行时：单次写入失败只记日志（`ledger.record.failed`）并吞掉；账本绝不打断对话。

## 二进制与交叉编译安全

- 账本只使用 `bun:sqlite`，它静态编译在 Bun 运行时本体中。这条链路没有任何 `.node` 原生插件，
  因此 `bun build --compile --target=...` 交叉编译不受影响。
- `pakcages/sqlite-vec`（各平台原生二进制）刻意不进账本链路。
- 数据库路径派生自 `process.cwd()`；账本代码不按 `__dirname` 相对读文件——编译后的二进制里
  `__dirname` 指向虚拟 bunfs 根。

## 代码地图

- `src/ledger/component.ts` — `Ledger`，领域 API（`recordStimulus`、`recordTurn`、
  `recordInteraction`、`recordCancellation`、`recordAgentEvent`）。
- `src/ledger/repository.ts` — `LedgerRepository`，唯一接触 `bun:sqlite` 的类；
  持有分片句柄、schema 初始化、追加、封存与关闭。
- `src/ledger/schema.ts` — schema、pragma 与插入 SQL 常量。
- `src/ledger/types.ts` — 事件类型与 `LedgerEvent` 封套。
