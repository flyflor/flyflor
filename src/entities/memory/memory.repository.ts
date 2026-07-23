import { Repo } from '@/core';
import { MemoryEntity } from './memory.entity';

/**
 * EN: Owns SQL operations for the `memories` table.
 * ZH: 负责 `memories` 表的 SQL 操作。
 *
 * EN: The current implementation records SQL statements for the future database adapter without pretending persistence exists.
 * ZH: 当前实现仅为未来的数据库适配器生成 SQL 语句，并不假装持久化已存在。
 */
@Repo()
export class MemoryRepo extends MemoryEntity {
    /** EN: Name of the table this repository operates on. ZH: 该 repository 操作的表名。 */
    public readonly tableName: string;

    constructor() {
        super();
        this.tableName = 'memories';
    }

    /**
     * EN: Produces the parameterized insert statement for one memory row.
     * ZH: 生成插入单条记忆行的参数化语句。
     *
     * EN: `record` carries the complete row payload expected by the `memories` schema.
     * ZH: `record` 携带 `memories` schema 期望的完整行数据。
     */
    public insertMemory(record: MemoryEntity): { sql: string; params: string[] } {
        return {
            sql: 'INSERT INTO memories (id, scope_id, content, created_at) VALUES (?, ?, ?, ?)',
            params: [record.id, record.scopeId, record.content, record.createdAt],
        };
    }

    /**
     * EN: Produces the parameterized select statement for a scope-local memory query.
     * ZH: 生成按 scope 查询记忆的参数化语句。
     *
     * EN: `scopeId` is the explicit owner for the memory hot zone being queried.
     * ZH: `scopeId` 是被查询记忆热区的显式属主。
     */
    public selectByScope(scopeId: string): { sql: string; params: string[] } {
        return {
            sql: 'SELECT id, scope_id, content, created_at FROM memories WHERE scope_id = ? ORDER BY created_at DESC',
            params: [scopeId],
        };
    }
}
