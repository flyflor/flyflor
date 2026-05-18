import {
    DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    crystalVectorCodec,
    type CrystalVectorCodec,
} from "../../fch/crystal/memory/vector.index.ts";
import type {
    GemRecord,
    GraphRecallInput,
    MemoryNodeRecord,
    SummaryEmbeddingInput,
} from "../../fch/hippocampus/memory/graph/types.ts";

export interface EpisodeRow {
    concepts_json: string;
    created_at: number;
    embedding_json: string;
    id: string;
    importance: number;
    metadata_json?: string;
    source_kind: string;
    text: string;
    user_id: string;
}

export interface MemoryNodeRow {
    confidence: number;
    contradiction_count: number;
    embedding_json: string;
    evidence_count: number;
    id: string;
    importance: number;
    last_accessed_at?: number | null;
    recall_count: number;
    scope_note?: string | null;
    summary: string;
    superseded_by?: string | null;
    symbols_json: string;
    updated_at: number;
    user_id: string;
}

export interface GemRow {
    confidence: number;
    contradiction_count: number;
    embedding_json: string;
    id: string;
    importance: number;
    last_verified_at?: number | null;
    protected: number;
    recall_count: number;
    scope_note?: string | null;
    status: string;
    summary: string;
    superseded_by?: string | null;
    support: number;
    symbols_json: string;
    updated_at: number;
    user_id: string;
}

export interface SummaryEmbeddingRow {
    bucket_key: string;
    created_at: number;
    embedding_json: string;
    id: string;
    summary_id: string;
    time_range: string;
    user_id: string;
}

export interface GemSnapshotRow {
    confidence: number;
    gem_id: string;
    id: string;
    protected: number;
    reason: string;
    summary: string;
    support: number;
    symbols_json: string;
    taken_at: number;
    updated_at: number;
    user_id: string;
}

export interface GraphEdgeRow {
    at?: number | null;
    created_at: number;
    edge: string;
    from_id: string;
    from_table: string;
    id: string;
    metadata_json?: string | null;
    score?: number | null;
    to_id: string;
    to_table: string;
    user_id?: string | null;
}

export interface MemoryEpisodeRecord {
    concepts: string[];
    createdAt: number;
    embedding: number[];
    id: string;
    importance: number;
    metadata?: Record<string, unknown>;
    sourceKind: string;
    text: string;
    userId: string;
}

export interface GraphEdgeRecord {
    at?: number;
    createdAt: number;
    edge: string;
    fromId: string;
    fromTable: string;
    id: string;
    metadata?: Record<string, unknown>;
    score?: number;
    toId: string;
    toTable: string;
    userId?: string | null;
}

export interface GemSnapshotRecord {
    confidence: number;
    gemId: string;
    id: string;
    protected: boolean;
    reason: string;
    summary: string;
    support: number;
    symbols: string[];
    takenAt: number;
    updatedAt: number;
    userId: string;
}

/**
 * Data model and scoring helper for the local crystal graph store.
 *
 * SQLiteGraphStore owns lifecycle and table writes. This class owns row
 * hydration, vector fallback and numeric scoring helpers used by recall.
 */
export class SQLiteGraphModel {
    public constructor(private readonly vectorCodec: CrystalVectorCodec = crystalVectorCodec) {}

    public rowToEpisode(row: EpisodeRow): MemoryEpisodeRecord {
        return {
            id: row.id,
            userId: row.user_id,
            text: row.text,
            concepts: this.parseJsonArray(row.concepts_json),
            embedding: this.parseJsonNumberArray(row.embedding_json),
            importance: row.importance,
            sourceKind: row.source_kind,
            createdAt: row.created_at,
            metadata: this.parseJsonRecord(row.metadata_json),
        };
    }

    public rowToMemoryNode(row: MemoryNodeRow): MemoryNodeRecord {
        return {
            id: row.id,
            userId: row.user_id,
            symbols: this.parseJsonArray(row.symbols_json),
            summary: row.summary,
            embedding: this.parseJsonNumberArray(row.embedding_json),
            confidence: row.confidence,
            evidenceCount: row.evidence_count,
            importance: row.importance,
            updatedAt: row.updated_at,
            recallCount: row.recall_count ?? 0,
            contradictionCount: row.contradiction_count ?? 0,
            lastAccessedAt: row.last_accessed_at ?? undefined,
            supersededBy: row.superseded_by ?? undefined,
            scopeNote: row.scope_note ?? undefined,
        };
    }

    public rowToGem(row: GemRow): GemRecord {
        return {
            id: row.id,
            userId: row.user_id,
            symbols: this.parseJsonArray(row.symbols_json),
            summary: row.summary,
            embedding: this.parseJsonNumberArray(row.embedding_json),
            importance: row.importance,
            confidence: row.confidence,
            support: row.support,
            protected: row.protected === 1,
            updatedAt: row.updated_at,
            recallCount: row.recall_count ?? 0,
            contradictionCount: row.contradiction_count ?? 0,
            lastVerifiedAt: row.last_verified_at ?? undefined,
            status: row.status as GemRecord["status"],
            scopeNote: row.scope_note ?? undefined,
            supersededBy: row.superseded_by ?? undefined,
        };
    }

    public rowToSummaryEmbedding(row: SummaryEmbeddingRow): SummaryEmbeddingInput {
        return {
            id: row.id,
            userId: row.user_id,
            summaryId: row.summary_id,
            timeRange: row.time_range,
            bucketKey: row.bucket_key,
            embedding: this.parseJsonNumberArray(row.embedding_json),
            createdAt: row.created_at,
        };
    }

