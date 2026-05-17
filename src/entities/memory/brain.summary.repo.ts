import type { Database } from "bun:sqlite";
import type { MemorySummaryRecord, SummaryRange } from "../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../components/sql/index.ts";
import { brainSummaryModel, type BrainSummaryRow } from "./index.ts";

/**
 * Repo for `memory_summary`.
 *
 * Summary rows are cold-ish recall indexes for day/week/rolling context. The
 * repo owns SQL and row mapping only; summary generation stays in neural memory
 * workers so persistence does not learn business semantics.
 */
export class BrainSummaryRepo {
    public constructor(private readonly db: Database) {}

    public write(record: MemorySummaryRecord): void {
        runQuery(
            this.db,
            query`INSERT INTO memory_summary (id, time_range, bucket_key, content, embedding_id, created_at)
             VALUES (${record.id}, ${record.timeRange}, ${record.bucketKey}, ${record.content}, ${record.embeddingId ?? null}, ${record.createdAt})
             ON CONFLICT(id) DO UPDATE SET
                time_range = excluded.time_range,
                bucket_key = excluded.bucket_key,
                content = excluded.content,
                embedding_id = excluded.embedding_id,
                created_at = excluded.created_at`,
        );
    }

    public get(id: string): MemorySummaryRecord | null {
        const row = getQuery<BrainSummaryRow>(this.db, query`SELECT * FROM memory_summary WHERE id = ${id}`);
        return row ? brainSummaryModel.toRecord(row) : null;
    }

    public list(input: { limit?: number; timeRange?: SummaryRange } = {}): MemorySummaryRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const timeRange = input.timeRange ?? null;
        const rows = allQuery<BrainSummaryRow>(
            this.db,
            query`SELECT * FROM memory_summary
                WHERE (${timeRange} IS NULL OR time_range = ${timeRange})
                ORDER BY created_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainSummaryModel.toRecord(row));
    }
}
