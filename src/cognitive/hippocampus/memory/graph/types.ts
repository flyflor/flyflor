/**
 * 长期记忆图公共契约。
 *
 * 当前运行时默认由 `SQLiteGraphStore` 实现，落地到本地 `crystal.db`。
 * 本文件只定义图能力边界和 JSON-safe record 形状，不绑定任何外部数据库协议。
 */

export interface MemoryGraphStore {
    initialize(): Promise<void>;
    upsertEpisode(input: EpisodeNodeInput): Promise<void>;
    upsertMemoryNode(input: MemoryNodeInput): Promise<void>;
    upsertGem(input: GemNodeInput): Promise<void>;
    upsertSummaryEmbedding(input: SummaryEmbeddingInput): Promise<void>;
    applyDecaySweep(input: DecaySweepInput): Promise<DecaySweepResult>;
    relateNextContext(prev: string, curr: string): Promise<void>;
    relateSimilarEpisode(a: string, b: string, score: number): Promise<void>;
    relateConsolidatedInto(episodeId: string, memoryNodeId: string): Promise<void>;
    relateSimilarConcept(a: string, b: string, score: number): Promise<void>;
    relateProvenAs(memoryNodeId: string, gemId: string): Promise<void>;
    relateProvenBy(gemId: string, episodeId: string): Promise<void>;
    recallMemoryNodes(input: GraphRecallInput): Promise<MemoryNodeRecord[]>;
    recallSkills(input: GraphRecallInput): Promise<GemRecord[]>;
    expandSimilarConcept(seedIds: string[], limit: number): Promise<MemoryNodeRecord[]>;
    countByOwner(ownerKey: string): Promise<GraphCounts>;
    listGemDriftCandidates(input: {
        ownerKey: string;
        nowMs: number;
        minContradictionCount: number;
        maxStaleMs: number;
        maxConfidence: number;
        limit: number;
    }): Promise<GemRecord[]>;
    listRecallExtremes(input: {
        ownerKey: string;
        topN: number;
        bottomN: number;
    }): Promise<{ tops: MemoryNodeRecord[]; bottoms: MemoryNodeRecord[] }>;
    listContradictionPairs(input: {
        ownerKey: string;
        seedN: number;
        neighborK: number;
        minCosine: number;
    }): Promise<Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>>;
    writeGemSnapshot(gem: GemRecord, reason: string, takenAtMs: number): Promise<string>;
    applyGemDriftRepair(input: {
        gemId: string;
        nowMs: number;
        newSummary?: string;
        newSymbols?: string[];
        newStatus?: "active" | "deprecated";
        scopeNote?: string;
        confidenceMultiplier?: number;
    }): Promise<boolean>;
    applyMemoryReinforce(input: {
        table: "memory_node" | "gem";
        id: string;
        importanceMultiplier: number;
        nowMs: number;
    }): Promise<boolean>;
    applyContradictionAudit(input: {
        table: "memory_node" | "gem";
        id: string;
        confidenceMultiplier: number;
        contradictionDelta: number;
        nowMs: number;
        relateWith?: { table: "memory_node" | "gem"; id: string };
    }): Promise<boolean>;
    applyReconsolidation(input: {
        left: { table: "memory_node" | "gem"; id: string };
        right: { table: "memory_node" | "gem"; id: string };
        winner: "left" | "right" | "merge";
        nowMs: number;
        mergedSummary?: string;
        mergedSymbols?: string[];
        scopeNote?: string;
    }): Promise<boolean>;
}

export interface EpisodeNodeInput {
    id: string;
    ownerKey: string;
    text: string;
    concepts: string[];
    embedding: number[];
    importance: number;
    sourceKind: string;
    createdAt: number;
    metadata?: Record<string, unknown>;
}

export interface MemoryNodeInput {
    id: string;
    ownerKey: string;
    symbols: string[];
    summary: string;
    embedding: number[];
    confidence: number;
    evidenceCount: number;
    importance: number;
    updatedAt: number;
    recallCount?: number;
    contradictionCount?: number;
    lastAccessedAt?: number;
    scopeNote?: string;
    supersededBy?: string;
}

export interface GemNodeInput {
    id: string;
    ownerKey: string;
    symbols: string[];
    summary: string;
    embedding: number[];
    importance?: number;
    confidence: number;
    support: number;
    protected: boolean;
    updatedAt: number;
    recallCount?: number;
    contradictionCount?: number;
    lastVerifiedAt?: number;
    status?: "active" | "deprecated";
    scopeNote?: string;
    supersededBy?: string;
}

export interface SummaryEmbeddingInput {
    id: string;
    ownerKey: string;
    summaryId: string;
    timeRange: string;
    bucketKey: string;
    embedding: number[];
    createdAt: number;
}

export interface GraphRecallInput {
    ownerKey?: string;
    symbols?: string[];
    embedding?: number[];
    minConfidence?: number;
    limit?: number;
}

export interface MemoryNodeRecord extends MemoryNodeInput {
    score?: number;
}

export interface GemRecord extends GemNodeInput {
    score?: number;
}

export interface GraphCounts {
    episodes: number;
    memoryNodes: number;
    gems: number;
}

export interface DecaySweepInput {
    ownerKey: string;
    /** 单次扫描每张表最多拉的行数，默认 200。 */
    batchSize?: number;
    decayMemoryNode: (row: { importance: number; updatedAt: number }) => number;
    decayGem: (row: { importance: number; updatedAt: number; lastVerifiedAt?: number }) => number;
}

export interface DecaySweepResult {
    memoryNodes: number;
    gems: number;
}
