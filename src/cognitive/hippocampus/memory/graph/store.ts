import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { LocalCrystalMemoryConfig } from "../../../../config/index.ts";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { GraphComponent } from "../../../../components/component.ts";
import { LruCache } from "../cache/lru.ts";
import { DEFAULT_CRYSTAL_VECTOR_DIMENSIONS } from "../../../crystal/memory/vector.index.ts";
import {
    sqliteGraphModel,
    type EpisodeRow,
    type GemRow,
    type GemSnapshotRecord,
    type GemSnapshotRow,
    type GraphEdgeRecord,
    type GraphEdgeRow,
    type MemoryEpisodeRecord,
    type MemoryNodeRow,
    type SummaryEmbeddingRow,
} from "../../../../entities/memory/index.ts";
import type {
    DecaySweepInput,
    DecaySweepResult,
    EpisodeNodeInput,
    GemNodeInput,
    GemRecord,
    GraphCounts,
    GraphRecallInput,
    MemoryGraphStore,
    MemoryNodeInput,
    MemoryNodeRecord,
    SummaryEmbeddingInput,
} from "./types.ts";

@Component()
export class SQLiteGraphStore extends GraphComponent implements MemoryGraphStore {
    private database?: Database;
    private initialized = false;
    private readonly recallCache = new LruCache<MemoryNodeRecord[]>({ maxSize: 100, ttlMs: 60_000 });
    private readonly episodes = new Map<string, MemoryEpisodeRecord>();
    private readonly memoryNodes = new Map<string, MemoryNodeRecord>();
    private readonly gems = new Map<string, GemRecord>();
    private readonly summaryEmbeddings = new Map<string, SummaryEmbeddingInput>();
    private readonly snapshots = new Map<string, GemSnapshotRecord>();
    private readonly edges = new Map<string, GraphEdgeRecord>();

    public constructor(
        private readonly config: LocalCrystalMemoryConfig,
        private readonly vectorDimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    ) {
        super();
    }

