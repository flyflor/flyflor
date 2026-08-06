/**
 * EN: Ledger schema version stored in each shard's `meta` table.
 * ZH: 写入每个分片 `meta` 表的账本 schema 版本号。
 */
export const LEDGER_SCHEMA_VERSION = '1';

/**
 * EN: Shard bootstrap pragma statements.
 * ZH: 分片初始化 pragma 语句。
 */
export const LEDGER_PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
`;

/**
 * EN: Shard schema statements. Kept as a TS string constant so compiled single-file binaries never
 * read SQL from disk at runtime (the bunfs virtual root has no real filesystem counterpart).
 * ZH: 分片建表语句。以 TS 字符串常量保存，编译成单文件二进制后运行时不需要从磁盘读 SQL
 * （bunfs 虚拟根在真实文件系统上没有对应物）。
 */
export const LEDGER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    focus_id TEXT,
    message_id TEXT,
    speaker_id TEXT,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_events_focus ON events(focus_id);
CREATE INDEX IF NOT EXISTS idx_events_message ON events(message_id);
`;

/**
 * EN: Append statement for one ledger event. Positional parameters keep binding unambiguous.
 * ZH: 追加单条账本事件的语句。位置参数让绑定没有歧义。
 */
export const LEDGER_INSERT_SQL = `
INSERT INTO events (id, kind, created_at, focus_id, message_id, speaker_id, payload)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;
