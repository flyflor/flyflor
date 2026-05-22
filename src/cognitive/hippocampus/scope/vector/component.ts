/**
 * Scope vector index component.
 *
 * This layer owns fast scope lookup and hot-subtree recall. It does not own
 * scope constitution files, ledger history, or forgetting. Scope nodes are
 * durable; the component only manages a bounded in-memory hot cache over a
 * persistent index.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { BrainComponent } from "../../../../components/component.ts";
import type { FlyflorPaths } from "../../../../config/index.ts";
import { LruCache } from "../../memory/cache/lru.ts";
import type { BrainStore } from "../../memory/brain/store.ts";
import type { ScopeRecord, CodenameRecord, RuntimeScope, RuntimeContext, CrystalGem } from "../../../../protocol/contracts/index.ts";
import { DEFAULT_SCOPE_VECTOR_DIMENSIONS, scopeVectorCodec, type ScopeVectorCodec } from "./codec.ts";

export interface ScopeVectorQueryInput {
    query?: string;
    queryEmbedding?: number[];
    scopeId?: string;
    codenameId?: string;
    activeScope?: RuntimeScope;
    contextForkId?: string;
    limit?: number;
    nowMs?: number;
}

export interface ScopeVectorHit {
    scopeId: string;
    score: number;
    kind: "active" | "codename" | "graph" | "summary" | "hot";
    title?: string;
    goal?: string;
    codenameId?: string;
    relatedIds: string[];
    summary?: string;
    hot?: boolean;
    evidence: {
        embedding: number;
        symbol: number;
        activity: number;
        adjacency: number;
    };
}

export interface ScopeVectorNode {
    scopeId: string;
    ownerKey: string;
    title: string;
    goal?: string;
    summary: string;
    embedding: number[];
    symbolSet: string[];
    updatedAt: number;
    lastUsedAt: number;
    useCount: number;
    codenameId?: string;
    active: boolean;
}

export interface ScopeVectorEdge {
    id: string;
    fromScopeId: string;
    toScopeId: string;
    kind: "ask" | "fork" | "crystal" | "memory" | "codename" | "summary";
    score: number;
    updatedAt: number;
}

export interface ScopeVectorComponentOptions {
    dbFile?: string;
    hotCacheSize?: number;
    hotCacheTtlMs?: number;
    vectorDimensions?: number;
    codec?: ScopeVectorCodec;
}

interface ScopeVectorPersistedNode {
    scopeId: string;
    ownerKey: string;
    title: string;
    goal?: string;
    summary: string;
    embeddingJson: string;
    symbolJson: string;
    updatedAt: number;
    lastUsedAt: number;
    useCount: number;
    codenameId?: string;
    active: number;
}

@Component()
export class ScopeVectorComponent extends BrainComponent {
    private readonly cache: LruCache<ScopeVectorHit[]>;
    private readonly hotScopeIds = new Set<string>();
    private readonly dbFile: string;
    private readonly dimensions: number;
    private readonly codec: ScopeVectorCodec;
    private database?: Database;
    private initialized = false;

    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly brain: BrainStore,
        options: ScopeVectorComponentOptions = {},
    ) {
        super();
        this.dbFile = options.dbFile ?? `${paths.storageDir}/scope-vector/scope-vector.db`;
        this.dimensions = options.vectorDimensions ?? DEFAULT_SCOPE_VECTOR_DIMENSIONS;
        this.codec = options.codec ?? scopeVectorCodec;
        this.cache = new LruCache<ScopeVectorHit[]>({
            maxSize: options.hotCacheSize ?? 64,
            ttlMs: options.hotCacheTtlMs ?? 5 * 60_000,
        });
    }

    public async initialize(): Promise<void> {
        if (this.initialized) return;
        await mkdir(dirname(this.dbFile), { recursive: true });
        const database = new Database(this.dbFile, { create: true });
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(`
            CREATE TABLE IF NOT EXISTS scope_vectors (
                scope_id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                title TEXT NOT NULL,
                goal TEXT,
                summary TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                symbol_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                use_count INTEGER NOT NULL,
                codename_id TEXT,
                active INTEGER NOT NULL DEFAULT 1
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS scope_vector_edges (
                id TEXT PRIMARY KEY,
                from_scope_id TEXT NOT NULL,
                to_scope_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                score REAL NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_vectors_last_used ON scope_vectors(last_used_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_vectors_owner ON scope_vectors(owner_key)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_vector_edges_from ON scope_vector_edges(from_scope_id, kind, score DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_vector_edges_to ON scope_vector_edges(to_scope_id, kind, score DESC)");
        this.database = database;
        this.initialized = true;
    }

    public dispose(): void {
        this.database?.close();
        this.database = undefined;
        this.initialized = false;
        this.cache.clear();
        this.hotScopeIds.clear();
    }

    public async upsertScope(input: {
        scope: ScopeRecord;
        codename?: CodenameRecord | null;
        summary?: string;
        symbols?: string[];
        active?: boolean;
        relatedScopeIds?: string[];
        nowMs?: number;
    }): Promise<void> {
        await this.initialize();
        const nowMs = input.nowMs ?? Date.now();
        const codename = input.codename ?? null;
        const node: ScopeVectorPersistedNode = {
            scopeId: input.scope.id,
            ownerKey: `scope:${input.scope.id}`,
            title: input.scope.title,
            goal: input.scope.goal,
            summary: (input.summary ?? this.buildScopeSummary(input.scope, codename)).trim(),
            embeddingJson: JSON.stringify(
                this.codec.embedScopeText(
                    {
                        scope: input.scope,
                        codename,
                        summary: input.summary,
                        symbols: input.symbols,
                    },
                    this.dimensions,
                ),
            ),
            symbolJson: JSON.stringify(this.codec.normalizeSymbols(input.symbols ?? this.buildScopeSymbols(input.scope, codename))),
            updatedAt: nowMs,
            lastUsedAt: input.scope.lastUsedAt,
            useCount: input.scope.useCount,
            codenameId: codename?.id,
            active: input.active === false ? 0 : 1,
        };
        this.database!
            .prepare(
                `INSERT OR REPLACE INTO scope_vectors (
                    scope_id, owner_key, title, goal, summary, embedding_json, symbol_json,
                    updated_at, last_used_at, use_count, codename_id, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                node.scopeId,
                node.ownerKey,
                node.title,
                node.goal ?? null,
                node.summary,
                node.embeddingJson,
                node.symbolJson,
                node.updatedAt,
                node.lastUsedAt,
                node.useCount,
                node.codenameId ?? null,
                node.active,
            );
        this.invalidateScopeCache(node.scopeId);
        this.hotScopeIds.add(node.scopeId);
        if (input.relatedScopeIds && input.relatedScopeIds.length > 0) {
            for (const related of input.relatedScopeIds) {
                await this.upsertEdge({
                    fromScopeId: node.scopeId,
                    toScopeId: related,
                    kind: "summary",
                    score: 0.5,
                    updatedAt: nowMs,
                });
            }
        }
    }

    public async upsertEdge(input: Omit<ScopeVectorEdge, "id"> & { id?: string }): Promise<void> {
        await this.initialize();
        const id = input.id ?? `${input.kind}:${input.fromScopeId}:${input.toScopeId}`;
        this.database!
            .prepare(
                `INSERT OR REPLACE INTO scope_vector_edges (
                    id, from_scope_id, to_scope_id, kind, score, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(id, input.fromScopeId, input.toScopeId, input.kind, input.score, input.updatedAt);
        this.invalidateScopeCache(input.fromScopeId);
        this.invalidateScopeCache(input.toScopeId);
        this.hotScopeIds.add(input.fromScopeId);
    }

    public async syncScopeFromBrain(scopeId: string): Promise<boolean> {
        await this.initialize();
        const scope = this.brain.getScope(scopeId);
        if (!scope) return false;
        const codename = this.brain.listCodenames({ limit: 100 }).find((row) => row.scopeId === scopeId) ?? null;
        const summary = this.buildScopeSummary(scope, codename);
        await this.upsertScope({
            scope,
            codename,
            summary,
            symbols: this.buildScopeSymbols(scope, codename),
            active: true,
            nowMs: Date.now(),
        });
        return true;
    }

    public async recall(input: ScopeVectorQueryInput): Promise<ScopeVectorHit[]> {
        await this.initialize();
        const limit = Math.max(1, Math.min(16, Math.floor(input.limit ?? 4)));
        const scopeId = this.resolveScopeId(input);
        if (!scopeId) return [];
        const cacheKey = this.cacheKey(scopeId, input);
        const cached = this.cache.get(cacheKey, input.nowMs ?? Date.now());
        if (cached) return cached.slice(0, limit);
        const rows = this.loadSubtreeRows(scopeId, limit);
        if (rows.length === 0) return [];
        const queryEmbedding = input.queryEmbedding ?? this.embedQuery(input.query ?? scopeId);
        const querySymbols = this.codec.normalizeSymbols([input.query ?? "", input.codenameId ?? "", scopeId]);
        const nowMs = input.nowMs ?? Date.now();
        const hits = rows
            .map((row) => this.scoreRow(row, queryEmbedding, querySymbols, nowMs, input.contextForkId))
            .filter((hit) => hit.score > 0)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                if (right.evidence.embedding !== left.evidence.embedding) return right.evidence.embedding - left.evidence.embedding;
                if (right.evidence.symbol !== left.evidence.symbol) return right.evidence.symbol - left.evidence.symbol;
                if (right.evidence.activity !== left.evidence.activity) return right.evidence.activity - left.evidence.activity;
                return left.scopeId.localeCompare(right.scopeId);
            })
            .slice(0, limit);
        this.cache.set(cacheKey, hits, nowMs);
        this.hotScopeIds.add(scopeId);
        return hits;
    }

    public async resolveScope(input: ScopeVectorQueryInput): Promise<ScopeVectorHit | undefined> {
        const hits = await this.recall({ ...input, limit: 1 });
        return hits[0];
    }

    public async listHotScopes(limit = 8): Promise<ScopeVectorHit[]> {
        await this.initialize();
        const rows = this.loadAllRows().sort((left, right) => {
            if (right.useCount !== left.useCount) return right.useCount - left.useCount;
            if (right.lastUsedAt !== left.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
            return left.scopeId.localeCompare(right.scopeId);
        });
        return rows.slice(0, Math.max(1, Math.min(16, limit))).map((row) => this.scoreRow(row, this.embedQuery(row.scopeId), [row.scopeId], Date.now()));
    }

    public async recallScopeNeighbors(scopeId: string, limit = 8): Promise<ScopeVectorHit[]> {
        await this.initialize();
        const nowMs = Date.now();
        const edges = this.loadEdges(scopeId)
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.max(1, Math.min(16, limit)));
        const rows = this.loadAllRows().filter((row) => row.scopeId !== scopeId);
        const hits: ScopeVectorHit[] = [];
        for (const edge of edges) {
            const neighborId = edge.fromScopeId === scopeId ? edge.toScopeId : edge.fromScopeId;
            const row = rows.find((item) => item.scopeId === neighborId);
            if (!row) continue;
            hits.push(this.scoreRow(row, this.embedQuery(scopeId), [scopeId, row.scopeId], nowMs));
        }
        return hits.slice(0, limit);
    }

    public async noteTurn(input: {
        context: RuntimeContext;
        messageText: string;
        replyText: string;
        activeScope?: RuntimeScope;
        codename?: CodenameRecord | null;
        crystallizedGems?: CrystalGem[];
        relatedScopeIds?: string[];
        nowMs?: number;
    }): Promise<void> {
        const scopeId = input.activeScope?.id ?? input.codename?.scopeId;
        if (!scopeId) return;
        const scope = this.brain.getScope(scopeId);
        if (!scope) return;
        const summary = this.buildTurnSummary(input.messageText, input.replyText, input.crystallizedGems);
        const symbols = this.buildTurnSymbols(input.messageText, input.replyText, input.crystallizedGems);
        await this.upsertScope({
            scope,
            codename: input.codename,
            summary,
            symbols,
            active: true,
            relatedScopeIds: input.relatedScopeIds,
            nowMs: input.nowMs,
        });
    }

    private loadRows(scopeId: string): ScopeVectorPersistedNode[] {
        const db = this.requireDatabase();
        return db
            .query<ScopeVectorPersistedNode, [string]>(
                `SELECT scope_id AS scopeId, owner_key AS ownerKey, title, goal, summary, embedding_json AS embeddingJson, symbol_json AS symbolJson, updated_at AS updatedAt, last_used_at AS lastUsedAt, use_count AS useCount, codename_id AS codenameId, active FROM scope_vectors WHERE scope_id = ?1`,
            )
            .all(scopeId);
    }

    private loadSubtreeRows(scopeId: string, limit: number): ScopeVectorPersistedNode[] {
        const root = this.loadRows(scopeId);
        if (root.length === 0) return [];
        const neighborIds = this.loadEdges(scopeId)
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.max(0, limit * 2))
            .map((edge) => (edge.fromScopeId === scopeId ? edge.toScopeId : edge.fromScopeId));
        const rows = new Map<string, ScopeVectorPersistedNode>();
        for (const row of root) rows.set(row.scopeId, row);
        for (const neighborId of neighborIds) {
            const row = this.loadRows(neighborId)[0];
            if (row) rows.set(row.scopeId, row);
        }
        return [...rows.values()];
    }

    private loadAllRows(): ScopeVectorPersistedNode[] {
        const db = this.requireDatabase();
        return db
            .query<ScopeVectorPersistedNode, []>(
                `SELECT scope_id AS scopeId, owner_key AS ownerKey, title, goal, summary, embedding_json AS embeddingJson, symbol_json AS symbolJson, updated_at AS updatedAt, last_used_at AS lastUsedAt, use_count AS useCount, codename_id AS codenameId, active FROM scope_vectors`,
            )
            .all();
    }

    private loadEdges(scopeId: string): ScopeVectorEdge[] {
        const db = this.requireDatabase();
        return db
            .query<ScopeVectorEdge, [string]>(
                `SELECT id, from_scope_id AS fromScopeId, to_scope_id AS toScopeId, kind, score, updated_at AS updatedAt FROM scope_vector_edges WHERE from_scope_id = ?1 OR to_scope_id = ?1`,
            )
            .all(scopeId);
    }

    private scoreRow(
        row: ScopeVectorPersistedNode,
        queryEmbedding: number[],
        querySymbols: string[],
        nowMs: number,
        contextForkId?: string,
    ): ScopeVectorHit {
        const embedding = this.codec.cosine(queryEmbedding, this.parseEmbedding(row.embeddingJson));
        const symbol = this.codec.symbolOverlap(querySymbols, this.parseSymbols(row.symbolJson));
        const activity = this.activityScore(row.lastUsedAt, row.useCount, nowMs);
        const adjacency = this.adjacencyScore(row.scopeId, contextForkId);
        const activeBoost = row.active ? 0.15 : 0;
        const score = embedding * 0.6 + symbol * 0.18 + activity * 0.14 + adjacency * 0.08 + activeBoost;
        return {
            scopeId: row.scopeId,
            score,
            kind: row.active ? "active" : "summary",
            title: row.title,
            goal: row.goal,
            codenameId: row.codenameId,
            relatedIds: this.loadEdges(row.scopeId).map((edge) => (edge.fromScopeId === row.scopeId ? edge.toScopeId : edge.fromScopeId)).slice(0, 8),
            summary: row.summary,
            hot: row.active ? true : false,
            evidence: { embedding, symbol, activity, adjacency },
        };
    }

    private resolveScopeId(input: ScopeVectorQueryInput): string | undefined {
        if (input.scopeId) return input.scopeId;
        if (input.activeScope?.id) return input.activeScope.id;
        if (input.codenameId) {
            const codename = this.brain.getCodename(input.codenameId);
            if (codename?.scopeId) return codename.scopeId;
        }
        return undefined;
    }

    private buildScopeSummary(scope: ScopeRecord, codename: CodenameRecord | null): string {
        const parts = [scope.title, scope.goal, codename?.name, codename?.description, scope.projectDir];
        return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" | ").trim();
    }

    private buildScopeSymbols(scope: ScopeRecord, codename: CodenameRecord | null): string[] {
        const symbols = [scope.id, scope.title, scope.goal, codename?.id, codename?.name, codename?.description, scope.projectDir];
        return this.codec.normalizeSymbols(symbols.filter((value): value is string => typeof value === "string"));
    }

    private buildTurnSummary(messageText: string, replyText: string, gems: CrystalGem[] = []): string {
        const head = [messageText, replyText].filter(Boolean).join("\n");
        const gemText = gems.length > 0 ? gems.map((gem) => [gem.bucket, gem.title, gem.method].filter(Boolean).join(" ")).join(" | ") : "";
        return [head, gemText].filter((value) => value.trim().length > 0).join("\n").trim();
    }

    private buildTurnSymbols(messageText: string, replyText: string, gems: CrystalGem[] = []): string[] {
        const tokens = [messageText, replyText, ...gems.flatMap((gem) => [gem.bucket, gem.title, ...gem.symbols])];
        return this.codec.normalizeSymbols(tokens.filter((value): value is string => typeof value === "string"));
    }

    private embedQuery(text: string): number[] {
        return this.codec.embedText(text, this.dimensions);
    }

    private parseEmbedding(raw: string): number[] {
        try {
            const parsed = JSON.parse(raw) as number[];
            return Array.isArray(parsed) ? parsed.map((value) => (Number.isFinite(value) ? value : 0)) : [];
        } catch {
            return [];
        }
    }

    private parseSymbols(raw: string): string[] {
        try {
            const parsed = JSON.parse(raw) as string[];
            return Array.isArray(parsed) ? this.codec.normalizeSymbols(parsed) : [];
        } catch {
            return [];
        }
    }

    private activityScore(lastUsedAt: number, useCount: number, nowMs: number): number {
        if (!Number.isFinite(lastUsedAt)) return Math.min(1, Math.log1p(useCount) / 10);
        const ageDays = Math.max(0, nowMs - lastUsedAt) / 86_400_000;
        const freshness = 1 / (1 + ageDays);
        const frequency = Math.min(1, Math.log1p(Math.max(0, useCount)) / 8);
        return freshness * 0.65 + frequency * 0.35;
    }

    private adjacencyScore(scopeId: string, contextForkId?: string): number {
        if (!contextForkId) return 0;
        return contextForkId.endsWith(scopeId.slice(-4)) ? 0.3 : 0.05;
    }

    private cacheKey(scopeId: string, input: ScopeVectorQueryInput): string {
        const embeddingHash = input.queryEmbedding?.length ? `${input.queryEmbedding.length}:${input.queryEmbedding[0] ?? 0}:${input.queryEmbedding.at(-1) ?? 0}` : "none";
        return [scopeId, input.codenameId ?? "", input.contextForkId ?? "", embeddingHash, input.query ?? ""].join("|");
    }

    private invalidateScopeCache(_scopeId: string): void {
        this.cache.clear();
    }

    public getHotScopeIds(): string[] {
        return [...this.hotScopeIds];
    }

    private requireDatabase(): Database {
        if (!this.database) {
            throw new Error("ScopeVectorComponent is not initialized.");
        }
        return this.database;
    }
}

export function useScopeVectorComponent(paths: FlyflorPaths, brain: BrainStore, options: ScopeVectorComponentOptions = {}): ScopeVectorComponent {
    return new ScopeVectorComponent(paths, brain, options);
}
