import type { Database } from "bun:sqlite";
import type { MemoryLinkRecord, MemoryLinkType } from "../../../../protocol/contracts/index.ts";
import { allQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainLinkModel, type BrainLinkRow } from "./entity.ts";

/**
 * Repo for `memory_links`.
 *
 * Links are explicit evidence edges between event ids. This layer stores and
 * filters structured edge fields only; contradiction/derivation semantics stay
 * in callers that already have model-produced protocol payloads.
 */
export class BrainLinkRepo {
    public constructor(private readonly db: Database) {}

    public write(record: MemoryLinkRecord): void {
        runQuery(
            this.db,
            query`INSERT OR REPLACE INTO memory_links (id, from_id, to_id, strength, type, created_at)
                VALUES (${record.id}, ${record.fromId}, ${record.toId}, ${record.strength}, ${record.type}, ${record.createdAt})`,
        );
    }

    public list(input: { fromId?: string; limit?: number; toId?: string; type?: MemoryLinkType } = {}): MemoryLinkRecord[] {
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const fromId = input.fromId ?? null;
        const toId = input.toId ?? null;
        const type = input.type ?? null;
        const rows = allQuery<BrainLinkRow>(
            this.db,
            query`SELECT * FROM memory_links
                WHERE (${fromId} IS NULL OR from_id = ${fromId})
                  AND (${toId} IS NULL OR to_id = ${toId})
                  AND (${type} IS NULL OR type = ${type})
                ORDER BY created_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainLinkModel.toRecord(row));
    }
}
