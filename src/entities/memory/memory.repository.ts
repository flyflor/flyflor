import { Repo } from '@/core';
import { MemoryEntity } from './memory.entity';

/**
 * Owns SQL operations for the `memories` table.
 * The current implementation records SQL statements for the future database adapter without pretending persistence exists.
 */
@Repo()
export class MemoryRepo extends MemoryEntity {
    public readonly tableName = 'memories';

    /**
     * Produces the parameterized insert statement for one memory row.
     * `record` carries the complete row payload expected by the `memories` schema.
     */
    public insertMemory(record: MemoryEntity): { sql: string; params: string[] } {
        return {
            sql: 'INSERT INTO memories (id, scope_id, content, created_at) VALUES (?, ?, ?, ?)',
            params: [record.id, record.scopeId, record.content, record.createdAt],
        };
    }

    /**
     * Produces the parameterized select statement for a scope-local memory query.
     * `scopeId` is the explicit owner for the memory hot zone being queried.
     */
    public selectByScope(scopeId: string): { sql: string; params: string[] } {
        return {
            sql: 'SELECT id, scope_id, content, created_at FROM memories WHERE scope_id = ? ORDER BY created_at DESC',
            params: [scopeId],
        };
    }
}
