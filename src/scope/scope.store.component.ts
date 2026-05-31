import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { Component, Inject } from "../di";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory/memory.component";
import { SqliteVecLoader } from "../memory/sqlite.vec.loader";
import type { MemoryChunk, MemoryRecallResult } from "../memory/memory.types";
import type { ScopeRecord, ScopeInput } from "./scope.types";

/**
 * Describes one keyword match result against a scope record.
 *
 * @property scopeId - Matched scope id.
 * @property codename - Scope codename for display.
 * @property matchedKeywords - Keywords that matched the input text.
 * @usage Returned by {@link ScopeStore.detectKeywords}.
 */
export interface MatchedScope {
  readonly scopeId: string;
  readonly codename: string;
  readonly matchedKeywords: readonly string[];
}

/**
 * Owns the scope persistence database, vector index, and mirror table.
 *
 * @usage ScopeService calls this component to create, query, mirror, and recall scopes.
 */
@Component()
export class ScopeStore {
  private db!: Database;
  private vectorEnabled!: boolean;

  @Inject(ConfigService) private configService!: ConfigService;
  @Inject(SqliteVecLoader) private sqliteVecLoader!: SqliteVecLoader;
  @Inject(MemoryComponent) private memoryComponent!: MemoryComponent;

  public constructor();
  public constructor(configService?: ConfigService, sqliteVecLoader?: SqliteVecLoader, memoryComponent?: MemoryComponent);
  public constructor(configService?: ConfigService, sqliteVecLoader?: SqliteVecLoader, memoryComponent?: MemoryComponent) {
    if (configService) {
      this.configService = configService;
      this.sqliteVecLoader = sqliteVecLoader ?? new SqliteVecLoader(configService);
      this.memoryComponent = memoryComponent ?? new MemoryComponent(configService);
      this.initFromConstructor();
    }
  }

  public init(): void {
    if (this.db) return;
    this.initFromConstructor();
  }

  private initFromConstructor(): void {
    const config = this.configService.getConfig();
    const dbPath = this.configService.ensureFileParent(`${config.paths.scopeDir}/scope.db`);
    if (config.memory.enableSqliteVec) {
      this.sqliteVecLoader.prepare();
    }
    this.db = new Database(dbPath);
    if (config.memory.enableSqliteVec) {
      this.sqliteVecLoader.load(this.db);
    }
    this.vectorEnabled = config.memory.enableSqliteVec;
    this.initialize();
  }

  /**
   * Initializes all scope tables and vector tables.
   *
   * @returns Nothing.
   * @usage Called once from the constructor and safe to call repeatedly.
   */
  public initialize(): void {
    this.db.exec(readFileSync(this.configService.resolve("./sql/scope-schema.sql"), "utf8"));
    if (this.vectorEnabled) {
      this.db.exec("create virtual table if not exists scope_vectors using vec0(embedding float[4])");
    }
  }

  /**
   * Returns whether vector search is enabled.
   *
   * @returns True when sqlite-vec is loaded for scope.db.
   * @usage Diagnostics can assert this flag before calling {@link recallFromScope}.
   */
  public isVectorLoaded(): boolean {
    return this.vectorEnabled;
  }

