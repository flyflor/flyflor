import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { FRepo, Repo } from '@/core';
import { LEDGER_INSERT_SQL, LEDGER_PRAGMA_SQL, LEDGER_SCHEMA_SQL, LEDGER_SCHEMA_VERSION } from './schema';
import type { LedgerEvent, LedgerShardKey } from './types';

/**
 * EN: Maximum simultaneously open shard handles: the hot current month plus one straggler month.
 * ZH: 同时打开的句柄上限：当月热分片加一个迟到事件所属的分片。
 */
const LEDGER_HANDLE_LIMIT = 2;

type LedgerInsertStatement = ReturnType<Database['prepare']>;

/**
 * EN: One open monthly shard: the database plus its cached append statement.
 * ZH: 一个打开的月度分片：数据库及其缓存的追加语句。
 */
interface LedgerShardHandle {
    db: Database;
    insert: LedgerInsertStatement;
}

/**
 * EN: Append-only owner of every ledger shard handle. It is the only class that touches `bun:sqlite`.
 * Events are routed into monthly database files by their own timestamps; a shard is sealed
 * (checkpointed and closed) as soon as it falls out of the hot window.
 * ZH: 所有账本分片句柄的只增 owner，也是唯一接触 `bun:sqlite` 的类。
 * 事件按自身时间戳路由进月度数据库文件；分片一旦滑出热窗口即被封存（checkpoint 后关闭）。
 */
@Repo()
export class LedgerRepository extends FRepo {
    private directory?: string;
    private readonly handles = new Map<LedgerShardKey, LedgerShardHandle>();

    /**
     * EN: Opens the ledger directory and eagerly creates the current month's shard. Relative
     * directories resolve against the process cwd so compiled binaries behave like dev runs.
     * Throws on any filesystem or database error: boot must fail loudly instead of running unrecorded.
     * ZH: 打开账本目录并立即创建当月分片。相对目录按进程 cwd 解析，使编译后的二进制与开发运行一致。
     * 任何文件系统或数据库错误都会抛出：启动必须响亮失败，而不是静默运行不记账。
     */
    public open(directory: string): void {
        if (this.directory !== undefined) return;
        this.directory = isAbsolute(directory) ? directory : resolve(process.cwd(), directory);
        mkdirSync(this.directory, { recursive: true });
        this.ensure(this.monthOf(Date.now()));
    }

    /**
     * EN: Appends one verbatim event into its monthly shard.
     * ZH: 把一条逐字事件追加进它所属的月度分片。
     */
    public insert(event: LedgerEvent): void {
        const handle = this.ensure(this.monthOf(event.createdAt));
        handle.insert.run(
            event.id,
            event.kind,
            event.createdAt,
            event.focusId ?? null,
            event.messageId ?? null,
            event.speakerId ?? null,
            event.payload,
        );
    }

    /**
     * EN: Seals one shard: stamps `sealed_at`, truncates the WAL, and closes the handle.
     * ZH: 封存一个分片：写入 `sealed_at`，截断 WAL，并关闭句柄。
     */
    public seal(month: LedgerShardKey): void {
        const handle = this.handles.get(month);
        if (!handle) return;
        this.handles.delete(month);
        handle.db.query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('sealed_at', String(Date.now()));
        handle.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        handle.db.close();
    }

    /**
     * EN: Seals every open shard and releases the directory.
     * ZH: 封存所有打开的分片并释放目录。
     */
    public close(): void {
        for (const month of [...this.handles.keys()]) this.seal(month);
        this.directory = undefined;
    }

    /**
     * EN: Returns the open handle for one month, creating the shard file on first touch.
     * ZH: 返回某月已打开的句柄；首次触达时创建分片文件。
     */
    private ensure(month: LedgerShardKey): LedgerShardHandle {
        const existing = this.handles.get(month);
        if (existing) return existing;
        if (this.directory === undefined) throw Error('Ledger repository is not open');
        const handle = this.createHandle(join(this.directory, `ledger-${month}.db`), month);
        this.handles.set(month, handle);
        if (this.handles.size > LEDGER_HANDLE_LIMIT) {
            const current = this.monthOf(Date.now());
            const keys = [...this.handles.keys()];
            const victim = keys.find((key) => key !== month && key !== current) ?? keys.find((key) => key !== month);
            if (victim !== undefined) this.seal(victim);
        }
        return handle;
    }

    /**
     * EN: Creates one shard handle and guarantees its schema and meta rows exist.
     * ZH: 创建一个分片句柄，并保证其 schema 与 meta 行存在。
     */
    private createHandle(path: string, month: LedgerShardKey): LedgerShardHandle {
        const db = new Database(path);
        db.exec(LEDGER_PRAGMA_SQL);
        db.exec(LEDGER_SCHEMA_SQL);
        db.query('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', LEDGER_SCHEMA_VERSION);
        db.query('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('shard', month);
        return { db, insert: db.prepare(LEDGER_INSERT_SQL) };
    }

    /**
     * EN: Derives the local-time `YYYY-MM` shard key for one event timestamp.
     * ZH: 为单个事件时间戳推导本地时间的 `YYYY-MM` 分片键。
     */
    private monthOf(timestamp: number): LedgerShardKey {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
}
