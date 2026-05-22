/**
 * Scope vector index component.
 *
 * This layer owns fast scope lookup and hot-subtree recall. It does not own
 * scope constitution files, ledger history, or forgetting. Scope nodes are
 * durable; the component only manages a bounded in-memory hot cache over a
 * persistent index.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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

interface ScopeHotMemoryInput {
    id?: string;
    requestId?: string;
    scopeId: string;
    sourceId?: string;
    summary: string;
    text: string;
    symbols?: string[];
    importance?: number;
    nowMs?: number;
}

interface ScopeTreeNodeInput {
    id?: string;
    scopeId: string;
    parentId?: string;
    kind: "root" | "summary" | "hot-memory" | "association";
    title: string;
    summary: string;
    symbols?: string[];
    sourceId?: string;
    score?: number;
    depth?: number;
    nowMs?: number;
}

interface ScopeHotMemoryRow {
    id: string;
    scopeId: string;
    summary: string;
    text: string;
    embeddingJson: string;
    symbolJson: string;
    importance: number;
    createdAt: number;
    updatedAt: number;
    sourceId?: string;
    requestId?: string;
}

@Component()
export class ScopeVectorComponent extends BrainComponent {
    private readonly cache: LruCache<ScopeVectorHit[]>;
    private readonly hotScopeIds = new Set<string>();
    private readonly dbFile: string;
    private readonly dimensions: number;
    private readonly codec: ScopeVectorCodec;
    private readonly databases = new Map<string, Database>();

    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly brain: BrainStore,
        options: ScopeVectorComponentOptions = {},
    ) {
        super();
        // Default runtime storage is scope-local: each solidified Scope owns its
        // own project `.flyflor/scope.db`. Tests and migrations may inject a
        // single dbFile to preserve old shared-index behavior explicitly.
        this.dbFile = options.dbFile ?? join(paths.projectFlyflorDir, "scope.db");
        this.dimensions = options.vectorDimensions ?? DEFAULT_SCOPE_VECTOR_DIMENSIONS;
        this.codec = options.codec ?? scopeVectorCodec;
        this.cache = new LruCache<ScopeVectorHit[]>({
            maxSize: options.hotCacheSize ?? 64,
            ttlMs: options.hotCacheTtlMs ?? 5 * 60_000,
        });
    }

    public async initialize(): Promise<void> {
        await this.openDatabase(this.dbFile);
    }

    private async openDatabase(dbFile: string): Promise<Database> {
        const existing = this.databases.get(dbFile);
        if (existing) return existing;
        await mkdir(dirname(dbFile), { recursive: true });
        const database = new Database(dbFile, { create: true });
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
            CREATE TABLE IF NOT EXISTS scope_tree_nodes (
                id TEXT PRIMARY KEY,
                scope_id TEXT NOT NULL,
                parent_id TEXT,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                symbol_json TEXT NOT NULL,
                score REAL NOT NULL,
                depth INTEGER NOT NULL,
                source_id TEXT,
                updated_at INTEGER NOT NULL
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS scope_hot_memory (
                id TEXT PRIMARY KEY,
                scope_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                text TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                symbol_json TEXT NOT NULL,
                importance REAL NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source_id TEXT,
                request_id TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS scope_associations (
                id TEXT PRIMARY KEY,
                scope_id TEXT NOT NULL,
                term TEXT NOT NULL,
                kind TEXT NOT NULL,
                weight REAL NOT NULL,
                source_id TEXT,
                updated_at INTEGER NOT NULL
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
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_tree_nodes_scope ON scope_tree_nodes(scope_id, kind, score DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_hot_memory_scope ON scope_hot_memory(scope_id, importance DESC, updated_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_associations_scope ON scope_associations(scope_id, kind, weight DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_associations_term ON scope_associations(term)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_vector_edges_from ON scope_vector_edges(from_scope_id, kind, score DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_scope_vector_edges_to ON scope_vector_edges(to_scope_id, kind, score DESC)");
        this.databases.set(dbFile, database);
        return database;
    }

    public dispose(): void {
        for (const database of this.databases.values()) {
            database.close();
        }
        this.databases.clear();
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
        const database = await this.databaseForScope(input.scope);
        const nowMs = input.nowMs ?? Date.now();
        const codename = input.codename ?? null;
        const summary = (input.summary ?? this.buildScopeSummary(input.scope, codename)).trim();
        const symbols = this.codec.normalizeSymbols(input.symbols ?? this.buildScopeSymbols(input.scope, codename));
        const node: ScopeVectorPersistedNode = {
            scopeId: input.scope.id,
            ownerKey: `scope:${input.scope.id}`,
            title: input.scope.title,
            goal: input.scope.goal,
            summary,
            embeddingJson: JSON.stringify(
                this.codec.embedScopeText(
                    {
                        scope: input.scope,
                        codename,
                        summary,
                        symbols,
                    },
                    this.dimensions,
                ),
            ),
            symbolJson: JSON.stringify(symbols),
            updatedAt: nowMs,
            lastUsedAt: input.scope.lastUsedAt,
            useCount: input.scope.useCount,
            codenameId: codename?.id,
            active: input.active === false ? 0 : 1,
        };
        database
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
        await this.upsertTreeNode({
            scopeId: node.scopeId,
            id: `${node.scopeId}:root`,
            kind: "root",
            title: node.title,
            summary,
            symbols,
            score: 1,
            depth: 0,
            nowMs,
        }, database);
        this.upsertAssociations(database, node.scopeId, symbols, "scope", node.scopeId, nowMs, 1);
        this.invalidateScopeCache(node.scopeId);
        this.hotScopeIds.add(node.scopeId);
        if (input.relatedScopeIds && input.relatedScopeIds.length > 0) {
            for (const related of input.relatedScopeIds) {
                const relatedScope = this.brain.getScope(related);
                if (relatedScope) {
                    await this.upsertScopeRow(database, relatedScope, nowMs);
                }
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
        const database = await this.databaseForScopeId(input.fromScopeId);
        const id = input.id ?? `${input.kind}:${input.fromScopeId}:${input.toScopeId}`;
        database
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

    public async recordHotMemory(input: ScopeHotMemoryInput): Promise<void> {
        const database = await this.databaseForScopeId(input.scopeId);
        const nowMs = input.nowMs ?? Date.now();
        const id = input.id ?? `hot-${crypto.randomUUID()}`;
        const symbols = this.codec.normalizeSymbols(input.symbols ?? [input.summary, input.text]);
        const embedding = this.codec.embedText([input.summary, input.text, ...symbols].join(" "), this.dimensions);
        database
            .prepare(
                `INSERT OR REPLACE INTO scope_hot_memory (
                    id, scope_id, summary, text, embedding_json, symbol_json, importance,
                    created_at, updated_at, source_id, request_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                id,
                input.scopeId,
                input.summary,
                input.text,
                JSON.stringify(embedding),
                JSON.stringify(symbols),
                input.importance ?? 0.6,
                nowMs,
                nowMs,
                input.sourceId ?? null,
                input.requestId ?? null,
            );
        await this.upsertTreeNode({
            scopeId: input.scopeId,
            id: `${input.scopeId}:hot:${id}`,
            parentId: `${input.scopeId}:root`,
            kind: "hot-memory",
            title: input.summary.slice(0, 120) || "scope hot memory",
            summary: input.summary,
            symbols,
            sourceId: id,
            score: input.importance ?? 0.6,
            depth: 1,
            nowMs,
        }, database);
        this.upsertAssociations(database, input.scopeId, symbols, "hot-memory", id, nowMs, input.importance ?? 0.6);
        this.invalidateScopeCache(input.scopeId);
        this.hotScopeIds.add(input.scopeId);
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
        await this.databaseForScopeId(scopeId);
        const cacheKey = this.cacheKey(scopeId, input);
        const cached = this.cache.get(cacheKey, input.nowMs ?? Date.now());
        if (cached) return cached.slice(0, limit);
        const rows = await this.loadSubtreeRows(scopeId, limit);
        if (rows.length === 0) return [];
        const queryEmbedding = input.queryEmbedding ?? this.embedQuery(input.query ?? scopeId);
        const querySymbols = this.codec.normalizeSymbols([input.query ?? "", input.codenameId ?? "", scopeId]);
        const nowMs = input.nowMs ?? Date.now();
        const scored = await Promise.all(rows.map((row) => this.scoreRow(row, queryEmbedding, querySymbols, nowMs, input.contextForkId)));
        const hits = scored
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
        const rows = (await this.loadAllRows()).sort((left, right) => {
            if (right.useCount !== left.useCount) return right.useCount - left.useCount;
            if (right.lastUsedAt !== left.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
            return left.scopeId.localeCompare(right.scopeId);
        });
        return Promise.all(
            rows
                .slice(0, Math.max(1, Math.min(16, limit)))
                .map((row) => this.scoreRow(row, this.embedQuery(row.scopeId), [row.scopeId], Date.now())),
        );
    }

    public async recallScopeNeighbors(scopeId: string, limit = 8): Promise<ScopeVectorHit[]> {
        await this.initialize();
        await this.databaseForScopeId(scopeId);
        const nowMs = Date.now();
        const edges = (await this.loadEdges(scopeId))
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.max(1, Math.min(16, limit)));
        const rows = (await this.loadAllRows()).filter((row) => row.scopeId !== scopeId);
        const hits: ScopeVectorHit[] = [];
        for (const edge of edges) {
            const neighborId = edge.fromScopeId === scopeId ? edge.toScopeId : edge.fromScopeId;
            const row = rows.find((item) => item.scopeId === neighborId);
            if (!row) continue;
            hits.push(await this.scoreRow(row, this.embedQuery(scopeId), [scopeId, row.scopeId], nowMs));
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
        // Scope hot memory is an index/materialization plane, not the life
        // ledger. The authoritative turn event remains in brain.db.
        await this.recordHotMemory({
            scopeId,
            requestId: input.context.requestId,
            sourceId: input.context.contextForkId,
            summary: summary.slice(0, 500),
            text: [input.messageText, input.replyText].filter(Boolean).join("\n"),
            symbols,
            importance: input.crystallizedGems && input.crystallizedGems.length > 0 ? 0.8 : 0.6,
            nowMs: input.nowMs,
        });
    }

    private async loadRows(scopeId: string): Promise<ScopeVectorPersistedNode[]> {
        const db = await this.databaseForScopeId(scopeId);
        return db
            .query<ScopeVectorPersistedNode, [string]>(
                `SELECT scope_id AS scopeId, owner_key AS ownerKey, title, goal, summary, embedding_json AS embeddingJson, symbol_json AS symbolJson, updated_at AS updatedAt, last_used_at AS lastUsedAt, use_count AS useCount, codename_id AS codenameId, active FROM scope_vectors WHERE scope_id = ?1`,
            )
            .all(scopeId);
    }

    private async loadSubtreeRows(scopeId: string, limit: number): Promise<ScopeVectorPersistedNode[]> {
        const root = await this.loadRows(scopeId);
        if (root.length === 0) return [];
        const neighborIds = (await this.loadEdges(scopeId))
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.max(0, limit * 2))
            .map((edge) => (edge.fromScopeId === scopeId ? edge.toScopeId : edge.fromScopeId));
        const rows = new Map<string, ScopeVectorPersistedNode>();
        for (const row of root) rows.set(row.scopeId, row);
        for (const neighborId of neighborIds) {
            const row = (await this.loadRows(neighborId))[0];
            if (row) rows.set(row.scopeId, row);
        }
        return [...rows.values()];
    }

    private async loadAllRows(): Promise<ScopeVectorPersistedNode[]> {
        const rows: ScopeVectorPersistedNode[] = [];
        for (const scope of this.brain.listScopes({ limit: 500 })) {
            rows.push(...(await this.loadRows(scope.id)));
        }
        if (rows.length > 0) return rows;
        return this.queryRows(this.requireDefaultDatabase());
    }

    private async loadEdges(scopeId: string): Promise<ScopeVectorEdge[]> {
        const db = await this.databaseForScopeId(scopeId);
        return db
            .query<ScopeVectorEdge, [string]>(
                `SELECT id, from_scope_id AS fromScopeId, to_scope_id AS toScopeId, kind, score, updated_at AS updatedAt FROM scope_vector_edges WHERE from_scope_id = ?1 OR to_scope_id = ?1`,
            )
            .all(scopeId);
    }

    private async scoreRow(
        row: ScopeVectorPersistedNode,
        queryEmbedding: number[],
        querySymbols: string[],
        nowMs: number,
        contextForkId?: string,
    ): Promise<ScopeVectorHit> {
        const hotMemory = this.loadHotMemory(row.scopeId, queryEmbedding, querySymbols, nowMs, 4);
        const hotBoost = Math.min(0.2, hotMemory.reduce((sum, item) => sum + item.importance, 0) / 20);
        const embedding = this.codec.cosine(queryEmbedding, this.parseEmbedding(row.embeddingJson));
        const symbol = this.codec.symbolOverlap(querySymbols, this.parseSymbols(row.symbolJson));
        const activity = this.activityScore(row.lastUsedAt, row.useCount, nowMs);
        const adjacency = this.adjacencyScore(row.scopeId, contextForkId);
        const activeBoost = row.active ? 0.15 : 0;
        const association = this.associationScore(row.scopeId, querySymbols);
        const score = embedding * 0.46 + symbol * 0.16 + association * 0.14 + activity * 0.12 + adjacency * 0.06 + activeBoost + hotBoost;
        return {
            scopeId: row.scopeId,
            score,
            kind: row.active ? "active" : "summary",
            title: row.title,
            goal: row.goal,
            codenameId: row.codenameId,
            relatedIds: (await this.loadEdges(row.scopeId)).map((edge) => (edge.fromScopeId === row.scopeId ? edge.toScopeId : edge.fromScopeId)).slice(0, 8),
            summary: this.renderScopeSummary(row.summary, hotMemory),
            hot: row.active ? true : false,
            evidence: { embedding, symbol: Math.max(symbol, association), activity, adjacency },
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

    private async databaseForScope(scope: ScopeRecord): Promise<Database> {
        return this.openDatabase(this.dbFileForScope(scope));
    }

    private async databaseForScopeId(scopeId: string): Promise<Database> {
        const scope = this.brain.getScope(scopeId);
        if (!scope) return this.openDatabase(this.dbFile);
        return this.databaseForScope(scope);
    }

    private requireDatabaseForScopeId(scopeId: string): Database {
        const scope = this.brain.getScope(scopeId);
        const dbFile = scope ? this.dbFileForScope(scope) : this.dbFile;
        const db = this.databases.get(dbFile);
        if (!db) {
            throw new Error("ScopeVectorComponent is not initialized.");
        }
        return db;
    }

    private requireDefaultDatabase(): Database {
        const db = this.databases.get(this.dbFile);
        if (!db) {
            throw new Error("ScopeVectorComponent is not initialized.");
        }
        return db;
    }

    private dbFileForScope(scope: ScopeRecord): string {
        if (this.dbFile !== join(this.paths.projectFlyflorDir, "scope.db")) return this.dbFile;
        return join(scope.projectDir, ".flyflor", "scope.db");
    }

    private async upsertScopeRow(database: Database, scope: ScopeRecord, nowMs: number): Promise<void> {
        const codename = this.brain.listCodenames({ limit: 100 }).find((row) => row.scopeId === scope.id) ?? null;
        const summary = this.buildScopeSummary(scope, codename);
        const symbols = this.buildScopeSymbols(scope, codename);
        const node: ScopeVectorPersistedNode = {
            scopeId: scope.id,
            ownerKey: `scope:${scope.id}`,
            title: scope.title,
            goal: scope.goal,
            summary,
            embeddingJson: JSON.stringify(this.codec.embedScopeText({ scope, codename, summary, symbols }, this.dimensions)),
            symbolJson: JSON.stringify(symbols),
            updatedAt: nowMs,
            lastUsedAt: scope.lastUsedAt,
            useCount: scope.useCount,
            codenameId: codename?.id,
            active: 1,
        };
        database
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
        await this.upsertTreeNode({
            scopeId: scope.id,
            id: `${scope.id}:root`,
            kind: "root",
            title: scope.title,
            summary,
            symbols,
            score: 1,
            depth: 0,
            nowMs,
        }, database);
    }

    private async upsertTreeNode(input: ScopeTreeNodeInput, database: Database): Promise<void> {
        const nowMs = input.nowMs ?? Date.now();
        const symbols = this.codec.normalizeSymbols(input.symbols ?? [input.title, input.summary]);
        const embedding = this.codec.embedText([input.title, input.summary, ...symbols].join(" "), this.dimensions);
        database
            .prepare(
                `INSERT OR REPLACE INTO scope_tree_nodes (
                    id, scope_id, parent_id, kind, title, summary, embedding_json, symbol_json,
                    score, depth, source_id, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                input.id ?? `${input.scopeId}:${input.kind}:${crypto.randomUUID()}`,
                input.scopeId,
                input.parentId ?? null,
                input.kind,
                input.title,
                input.summary,
                JSON.stringify(embedding),
                JSON.stringify(symbols),
                input.score ?? 0.5,
                input.depth ?? 1,
                input.sourceId ?? null,
                nowMs,
            );
    }

    private upsertAssociations(
        database: Database,
        scopeId: string,
        symbols: string[],
        kind: string,
        sourceId: string,
        nowMs: number,
        weight: number,
    ): void {
        for (const term of this.codec.normalizeSymbols(symbols).slice(0, 64)) {
            database
                .prepare(
                    `INSERT OR REPLACE INTO scope_associations (
                        id, scope_id, term, kind, weight, source_id, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(`${scopeId}:${kind}:${term}:${sourceId}`, scopeId, term, kind, weight, sourceId, nowMs);
        }
    }

    private queryRows(db: Database): ScopeVectorPersistedNode[] {
        return db
            .query<ScopeVectorPersistedNode, []>(
                `SELECT scope_id AS scopeId, owner_key AS ownerKey, title, goal, summary, embedding_json AS embeddingJson, symbol_json AS symbolJson, updated_at AS updatedAt, last_used_at AS lastUsedAt, use_count AS useCount, codename_id AS codenameId, active FROM scope_vectors`,
            )
            .all();
    }

    private loadHotMemory(
        scopeId: string,
        queryEmbedding: number[],
        querySymbols: string[],
        nowMs: number,
        limit: number,
    ): ScopeHotMemoryRow[] {
        const db = this.requireDatabaseForScopeId(scopeId);
        const rows = db
            .query<ScopeHotMemoryRow, [string]>(
                `SELECT id, scope_id AS scopeId, summary, text, embedding_json AS embeddingJson, symbol_json AS symbolJson, importance, created_at AS createdAt, updated_at AS updatedAt, source_id AS sourceId, request_id AS requestId FROM scope_hot_memory WHERE scope_id = ?1 ORDER BY importance DESC, updated_at DESC LIMIT 24`,
            )
            .all(scopeId);
        return rows
            .map((row) => ({
                row,
                rank:
                    this.codec.cosine(queryEmbedding, this.parseEmbedding(row.embeddingJson)) * 0.55 +
                    this.codec.symbolOverlap(querySymbols, this.parseSymbols(row.symbolJson)) * 0.25 +
                    this.activityScore(row.updatedAt, Math.round(row.importance * 10), nowMs) * 0.2,
            }))
            .sort((left, right) => right.rank - left.rank)
            .slice(0, limit)
            .map((entry) => entry.row);
    }

    private associationScore(scopeId: string, querySymbols: string[]): number {
        if (querySymbols.length === 0) return 0;
        const db = this.requireDatabaseForScopeId(scopeId);
        const terms = new Set(querySymbols);
        const rows = db
            .query<{ term: string; weight: number }, [string]>(
                `SELECT term, weight FROM scope_associations WHERE scope_id = ?1 ORDER BY weight DESC LIMIT 128`,
            )
            .all(scopeId);
        if (rows.length === 0) return 0;
        const weight = rows.filter((row) => terms.has(row.term)).reduce((sum, row) => sum + row.weight, 0);
        return Math.max(0, Math.min(1, weight / Math.max(1, rows.length)));
    }

    private renderScopeSummary(summary: string, hotMemory: ScopeHotMemoryRow[]): string {
        if (hotMemory.length === 0) return summary;
        const hot = hotMemory.map((row) => `- ${row.summary}`).join("\n");
        return `${summary}\n\nScope hot memory:\n${hot}`;
    }
}

export function useScopeVectorComponent(paths: FlyflorPaths, brain: BrainStore, options: ScopeVectorComponentOptions = {}): ScopeVectorComponent {
    return new ScopeVectorComponent(paths, brain, options);
}