  /**
   * Creates a new scope record.
   *
   * @param input - Scope definition including name, codename, namespace, keywords, and constitution.
   * @returns Persisted scope record.
   * @usage ScopeService calls this after crystal.ask.answered confirms scope creation.
   */
  public createScope(input: ScopeInput): ScopeRecord {
    const now = Date.now();
    const id = randomUUID();
    const keywordsJson = JSON.stringify(input.keywords);
    this.db.query(`
      insert into scopes(id, name, codename, namespace, keywords, constitution, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      input.name,
      input.codename,
      input.namespace,
      keywordsJson,
      input.constitution,
      now,
      now,
    );
    return {
      id,
      name: input.name,
      codename: input.codename,
      namespace: input.namespace,
      keywords: input.keywords,
      constitution: input.constitution,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Reads one scope record by id.
   *
   * @param id - Scope record id.
   * @returns Scope record or null when not found.
   * @usage ScopeService uses this to validate and read active scopes.
   */
  public getScope(id: string): ScopeRecord | null {
    const row = this.db.query(`
      select id, name, codename, namespace, keywords, constitution, status, created_at as createdAt, updated_at as updatedAt
      from scopes
      where id = ?
    `).get(id) as ScopeRow | null;
    if (!row) {
      return null;
    }
    return this.toScopeRecord(row);
  }

  /**
   * Lists all active (non-archived) scope records.
   *
   * @returns Active scope records ordered by newest updated first.
   * @usage ScopeService and diagnostics enumerate active scopes.
   */
  public listActiveScopes(): readonly ScopeRecord[] {
    const rows = this.db.query(`
      select id, name, codename, namespace, keywords, constitution, status, created_at as createdAt, updated_at as updatedAt
      from scopes
      where status = 'active'
      order by updated_at desc
    `).all() as ScopeRow[];
    return rows.map((row) => this.toScopeRecord(row));
  }

  /**
   * Detects scope keywords in input text and returns matching scopes.
   *
   * Checks every active scope's keywords (case-insensitive) against the
   * supplied text. Returns every scope that has at least one keyword match.
   *
   * @param text - Input text to scan for scope keywords.
   * @returns Matched scopes with their matching keywords.
   * @usage ScopeService calls this on every chat.message to decide activation.
   */
  public detectKeywords(text: string): readonly MatchedScope[] {
    const lowerText = text.toLowerCase();
    const scopes = this.listActiveScopes();
    const matched: MatchedScope[] = [];
    for (const scope of scopes) {
      const matchedKeywords = scope.keywords.filter((keyword) =>
        lowerText.includes(keyword.toLowerCase()),
      );
      if (matchedKeywords.length > 0) {
        matched.push({
          scopeId: scope.id,
          codename: scope.codename,
          matchedKeywords,
        });
      }
    }
    return matched;
  }

  /**
   * Mirrors a memory chunk into a scope's vector index.
   *
   * Reads the chunk content from memory.db, computes its embedding via
   * {@link MemoryComponent.embed}, and stores it in scope_vectors keyed
   * by the original chunk id. Also inserts a mirror tracking row.
   *
   * @param scopeId - Target scope id.
   * @param chunkId - Memory chunk id to mirror.
   * @returns Nothing.
   * @usage ScopeService calls this when a memory.store payload includes scope tags.
   */
  public mirrorChunk(scopeId: string, chunkId: number): void {
    if (!this.vectorEnabled) {
      return;
    }
    const chunk = this.readMemoryChunk(chunkId);
    if (!chunk) {
      return;
    }
    const embedding = JSON.stringify(this.memoryComponent.embed(chunk.content));
    this.db.query("insert or replace into scope_vectors(rowid, embedding) values (?, vec_f32(?))").run(
      chunkId,
      embedding,
    );
    const mirrorId = randomUUID();
    this.db.query("insert or replace into scope_mirrors(id, scope_id, memory_chunk_id, mirrored_at) values (?, ?, ?, ?)").run(
      mirrorId,
      scopeId,
      chunkId,
      Date.now(),
    );
  }

  /**
   * Recalls scope-mirrored chunks relevant to a query.
   *
   * Uses vector search against scope_vectors when vector mode is enabled,
   * then reads the matching chunk content from memory.db.
   *
   * @param scopeId - Scope to recall from.
   * @param query - Natural-language query for semantic search.
   * @param limit - Maximum chunks to return.
   * @returns Ranked memory recall results with scores derived from vector distance.
   * @usage ScopeService returns this to context builders when a scope is active.
   */
  public recallFromScope(
    scopeId: string,
    query: string,
    limit: number,
  ): readonly MemoryRecallResult[] {
    if (!this.vectorEnabled) {
      return [];
    }
    const queryEmbedding = JSON.stringify(this.memoryComponent.embed(query));
    const rows = this.db.query(`
      select v.rowid as chunkId, v.distance
      from scope_vectors v
      join scope_mirrors m on m.memory_chunk_id = v.rowid
      where m.scope_id = ? and v.embedding match vec_f32(?) and k = ?
      order by v.distance
    `).all(scopeId, queryEmbedding, limit) as Array<{ readonly chunkId: number; readonly distance: number }>;

    if (rows.length === 0) {
      return [];
    }

    const chunkIds = rows.map((row) => row.chunkId);
    const chunks = this.readMemoryChunks(chunkIds);
    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    const results: MemoryRecallResult[] = [];
    for (const row of rows) {
      const chunk = chunkMap.get(row.chunkId);
      if (!chunk) {
        continue;
      }
      results.push({
        chunk,
        score: 1 / (1 + row.distance) + chunk.importance,
        reasons: [`scope:${scopeId}`, `distance=${row.distance.toFixed(4)}`],
      });
    }
    return results
      .sort((a, b) => b.score - a.score || b.chunk.createdAt - a.chunk.createdAt)
      .slice(0, limit);
  }

  /**
   * Reads one memory chunk by id from memory.db.
   *
   * @param id - Memory chunk row id.
   * @returns Chunk record or null when not found.
   * @usage Internal helper for {@link mirrorChunk} to get chunk content for embedding.
   */
  private readMemoryChunk(id: number): MemoryChunk | null {
    const db = this.openMemoryDb();
    try {
      return db.query(`
        select id, source_kind as sourceKind, source_id as sourceId, content, importance, created_at as createdAt
        from memory_chunks
        where id = ?
      `).get(id) as MemoryChunk | null;
    } finally {
      db.close();
    }
  }

  /**
   * Reads multiple memory chunks by id from memory.db.
   *
   * @param ids - Memory chunk row ids.
   * @returns Matching chunk records.
   * @usage Internal helper for {@link recallFromScope} to fill chunk data after vector search.
   */
  private readMemoryChunks(ids: readonly number[]): readonly MemoryChunk[] {
    if (ids.length === 0) {
      return [];
    }
    const db = this.openMemoryDb();
    try {
      const placeholders = ids.map(() => "?").join(", ");
      return db.query(`
        select id, source_kind as sourceKind, source_id as sourceId, content, importance, created_at as createdAt
        from memory_chunks
        where id in (${placeholders})
      `).all(...ids) as MemoryChunk[];
    } finally {
      db.close();
    }
  }

  /**
   * Opens a read-only connection to memory.db.
   *
   * @returns Read-only Database handle.
   * @usage Internal helper for cross-database chunk reads.
   */
  private openMemoryDb(): Database {
    const memoryDbPath = this.configService.resolve(
      this.configService.getConfig().paths.memoryDb,
    );
    return new Database(memoryDbPath, { readonly: true });
  }

  /**
   * Converts a raw scope row to a typed ScopeRecord.
   *
   * @param row - Raw scope row from scope.db.
   * @returns Typed scope record with parsed keywords.
   * @usage Internal helper shared by {@link getScope} and {@link listActiveScopes}.
   */
  private toScopeRecord(row: ScopeRow): ScopeRecord {
    return {
      id: row.id,
      name: row.name,
      codename: row.codename,
      namespace: row.namespace,
      keywords: this.parseKeywords(row.keywords),
      constitution: row.constitution,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Parses persisted JSON keywords into a string array.
   *
   * @param value - Raw keywords column value.
   * @returns Parsed keyword array or empty array on failure.
   * @usage Internal helper for robust keyword deserialization.
   */
  private parseKeywords(value: string): readonly string[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
}

/**
 * Describes a raw scope row as returned by scope.db queries.
 *
 * @property id - Scope id.
 * @property name - Human-readable scope name.
 * @property codename - Unique scope codename.
 * @property namespace - Memory namespace prefix.
 * @property keywords - JSON-serialized keyword array.
 * @property constitution - Markdown constitution text.
 * @property status - Scope lifecycle status.
 * @property createdAt - Unix timestamp in milliseconds.
 * @property updatedAt - Unix timestamp in milliseconds.
 * @usage Internal row type before conversion to {@link ScopeRecord}.
 */
interface ScopeRow {
  readonly id: string;
  readonly name: string;
  readonly codename: string;
  readonly namespace: string;
  readonly keywords: string;
  readonly constitution: string;
  readonly status: "active" | "archived";
  readonly createdAt: number;
  readonly updatedAt: number;
}
