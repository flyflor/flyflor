import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths } from "../../config/index.ts";
import type { ScopeRecord } from "../../protocol/contracts/index.ts";
import type { SocketScopeIndexCounts } from "./types.ts";

export interface ScopeTreeRow {
    id: string;
    scopeId: string;
    parentId?: string;
    kind: string;
    title: string;
    summary: string;
    symbols: string[];
    score: number;
    depth: number;
    sourceId?: string;
    updatedAt: number;
}

export interface ScopeHotMemoryRow {
    id: string;
    scopeId: string;
    summary: string;
    text: string;
    symbols: string[];
    importance: number;
    createdAt: number;
    updatedAt: number;
    sourceId?: string;
    requestId?: string;
}

export interface ScopeAssociationRow {
    id: string;
    scopeId: string;
    term: string;
    kind: string;
    weight: number;
    sourceId?: string;
    updatedAt: number;
}

/**
 * Scope-local scope.db reader.
 *
 * Scope vector data is an index/read model. Socket queries read it directly
 * from each scope `.flyflor/scope.db` and never invoke ScopeVectorComponent.
 */
export class SocketScopeReader {
    public constructor(private readonly paths: FlyflorPaths) {}

    public counts(scope: ScopeRecord): SocketScopeIndexCounts | undefined {
        return this.withDb(scope, (db) => ({
            associations: countTable(db, "scope_associations", scope.id),
            hotMemory: countTable(db, "scope_hot_memory", scope.id),
            treeNodes: countTable(db, "scope_tree_nodes", scope.id),
            vectors: countTable(db, "scope_vectors", scope.id, "scope_id"),
        }));
    }

    public treeNodes(scope: ScopeRecord, limit = 80): ScopeTreeRow[] {
        return this.withDb(scope, (db) =>
            db.query<ScopeTreeNodeDbRow, [string, number]>(
                `SELECT id, scope_id, parent_id, kind, title, summary, symbol_json, score, depth, source_id, updated_at
                   FROM scope_tree_nodes
                  WHERE scope_id = ?1
                  ORDER BY depth ASC, score DESC, updated_at DESC
                  LIMIT ?2`,
            )
                .all(scope.id, boundedLimit(limit))
                .map((row) => ({
                    id: row.id,
                    scopeId: row.scope_id,
                    parentId: row.parent_id ?? undefined,
                    kind: row.kind,
                    title: row.title,
                    summary: row.summary,
                    symbols: parseStringArray(row.symbol_json),
                    score: row.score,
                    depth: row.depth,
                    sourceId: row.source_id ?? undefined,
                    updatedAt: row.updated_at,
                })),
        ) ?? [];
    }

    public hotMemory(scope: ScopeRecord, limit = 40): ScopeHotMemoryRow[] {
        return this.withDb(scope, (db) =>
            db.query<ScopeHotMemoryDbRow, [string, number]>(
                `SELECT id, scope_id, summary, text, symbol_json, importance, created_at, updated_at, source_id, request_id
                   FROM scope_hot_memory
                  WHERE scope_id = ?1
                  ORDER BY importance DESC, updated_at DESC
                  LIMIT ?2`,
            )
                .all(scope.id, boundedLimit(limit))
                .map((row) => ({
                    id: row.id,
                    scopeId: row.scope_id,
                    summary: row.summary,
                    text: row.text,
                    symbols: parseStringArray(row.symbol_json),
                    importance: row.importance,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    sourceId: row.source_id ?? undefined,
                    requestId: row.request_id ?? undefined,
                })),
        ) ?? [];
    }

    public associations(scope: ScopeRecord, limit = 80): ScopeAssociationRow[] {
        return this.withDb(scope, (db) =>
            db.query<ScopeAssociationDbRow, [string, number]>(
                `SELECT id, scope_id, term, kind, weight, source_id, updated_at
                   FROM scope_associations
                  WHERE scope_id = ?1
                  ORDER BY weight DESC, updated_at DESC
                  LIMIT ?2`,
            )
                .all(scope.id, boundedLimit(limit))
                .map((row) => ({
                    id: row.id,
                    scopeId: row.scope_id,
                    term: row.term,
                    kind: row.kind,
                    weight: row.weight,
                    sourceId: row.source_id ?? undefined,
                    updatedAt: row.updated_at,
                })),
        ) ?? [];
    }

    private withDb<T>(scope: ScopeRecord, reader: (db: Database) => T): T | undefined {
        const dbPath = this.scopeDbPath(scope);
        if (!existsSync(dbPath)) return undefined;
        const db = new Database(dbPath, { readonly: true });
        try {
            return reader(db);
        } finally {
            db.close();
        }
    }

    private scopeDbPath(scope: ScopeRecord): string {
        const scopeLocal = join(scope.projectDir, ".flyflor", "scope.db");
        if (existsSync(scopeLocal)) return scopeLocal;
        const memoryLocal = join(scope.projectMemoryDir, "scope.db");
        if (existsSync(memoryLocal)) return memoryLocal;
        return join(this.paths.projectFlyflorDir, "scope.db");
    }
}

interface ScopeTreeNodeDbRow {
    depth: number;
    id: string;
    kind: string;
    parent_id: string | null;
    scope_id: string;
    score: number;
    source_id: string | null;
    summary: string;
    symbol_json: string;
    title: string;
    updated_at: number;
}

interface ScopeHotMemoryDbRow {
    created_at: number;
    id: string;
    importance: number;
    request_id: string | null;
    scope_id: string;
    source_id: string | null;
    summary: string;
    symbol_json: string;
    text: string;
    updated_at: number;
}

interface ScopeAssociationDbRow {
    id: string;
    kind: string;
    scope_id: string;
    source_id: string | null;
    term: string;
    updated_at: number;
    weight: number;
}

function countTable(db: Database, table: string, scopeId: string, column = "scope_id"): number {
    if (!hasTable(db, table)) return 0;
    const row = db.query<{ count: number }, [string]>(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?1`).get(scopeId);
    return row?.count ?? 0;
}

function hasTable(db: Database, table: string): boolean {
    const row = db
        .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
        .get(table);
    return Boolean(row);
}

function parseStringArray(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function boundedLimit(limit: number): number {
    return Math.max(1, Math.min(200, Math.floor(limit)));
}