    public recallCacheStats(): ReturnType<LruCache<MemoryNodeRecord[]>["stats"]> {
        return this.recallCache.stats();
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        const dbFile = this.requiredDbFile();
        await mkdir(dirname(dbFile), { recursive: true });
        const database = new Database(dbFile, { create: true });
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec("PRAGMA busy_timeout = 5000");
        database.exec(`
            CREATE TABLE IF NOT EXISTS graph_episodes (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                text TEXT NOT NULL,
                concepts_json TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                importance REAL NOT NULL,
                source_kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS graph_memory_nodes (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                symbols_json TEXT NOT NULL,
                summary TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                confidence REAL NOT NULL,
                evidence_count INTEGER NOT NULL,
                importance REAL NOT NULL,
                updated_at INTEGER NOT NULL,
                recall_count INTEGER NOT NULL DEFAULT 0,
                contradiction_count INTEGER NOT NULL DEFAULT 0,
                last_accessed_at INTEGER,
                superseded_by TEXT,
                scope_note TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS graph_gems (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                symbols_json TEXT NOT NULL,
                summary TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                confidence REAL NOT NULL,
                support INTEGER NOT NULL,
                protected INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                recall_count INTEGER NOT NULL DEFAULT 0,
                contradiction_count INTEGER NOT NULL DEFAULT 0,
                last_verified_at INTEGER,
                status TEXT NOT NULL DEFAULT 'active',
                scope_note TEXT,
                superseded_by TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS graph_summary_embeddings (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                summary_id TEXT NOT NULL,
                time_range TEXT NOT NULL,
                bucket_key TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS graph_gem_snapshots (
                id TEXT PRIMARY KEY,
                gem_id TEXT NOT NULL,
                owner_key TEXT NOT NULL,
                reason TEXT NOT NULL,
                taken_at INTEGER NOT NULL,
                summary TEXT NOT NULL,
                symbols_json TEXT NOT NULL,
                confidence REAL NOT NULL,
                support INTEGER NOT NULL,
                protected INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS graph_edges (
                id TEXT PRIMARY KEY,
                owner_key TEXT,
                from_table TEXT NOT NULL,
                from_id TEXT NOT NULL,
                edge TEXT NOT NULL,
                to_table TEXT NOT NULL,
                to_id TEXT NOT NULL,
                score REAL,
                at INTEGER,
                metadata_json TEXT,
                created_at INTEGER NOT NULL
            );
        `);
        this.migrateOwnerColumns(database);
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_episodes_owner ON graph_episodes(owner_key)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_nodes_owner ON graph_memory_nodes(owner_key)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_nodes_importance ON graph_memory_nodes(importance DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_nodes_recall ON graph_memory_nodes(recall_count DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_gems_owner ON graph_gems(owner_key)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_gems_recall ON graph_gems(recall_count DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_gems_updated ON graph_gems(updated_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_table, from_id, edge)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_table, to_id, edge)");
        this.database = database;
        this.episodes.clear();
        this.memoryNodes.clear();
        this.gems.clear();
        this.summaryEmbeddings.clear();
        this.snapshots.clear();
        this.edges.clear();
        for (const row of database.query("SELECT * FROM graph_episodes").all() as EpisodeRow[]) {
            const record = sqliteGraphModel.rowToEpisode(row);
            this.episodes.set(record.id, record);
        }
        for (const row of database.query("SELECT * FROM graph_memory_nodes").all() as MemoryNodeRow[]) {
            const record = sqliteGraphModel.rowToMemoryNode(row);
            this.memoryNodes.set(record.id, record);
        }
        for (const row of database.query("SELECT * FROM graph_gems").all() as GemRow[]) {
            const record = sqliteGraphModel.rowToGem(row);
            this.gems.set(record.id, record);
        }
        for (const row of database.query("SELECT * FROM graph_summary_embeddings").all() as SummaryEmbeddingRow[]) {
            const record = sqliteGraphModel.rowToSummaryEmbedding(row);
            this.summaryEmbeddings.set(record.id, record);
        }
        for (const row of database.query("SELECT * FROM graph_gem_snapshots").all() as GemSnapshotRow[]) {
            const record = sqliteGraphModel.rowToSnapshot(row);
            this.snapshots.set(record.id, record);
        }
        for (const row of database.query("SELECT * FROM graph_edges ORDER BY created_at ASC").all() as GraphEdgeRow[]) {
            const record = sqliteGraphModel.rowToEdge(row);
            this.edges.set(record.id, record);
        }
        this.initialized = true;
    }

    public async upsertEpisode(input: EpisodeNodeInput): Promise<void> {
        if (!this.config.dbFile) return;
        await this.initialize();
        const record: MemoryEpisodeRecord = {
            id: input.id,
            ownerKey: input.ownerKey,
            text: input.text,
            concepts: [...input.concepts],
            embedding: sqliteGraphModel.resolveEmbedding(input.embedding, `${input.text} ${input.concepts.join(" ")}`, this.vectorDimensions),
            importance: input.importance,
            sourceKind: input.sourceKind,
            createdAt: input.createdAt,
            metadata: sqliteGraphModel.normalizeRecord(input.metadata),
        };
        this.episodes.set(record.id, record);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_episodes (
                    id, owner_key, text, concepts_json, embedding_json, importance, source_kind, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                record.id,
                record.ownerKey,
                record.text,
                JSON.stringify(record.concepts),
                JSON.stringify(record.embedding),
                record.importance,
                record.sourceKind,
                record.createdAt,
                JSON.stringify(record.metadata ?? {}),
            );
        this.invalidateRecallCache();
    }

    public async upsertMemoryNode(input: MemoryNodeInput): Promise<void> {
        if (!this.config.dbFile) return;
        await this.initialize();
        const record: MemoryNodeRecord = {
            id: input.id,
            ownerKey: input.ownerKey,
            symbols: [...input.symbols],
            summary: input.summary,
            embedding: sqliteGraphModel.resolveEmbedding(input.embedding, `${input.summary} ${input.symbols.join(" ")}`, this.vectorDimensions),
            confidence: input.confidence,
            evidenceCount: input.evidenceCount,
            importance: input.importance,
            updatedAt: input.updatedAt,
            recallCount: input.recallCount ?? 0,
            contradictionCount: input.contradictionCount ?? 0,
            lastAccessedAt: input.lastAccessedAt,
        };
        this.memoryNodes.set(record.id, record);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_memory_nodes (
                    id, owner_key, symbols_json, summary, embedding_json, confidence, evidence_count,
                    importance, updated_at, recall_count, contradiction_count, last_accessed_at, superseded_by, scope_note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                record.id,
                record.ownerKey,
                JSON.stringify(record.symbols),
                record.summary,
                JSON.stringify(record.embedding),
                record.confidence,
                record.evidenceCount,
                record.importance,
                record.updatedAt,
                record.recallCount ?? 0,
                record.contradictionCount ?? 0,
                record.lastAccessedAt ?? null,
                null,
                null,
            );
        this.invalidateRecallCache();
    }

    public async upsertGem(input: GemNodeInput): Promise<void> {
        if (!this.config.dbFile) return;
        await this.initialize();
        const record: GemRecord = {
            id: input.id,
            ownerKey: input.ownerKey,
            symbols: [...input.symbols],
            summary: input.summary,
            embedding: sqliteGraphModel.resolveEmbedding(input.embedding, `${input.summary} ${input.symbols.join(" ")}`, this.vectorDimensions),
            importance: input.importance ?? input.confidence,
            confidence: input.confidence,
            support: input.support,
            protected: input.protected,
            updatedAt: input.updatedAt,
            recallCount: input.recallCount ?? 0,
            contradictionCount: input.contradictionCount ?? 0,
            lastVerifiedAt: input.lastVerifiedAt,
            status: input.status ?? "active",
            scopeNote: input.scopeNote,
        };
        this.gems.set(record.id, record);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_gems (
                    id, owner_key, symbols_json, summary, embedding_json, importance, confidence, support, protected,
                    updated_at, recall_count, contradiction_count, last_verified_at, status, scope_note, superseded_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                record.id,
                record.ownerKey,
                JSON.stringify(record.symbols),
                record.summary,
                JSON.stringify(record.embedding),
                record.importance ?? record.confidence,
                record.confidence,
                record.support,
                record.protected ? 1 : 0,
                record.updatedAt,
                record.recallCount ?? 0,
                record.contradictionCount ?? 0,
                record.lastVerifiedAt ?? null,
                record.status ?? "active",
                record.scopeNote ?? null,
                null,
            );
        this.invalidateRecallCache();
    }

    public async upsertSummaryEmbedding(input: SummaryEmbeddingInput): Promise<void> {
        if (!this.config.dbFile) return;
        await this.initialize();
        this.summaryEmbeddings.set(input.id, {
            ...input,
            embedding: sqliteGraphModel.resolveEmbedding(
                input.embedding,
                `${input.summaryId} ${input.timeRange} ${input.bucketKey}`,
                this.vectorDimensions,
            ),
        });
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_summary_embeddings (
                    id, owner_key, summary_id, time_range, bucket_key, embedding_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                input.id,
                input.ownerKey,
                input.summaryId,
                input.timeRange,
                input.bucketKey,
                JSON.stringify(
                    sqliteGraphModel.resolveEmbedding(
                        input.embedding,
                        `${input.summaryId} ${input.timeRange} ${input.bucketKey}`,
                        this.vectorDimensions,
                    ),
                ),
                input.createdAt,
            );
    }

    public async applyDecaySweep(input: DecaySweepInput): Promise<DecaySweepResult> {
        if (!this.config.dbFile) return { memoryNodes: 0, gems: 0 };
        await this.initialize();
        const limit = Math.max(1, Math.floor(input.batchSize ?? 200));
        const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
        const nodes = [...this.memoryNodes.values()]
            .filter((row) => row.ownerKey === input.ownerKey)
            .sort((left, right) => left.updatedAt - right.updatedAt)
            .slice(0, limit);
        const gems = [...this.gems.values()]
            .filter((row) => row.ownerKey === input.ownerKey)
            .sort((left, right) => left.updatedAt - right.updatedAt)
            .slice(0, limit);
        let memoryNodes = 0;
        for (const row of nodes) {
            const next = input.decayMemoryNode({
                importance: row.importance,
                updatedAt: row.updatedAt,
            });
            if (Math.abs(next - row.importance) < 1e-4) continue;
            row.importance = next;
            row.updatedAt = nowMs;
            this.persistMemoryNode(row);
            memoryNodes += 1;
        }
        let gemCount = 0;
        for (const row of gems) {
            const next = input.decayGem({
                importance: row.importance ?? row.confidence,
                updatedAt: row.updatedAt,
                lastVerifiedAt: row.lastVerifiedAt,
            });
            const currentImportance = row.importance ?? row.confidence;
            if (Math.abs(next - currentImportance) < 1e-4) continue;
            row.importance = next;
            row.updatedAt = nowMs;
            this.persistGem(row);
            gemCount += 1;
        }
        this.invalidateRecallCache();
        return { memoryNodes, gems: gemCount };
    }

    public async relateNextContext(prev: string, curr: string): Promise<void> {
        await this.relate("episode", prev, "next_context", "episode", curr);
    }

    public async relateSimilarEpisode(a: string, b: string, score: number): Promise<void> {
        await this.relate("episode", a, "similar_ep", "episode", b, { score });
    }

    public async relateConsolidatedInto(episodeId: string, memoryNodeId: string): Promise<void> {
        await this.relate("episode", episodeId, "consolidated_into", "memory_node", memoryNodeId);
    }

    public async relateSimilarConcept(a: string, b: string, score: number): Promise<void> {
        await this.relate("memory_node", a, "similar_concept", "memory_node", b, { score });
    }

    public async relateProvenAs(memoryNodeId: string, gemId: string): Promise<void> {
        await this.relate("memory_node", memoryNodeId, "proven_as", "gem", gemId);
    }

    public async relateProvenBy(gemId: string, episodeId: string): Promise<void> {
        await this.relate("gem", gemId, "proven_by", "episode", episodeId);
    }

    public async recallMemoryNodes(input: GraphRecallInput): Promise<MemoryNodeRecord[]> {
        if (!this.config.dbFile) return [];
        await this.initialize();
        const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
        const cacheKey = sqliteGraphModel.recallCacheKey(input);
        const cached = this.recallCache.get(cacheKey, nowMs);
        if (cached) {
            return this.markMemoryNodeRecall(cached, nowMs);
        }
        const result = this.searchMemoryNodes(input, 64, nowMs);
        this.recallCache.set(cacheKey, result.map((row) => ({ ...row })), nowMs);
        return this.markMemoryNodeRecall(result, nowMs);
    }

    public async recallSkills(input: GraphRecallInput): Promise<GemRecord[]> {
        if (!this.config.dbFile) return [];
        await this.initialize();
        const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
        return this.markGemRecall(this.searchGems(input, 32, nowMs), nowMs);
    }

    public async expandSimilarConcept(seedIds: string[], limit: number): Promise<MemoryNodeRecord[]> {
        if (!this.config.dbFile || seedIds.length === 0) return [];
        await this.initialize();
        const wanted = new Set(seedIds);
        const out: MemoryNodeRecord[] = [];
        for (const edge of this.edges.values()) {
            if (edge.edge !== "similar_concept") continue;
            if (edge.fromTable !== "memory_node" || edge.toTable !== "memory_node") continue;
            if (!wanted.has(edge.fromId)) continue;
            const node = this.memoryNodes.get(edge.toId);
            if (node) {
                out.push({ ...node });
            }
        }
        return out.slice(0, Math.max(1, limit));
    }

    public async countByOwner(ownerKey: string): Promise<GraphCounts> {
        if (!this.config.dbFile) return { episodes: 0, memoryNodes: 0, gems: 0 };
        await this.initialize();
        return {
            episodes: [...this.episodes.values()].filter((row) => row.ownerKey === ownerKey).length,
            memoryNodes: [...this.memoryNodes.values()].filter((row) => row.ownerKey === ownerKey).length,
            gems: [...this.gems.values()].filter((row) => row.ownerKey === ownerKey).length,
        };
    }

    public async listGemDriftCandidates(input: {
        ownerKey: string;
        nowMs: number;
        minContradictionCount: number;
        maxStaleMs: number;
        maxConfidence: number;
        limit: number;
    }): Promise<GemRecord[]> {
        if (!this.config.dbFile) return [];
        await this.initialize();
        const staleCutoff = input.nowMs - input.maxStaleMs;
        return [...this.gems.values()]
            .filter((row) => row.ownerKey === input.ownerKey)
            .filter((row) => {
                const stale = row.lastVerifiedAt === undefined || row.lastVerifiedAt === null || row.lastVerifiedAt < staleCutoff;
                return (
                    row.confidence < input.maxConfidence ||
                    (row.contradictionCount ?? 0) >= input.minContradictionCount ||
                    stale
                );
            })
            .sort((left, right) => left.confidence - right.confidence)
            .slice(0, Math.max(1, Math.min(input.limit, 32)))
            .map((row) => ({ ...row }));
    }

    public async listRecallExtremes(input: {
        ownerKey: string;
        topN: number;
        bottomN: number;
    }): Promise<{ tops: MemoryNodeRecord[]; bottoms: MemoryNodeRecord[] }> {
        if (!this.config.dbFile) return { tops: [], bottoms: [] };
        await this.initialize();
        const rows = [...this.memoryNodes.values()].filter((row) => row.ownerKey === input.ownerKey);
        const topN = Math.max(0, Math.min(input.topN, 32));
        const bottomN = Math.max(0, Math.min(input.bottomN, 32));
        return {
            tops: rows
                .slice()
                .sort((left, right) => (right.recallCount ?? 0) - (left.recallCount ?? 0))
                .slice(0, topN)
                .map((row) => ({ ...row })),
            bottoms: rows
                .slice()
                .sort((left, right) => (left.recallCount ?? 0) - (right.recallCount ?? 0))
                .slice(0, bottomN)
                .map((row) => ({ ...row })),
        };
    }

    public async listContradictionPairs(input: {
        ownerKey: string;
        seedN: number;
        neighborK: number;
        minCosine: number;
    }): Promise<Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>> {
        if (!this.config.dbFile) return [];
        await this.initialize();
        const seeds = [...this.memoryNodes.values()]
            .filter((row) => row.ownerKey === input.ownerKey)
            .sort((left, right) => (right.importance ?? 0) - (left.importance ?? 0))
            .slice(0, Math.max(1, Math.min(input.seedN, 16)));
        const out: Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }> = [];
        const seen = new Set<string>();
        for (const seed of seeds) {
            if (!Array.isArray(seed.embedding) || seed.embedding.length === 0) continue;
            const neighbors = [...this.memoryNodes.values()]
                .filter((row) => row.ownerKey === input.ownerKey)
                .filter((row) => row.id !== seed.id)
                .map((row) => ({
                    row,
                    cosine: sqliteGraphModel.cosine(seed.embedding, row.embedding),
                }))
                .filter((item) => item.cosine >= input.minCosine)
                .filter((item) => Math.abs((seed.importance ?? 0) - (item.row.importance ?? 0)) >= 0.2)
                .sort((left, right) => right.cosine - left.cosine)
                .slice(0, Math.max(2, input.neighborK + 1));
            for (const item of neighbors) {
                const key = [seed.id, item.row.id].sort().join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    left: { ...seed },
                    right: { ...item.row },
                    cosine: item.cosine,
                });
            }
        }
        return out;
    }

    public async writeGemSnapshot(gem: GemRecord, reason: string, takenAtMs: number): Promise<string> {
        if (!this.config.dbFile) return "";
        await this.initialize();
        const snapId = `${gem.id}-${takenAtMs}`;
        const record: GemSnapshotRecord = {
            id: snapId,
            gemId: gem.id,
            ownerKey: gem.ownerKey,
            reason,
            takenAt: takenAtMs,
            summary: gem.summary,
            symbols: [...gem.symbols],
            confidence: gem.confidence,
            support: gem.support,
            protected: gem.protected,
            updatedAt: gem.updatedAt,
        };
        this.snapshots.set(record.id, record);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_gem_snapshots (
                    id, gem_id, owner_key, reason, taken_at, summary, symbols_json, confidence, support, protected, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                record.id,
                record.gemId,
                record.ownerKey,
                record.reason,
                record.takenAt,
                record.summary,
                JSON.stringify(record.symbols),
                record.confidence,
                record.support,
                record.protected ? 1 : 0,
                record.updatedAt,
            );
        return record.id;
    }

    public async applyGemDriftRepair(input: {
        gemId: string;
        nowMs: number;
        newSummary?: string;
        newSymbols?: string[];
        newStatus?: "active" | "deprecated";
        scopeNote?: string;
        confidenceMultiplier?: number;
    }): Promise<boolean> {
        if (!this.config.dbFile) return false;
        await this.initialize();
        const gem = this.gems.get(input.gemId);
        if (!gem) return false;
        if (typeof input.newSummary === "string") gem.summary = input.newSummary;
        if (Array.isArray(input.newSymbols)) gem.symbols = sqliteGraphModel.sanitizeSymbols(input.newSymbols);
        if (input.newStatus) gem.status = input.newStatus;
        if (typeof input.scopeNote === "string") gem.scopeNote = input.scopeNote;
        if (typeof input.confidenceMultiplier === "number") {
            gem.confidence = sqliteGraphModel.clamp01(gem.confidence * input.confidenceMultiplier);
        }
        gem.updatedAt = input.nowMs;
        gem.lastVerifiedAt = input.nowMs;
        this.persistGem(gem);
        this.invalidateRecallCache();
        return true;
    }

    public async applyMemoryReinforce(input: {
        table: "memory_node" | "gem";
        id: string;
        importanceMultiplier: number;
        nowMs: number;
    }): Promise<boolean> {
        if (!this.config.dbFile) return false;
        await this.initialize();
        const multiplier = sqliteGraphModel.clamp(input.importanceMultiplier, 0.5, 1.5);
        if (input.table === "memory_node") {
            const row = this.memoryNodes.get(input.id);
            if (!row) return false;
            row.importance = sqliteGraphModel.clamp01((row.importance ?? 0) * multiplier);
            row.recallCount = (row.recallCount ?? 0) + 1;
            row.updatedAt = input.nowMs;
            row.lastAccessedAt = input.nowMs;
            this.persistMemoryNode(row);
        } else {
            const row = this.gems.get(input.id);
            if (!row) return false;
            row.importance = sqliteGraphModel.clamp01((row.importance ?? row.confidence) * multiplier);
            row.recallCount = (row.recallCount ?? 0) + 1;
            row.updatedAt = input.nowMs;
            row.lastVerifiedAt = input.nowMs;
            this.persistGem(row);
        }
        this.invalidateRecallCache();
        return true;
    }

    public async applyContradictionAudit(input: {
        table: "memory_node" | "gem";
        id: string;
        confidenceMultiplier: number;
        contradictionDelta: number;
        nowMs: number;
        relateWith?: { table: "memory_node" | "gem"; id: string };
    }): Promise<boolean> {
        if (!this.config.dbFile) return false;
        await this.initialize();
        const multiplier = sqliteGraphModel.clamp(input.confidenceMultiplier, 0.3, 1.0);
        const delta = Math.max(0, Math.min(5, Math.floor(input.contradictionDelta)));
        let ok = false;
        if (input.table === "memory_node") {
            const row = this.memoryNodes.get(input.id);
            if (!row) return false;
            row.confidence = sqliteGraphModel.clamp01(row.confidence * multiplier);
            row.contradictionCount = (row.contradictionCount ?? 0) + delta;
            row.updatedAt = input.nowMs;
            this.persistMemoryNode(row);
            ok = true;
        } else {
            const row = this.gems.get(input.id);
            if (!row) return false;
            row.confidence = sqliteGraphModel.clamp01(row.confidence * multiplier);
            row.contradictionCount = (row.contradictionCount ?? 0) + delta;
            row.updatedAt = input.nowMs;
            this.persistGem(row);
            ok = true;
        }
        if (ok && input.relateWith) {
            await this.relate(input.table, input.id, "contradicts", input.relateWith.table, input.relateWith.id, {
                at: input.nowMs,
            });
        }
        this.invalidateRecallCache();
        return ok;
    }

    public async applyReconsolidation(input: {
        left: { table: "memory_node" | "gem"; id: string };
        right: { table: "memory_node" | "gem"; id: string };
        winner: "left" | "right" | "merge";
        nowMs: number;
        mergedSummary?: string;
        mergedSymbols?: string[];
        scopeNote?: string;
    }): Promise<boolean> {
        if (!this.config.dbFile) return false;
        await this.initialize();
        const winnerRef = input.winner === "right" ? input.right : input.left;
        const loserRef = input.winner === "right" ? input.left : input.right;
        const winnerRow = winnerRef.table === "memory_node" ? this.memoryNodes.get(winnerRef.id) : this.gems.get(winnerRef.id);
        const loserRow = loserRef.table === "memory_node" ? this.memoryNodes.get(loserRef.id) : this.gems.get(loserRef.id);
        if (!winnerRow || !loserRow) return false;
        if (typeof input.mergedSummary === "string") {
            winnerRow.summary = input.mergedSummary;
        }
        if (Array.isArray(input.mergedSymbols)) {
            const symbols = sqliteGraphModel.sanitizeSymbols(input.mergedSymbols);
            if (winnerRef.table === "memory_node") winnerRow.symbols = symbols;
            else winnerRow.symbols = symbols;
        }
        if (typeof input.scopeNote === "string") {
            winnerRow.scopeNote = input.scopeNote;
        }
        winnerRow.updatedAt = input.nowMs;
        if (winnerRef.table === "memory_node") {
            this.persistMemoryNode(winnerRow as MemoryNodeRecord);
        } else {
            this.persistGem(winnerRow as GemRecord);
        }
        if (loserRef.table === "memory_node") {
            loserRow.supersededBy = `${winnerRef.table}:${winnerRef.id}`;
            loserRow.updatedAt = input.nowMs;
            this.persistMemoryNode(loserRow as MemoryNodeRecord);
        } else {
            loserRow.supersededBy = `${winnerRef.table}:${winnerRef.id}`;
            loserRow.updatedAt = input.nowMs;
            this.persistGem(loserRow as GemRecord);
        }
        await this.relate(winnerRef.table, winnerRef.id, "supersedes", loserRef.table, loserRef.id, {
            at: input.nowMs,
        });
        this.invalidateRecallCache();
        return true;
    }

    private searchMemoryNodes(input: GraphRecallInput, limit: number, nowMs: number): MemoryNodeRecord[] {
        const rows = [...this.memoryNodes.values()];
        const symbols = sqliteGraphModel.normalizeSymbols(input.symbols ?? []);
        const queryEmbedding = sqliteGraphModel.buildQueryEmbedding(input, this.vectorDimensions);
        const scored = rows
            .filter((row) => (input.ownerKey ? row.ownerKey === input.ownerKey : true))
            .filter((row) => (input.minConfidence !== undefined ? row.confidence >= input.minConfidence : true))
            .map((row) => ({
                row,
                score: sqliteGraphModel.scoreMemoryNode(row, queryEmbedding, symbols, nowMs),
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => {
                const byScore = right.score - left.score;
                if (byScore !== 0) return byScore;
                const byImportance = right.row.importance - left.row.importance;
                if (byImportance !== 0) return byImportance;
                const leftFreshnessTs = left.row.lastAccessedAt ?? left.row.updatedAt;
                const rightFreshnessTs = right.row.lastAccessedAt ?? right.row.updatedAt;
                const byFreshness = rightFreshnessTs - leftFreshnessTs;
                if (byFreshness !== 0) return byFreshness;
                return left.row.id.localeCompare(right.row.id);
            })
            .slice(0, Math.max(1, Math.min(limit, 64)));
        return scored.map((entry) => ({ ...entry.row, score: entry.score }));
    }

    private searchGems(input: GraphRecallInput, limit: number, nowMs: number): GemRecord[] {
        const rows = [...this.gems.values()];
        const symbols = sqliteGraphModel.normalizeSymbols(input.symbols ?? []);
        const queryEmbedding = sqliteGraphModel.buildQueryEmbedding(input, this.vectorDimensions);
        const scored = rows
            .filter((row) => (input.ownerKey ? row.ownerKey === input.ownerKey : true))
            .filter((row) => (input.minConfidence !== undefined ? row.confidence >= input.minConfidence : true))
            .map((row) => ({
                row,
                score: sqliteGraphModel.scoreGem(row, queryEmbedding, symbols, nowMs),
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => {
                const byScore = right.score - left.score;
                if (byScore !== 0) return byScore;
                const bySupport = right.row.support - left.row.support;
                if (bySupport !== 0) return bySupport;
                const leftFreshnessTs = left.row.lastVerifiedAt ?? left.row.updatedAt;
                const rightFreshnessTs = right.row.lastVerifiedAt ?? right.row.updatedAt;
                const byFreshness = rightFreshnessTs - leftFreshnessTs;
                if (byFreshness !== 0) return byFreshness;
                return left.row.id.localeCompare(right.row.id);
            })
            .slice(0, Math.max(1, Math.min(limit, 32)));
        return scored.map((entry) => ({ ...entry.row, score: entry.score }));
    }

    private async relate(
        fromTable: string,
        fromId: string,
        edge: string,
        toTable: string,
        toId: string,
        content?: Record<string, unknown>,
    ): Promise<void> {
        if (!this.config.dbFile) return;
        await this.initialize();
        const id = `${fromTable}:${fromId}:${edge}:${toTable}:${toId}`;
        const ownerKey = this.lookupOwnerKey(fromTable, fromId) ?? this.lookupOwnerKey(toTable, toId);
        const createdAt = typeof content?.at === "number" && Number.isFinite(content.at) ? content.at : Date.now();
        const record: GraphEdgeRecord = {
            id,
            ownerKey,
            fromTable,
            fromId,
            edge,
            toTable,
            toId,
            score: typeof content?.score === "number" ? content.score : undefined,
            at: typeof content?.at === "number" ? content.at : undefined,
            metadata: sqliteGraphModel.normalizeRecord(content),
            createdAt,
        };
        this.edges.set(record.id, record);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_edges (
                    id, owner_key, from_table, from_id, edge, to_table, to_id, score, at, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                record.id,
                record.ownerKey ?? null,
                record.fromTable,
                record.fromId,
                record.edge,
                record.toTable,
                record.toId,
                record.score ?? null,
                record.at ?? null,
                JSON.stringify(record.metadata ?? {}),
                record.createdAt,
            );
    }

    private persistMemoryNode(row: MemoryNodeRecord): void {
        this.memoryNodes.set(row.id, row);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_memory_nodes (
                    id, owner_key, symbols_json, summary, embedding_json, confidence, evidence_count,
                    importance, updated_at, recall_count, contradiction_count, last_accessed_at, superseded_by, scope_note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                row.id,
                row.ownerKey,
                JSON.stringify(row.symbols),
                row.summary,
                JSON.stringify(row.embedding),
                row.confidence,
                row.evidenceCount,
                row.importance,
                row.updatedAt,
                row.recallCount ?? 0,
                row.contradictionCount ?? 0,
                row.lastAccessedAt ?? null,
                row.supersededBy ?? null,
                row.scopeNote ?? null,
            );
    }

    private persistGem(row: GemRecord): void {
        this.gems.set(row.id, row);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO graph_gems (
                    id, owner_key, symbols_json, summary, embedding_json, importance, confidence, support, protected,
                    updated_at, recall_count, contradiction_count, last_verified_at, status, scope_note, superseded_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                row.id,
                row.ownerKey,
                JSON.stringify(row.symbols),
                row.summary,
                JSON.stringify(row.embedding),
                row.importance ?? row.confidence,
                row.confidence,
                row.support,
                row.protected ? 1 : 0,
                row.updatedAt,
                row.recallCount ?? 0,
                row.contradictionCount ?? 0,
                row.lastVerifiedAt ?? null,
                row.status ?? "active",
                row.scopeNote ?? null,
                row.supersededBy ?? null,
            );
    }

    private lookupOwnerKey(table: string, id: string): string | undefined {
        if (table === "episode") return this.episodes.get(id)?.ownerKey;
        if (table === "memory_node") return this.memoryNodes.get(id)?.ownerKey;
        if (table === "gem") return this.gems.get(id)?.ownerKey;
        return undefined;
    }

    private migrateOwnerColumns(database: Database): void {
        void database;
    }

    private requiredDatabase(): Database {
        if (!this.database) {
            throw new Error("SQLiteGraphStore is not initialized.");
        }
        return this.database;
    }

    private requiredDbFile(): string {
        if (!this.config.dbFile) {
            throw new Error("memory.crystal.local.dbFile is required for the local graph backend.");
        }
        return this.config.dbFile;
    }

    private invalidateRecallCache(): void {
        this.recallCache.clear();
    }

    /**
     * Recall accounting is part of the graph store contract: downstream dream,
     * decay, and reinforcement flows read recallCount/lastAccessedAt directly
     * from graph rows, so successful recall must update those resource metrics.
     */
    private markMemoryNodeRecall(rows: MemoryNodeRecord[], nowMs: number): MemoryNodeRecord[] {
        if (rows.length === 0) return [];
        const out: MemoryNodeRecord[] = [];
        for (const row of rows) {
            const live = this.memoryNodes.get(row.id);
            if (!live) {
                out.push({ ...row });
                continue;
            }
            live.recallCount = (live.recallCount ?? 0) + 1;
            live.lastAccessedAt = nowMs;
            this.persistMemoryNode(live);
            out.push({ ...live, score: row.score });
        }
        this.invalidateRecallCache();
        return out;
    }

    private markGemRecall(rows: GemRecord[], nowMs: number): GemRecord[] {
        if (rows.length === 0) return [];
        const out: GemRecord[] = [];
        for (const row of rows) {
            const live = this.gems.get(row.id);
            if (!live) {
                out.push({ ...row });
                continue;
            }
            live.recallCount = (live.recallCount ?? 0) + 1;
            live.lastVerifiedAt = nowMs;
            this.persistGem(live);
            out.push({ ...live, score: row.score });
        }
        this.invalidateRecallCache();
        return out;
    }
}
