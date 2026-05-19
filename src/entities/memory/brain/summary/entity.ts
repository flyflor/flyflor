import type { MemorySummaryRecord, SummaryRange } from "../../../../protocol/contracts/index.ts";

export interface BrainSummaryRow {
    bucket_key: string;
    content: string;
    created_at: number;
    embedding_id: string | null;
    id: string;
    time_range: string;
}

/**
 * Data model mapper for `memory_summary`.
 */
export class BrainSummaryModel {
    public toRecord(row: BrainSummaryRow): MemorySummaryRecord {
        return {
            id: row.id,
            timeRange: row.time_range as SummaryRange,
            bucketKey: row.bucket_key,
            content: row.content,
            embeddingId: row.embedding_id ?? undefined,
            createdAt: row.created_at,
        };
    }
}

export const brainSummaryModel = new BrainSummaryModel();