    public rowToSnapshot(row: GemSnapshotRow): GemSnapshotRecord {
        return {
            id: row.id,
            gemId: row.gem_id,
            userId: row.user_id,
            reason: row.reason,
            takenAt: row.taken_at,
            summary: row.summary,
            symbols: this.parseJsonArray(row.symbols_json),
            confidence: row.confidence,
            support: row.support,
            protected: row.protected === 1,
            updatedAt: row.updated_at,
        };
    }

    public rowToEdge(row: GraphEdgeRow): GraphEdgeRecord {
        return {
            id: row.id,
            userId: row.user_id ?? undefined,
            fromTable: row.from_table,
            fromId: row.from_id,
            edge: row.edge,
            toTable: row.to_table,
            toId: row.to_id,
            score: row.score ?? undefined,
            at: row.at ?? undefined,
            metadata: this.parseJsonRecord(row.metadata_json),
            createdAt: row.created_at,
        };
    }

    public buildQueryEmbedding(
        input: GraphRecallInput,
        dimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    ): number[] {
        if (input.embedding && input.embedding.length > 0) {
            return input.embedding;
        }
        return this.vectorCodec.embedCrystalText(this.buildQueryText(input), dimensions);
    }

    public buildQueryText(input: GraphRecallInput): string {
        return [...(input.symbols ?? [])].filter(Boolean).join(" ");
    }

    public scoreMemoryNode(row: MemoryNodeRecord, queryEmbedding: number[], querySymbols: string[]): number {
        const textSimilarity = this.cosine(queryEmbedding, row.embedding);
        const symbolOverlap = this.overlapRatio(querySymbols, row.symbols);
        const confidence = this.clamp01(row.confidence);
        const freshness = this.freshnessScore(row.lastAccessedAt ?? row.updatedAt);
        return textSimilarity * 0.72 + symbolOverlap * 0.18 + confidence * 0.08 + freshness * 0.02;
    }

    public scoreGem(row: GemRecord, queryEmbedding: number[], querySymbols: string[]): number {
        const textSimilarity = this.cosine(queryEmbedding, row.embedding);
        const symbolOverlap = this.overlapRatio(querySymbols, row.symbols);
        const confidence = this.clamp01(row.confidence);
        const freshness = this.freshnessScore(row.lastVerifiedAt ?? row.updatedAt);
        return textSimilarity * 0.72 + symbolOverlap * 0.18 + confidence * 0.08 + freshness * 0.02;
    }

    public resolveEmbedding(input: number[], fallbackText: string, dimensions: number): number[] {
        if (Array.isArray(input) && input.length > 0) {
            return input.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
        }
        return this.vectorCodec.embedCrystalText(fallbackText, dimensions);
    }

    public normalizeRecord(value?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!value) return undefined;
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Record<
            string,
            unknown
        >;
    }

    public normalizeSymbols(symbols: string[]): string[] {
        return [...new Set(symbols.map((symbol) => symbol.toLowerCase().trim()).filter(Boolean))];
    }

    public sanitizeSymbols(symbols: string[]): string[] {
        return this.normalizeSymbols(symbols);
    }

    public cosine(left: number[], right: number[]): number {
        if (left.length === 0 || right.length === 0) return 0;
        const length = Math.max(left.length, right.length);
        let dot = 0;
        let leftNorm = 0;
        let rightNorm = 0;
        for (let index = 0; index < length; index += 1) {
            const a = left[index] ?? 0;
            const b = right[index] ?? 0;
            dot += a * b;
            leftNorm += a * a;
            rightNorm += b * b;
        }
        if (leftNorm === 0 || rightNorm === 0) return 0;
        return dot / Math.sqrt(leftNorm * rightNorm);
    }

    public clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    public clamp01(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return this.clamp(value, 0, 1);
    }

    public recallCacheKey(input: GraphRecallInput): string {
        const symbols = (input.symbols ?? []).slice().sort().join(",");
        const embFingerprint =
            input.embedding && input.embedding.length > 0
                ? `${input.embedding.length}:${input.embedding
                      .slice(0, 4)
                      .map((n) => n.toFixed(4))
                      .join(",")}`
                : "none";
        return [input.userId ?? "anon", symbols, embFingerprint, input.minConfidence ?? "any", input.limit ?? 16].join("|");
    }

    private parseJsonArray(value: string): string[] {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    }

    private parseJsonNumberArray(value: string): number[] {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed)
            ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
            : [];
    }

    private parseJsonRecord(value?: string | null): Record<string, unknown> | undefined {
        if (!value) return undefined;
        const parsed = JSON.parse(value) as unknown;
        return this.isRecord(parsed) ? parsed : undefined;
    }

    private overlapRatio(left: string[], right: string[]): number {
        if (left.length === 0 || right.length === 0) return 0;
        const rightSet = new Set(right.map((symbol) => symbol.toLowerCase()));
        const hits = left.filter((symbol) => rightSet.has(symbol)).length;
        return hits / Math.max(left.length, right.length);
    }

    private freshnessScore(updatedAt: number): number {
        const ageMs = Math.max(0, Date.now() - updatedAt);
        const ageDays = ageMs / 86_400_000;
        return 1 / (1 + ageDays);
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}

export const sqliteGraphModel = new SQLiteGraphModel();
