import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { Component, Inject } from "../di";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory";
import { SqliteVecLoader } from "../memory/sqlite.vec.loader";
import type { CrystalCandidate, CrystalGem } from "./crystal.types";

// ---------------------------------------------------------------------------
// Internal input types
// ---------------------------------------------------------------------------

/**
 * Input shape accepted by {@link CrystalStore.createCandidate}.
 *
 * @property askContext - Context that triggered the original ASK.
 * @property resolution - User's chosen resolution text.
 */
export interface CrystalCandidateInput {
  readonly askContext: string;
  readonly resolution: string;
}

/**
 * Input shape accepted by {@link CrystalStore.createGem}.
 *
 * @property name - Short Gem name.
 * @property summary - LLM-generated summary of the decision pattern.
 * @property patternKey - Original pattern key from the candidate.
 * @property promptTemplate - Prompt template injectable into model context.
 */
export interface CrystalGemInput {
  readonly name: string;
  readonly summary: string;
  readonly patternKey: string;
  readonly promptTemplate: string;
}

// ---------------------------------------------------------------------------
// CrystalStore
// ---------------------------------------------------------------------------

/**
 * Owns the crystal.db database for crystallization candidates, Gems,
 * vector embeddings, and ASK logs.
 *
 * @usage CrystalService calls this component to persist and query the
 * crystallization lifecycle.
 */
@Component()
export class CrystalStore {
  private db!: Database;
  private vectorEnabled!: boolean;

  @Inject(MemoryComponent)
  private memory!: MemoryComponent;

  @Inject(ConfigService) private configService!: ConfigService;
  @Inject(SqliteVecLoader) private sqliteVecLoader!: SqliteVecLoader;

  public constructor() {}

  public init(): void {
    const config = this.configService.getConfig();
    const dbPath = this.configService.ensureFileParent(config.paths.crystalDb);
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

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initializes all crystal tables, indexes, and the vector virtual table.
   *
   * @returns Nothing.
   * @usage Called once from the constructor and safe to call repeatedly.
   */
  public initialize(): void {
    this.db.exec(readFileSync(this.configService.resolve("./sql/crystal-schema.sql"), "utf8"));
    // Bridge table mapping text gem IDs to integer vec0 rowids.
    this.db.exec(`
      create table if not exists crystal_gem_vector_map (
        id integer primary key autoincrement,
        gem_id text not null,
        foreign key (gem_id) references crystal_gems(id)
      );
    `);
    if (this.vectorEnabled) {
      this.db.exec("create virtual table if not exists crystal_vectors using vec0(embedding float[4])");
    }
  }

  // -----------------------------------------------------------------------
  // Embedding
  // -----------------------------------------------------------------------

  /**
   * Creates a stable small embedding using MemoryComponent.embed when
   * available, falling back to a deterministic local computation.
   *
   * @param text - Text to embed.
   * @returns Four-dimensional normalized vector.
   * @usage Used internally for storing and searching Gem vectors.
   */
  private embedText(text: string): readonly number[] {
    if (this.memory) {
      return this.memory.embed(text);
    }
    // Deterministic fallback matching MemoryComponent.embed semantics.
    const vector = [0, 0, 0, 0];
    for (let index = 0; index < text.length; index += 1) {
      const bucket = index % vector.length;
      vector[bucket] = (vector[bucket] ?? 0) + text.charCodeAt(index) / 255;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => Number((value / norm).toFixed(6)));
  }

  // -----------------------------------------------------------------------
  // Candidates
  // -----------------------------------------------------------------------

  /**
   * Creates a new crystallization candidate from an ASK context and user
   * resolution.
   *
   * @param input - Ask context and user-chosen resolution.
   * @returns Persisted crystal candidate with a stable pattern key.
   * @usage Called by CrystalService after processing a user answer to an ASK.
   */
  public createCandidate(input: CrystalCandidateInput): CrystalCandidate {
    const now = Date.now();
    const candidateId = randomUUID();
    const patternKey = this.derivePatternKey(input.askContext, input.resolution);
    const status = "forming";

    this.db.query(`
      insert into crystal_candidates(id, pattern_key, ask_context, resolution, hit_count, first_hit_at, last_hit_at, status)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(candidateId, patternKey, input.askContext, input.resolution, 1, now, now, status);

    return {
      candidateId,
      patternKey,
      askContext: input.askContext,
      resolution: input.resolution,
      hitCount: 1,
    };
  }

  /**
   * Reinforces an existing candidate by incrementing its hit count.
   *
   * When the candidate does not exist, returns null.
   *
   * @param patternKey - Stable pattern key to reinforce.
   * @returns Updated candidate with incremented hit count, or null.
   * @usage Called by CrystalService when the same pattern is observed again.
   */
  public reinforceCandidate(patternKey: string): CrystalCandidate | null {
    const now = Date.now();
    const existing = this.findCandidateByPattern(patternKey);
    if (!existing) {
      return null;
    }

    const newHitCount = existing.hitCount + 1;
    const newStatus = "ready";

    this.db.query(`
      update crystal_candidates
      set hit_count = ?, last_hit_at = ?, status = ?
      where pattern_key = ?
    `).run(newHitCount, now, newStatus, patternKey);

    return {
      ...existing,
      hitCount: newHitCount,
    };
  }

  /**
   * Finds a crystal candidate by its stable pattern key.
   *
   * @param patternKey - Stable pattern key to look up.
   * @returns Matching candidate or null when not found.
   * @usage Used internally for deduplication and reinforcement checks.
   */
  public findCandidateByPattern(patternKey: string): CrystalCandidate | null {
    const row = this.db.query(`
      select id as candidateId, pattern_key as patternKey, ask_context as askContext, resolution, hit_count as hitCount
      from crystal_candidates
      where pattern_key = ?
    `).get(patternKey) as CrystalCandidate | null;
    return row ?? null;
  }

  /**
   * Lists candidates whose hit count meets or exceeds the given threshold.
   *
   * @param threshold - Minimum hit count for a candidate to be considered ready.
   * @returns Ready candidates ordered by hit count descending.
   * @usage CrystalService calls this to find candidates eligible for Gem elevation.
   */
  public listReadyCandidates(threshold: number): readonly CrystalCandidate[] {
    const rows = this.db.query(`
      select id as candidateId, pattern_key as patternKey, ask_context as askContext, resolution, hit_count as hitCount
      from crystal_candidates
      where hit_count >= ?
      order by hit_count desc
    `).all(threshold) as CrystalCandidate[];
    return rows;
  }

  // -----------------------------------------------------------------------
  // Gems
  // -----------------------------------------------------------------------

  /**
   * Creates a new Gem from a crystallization candidate and stores its vector
   * embedding.
   *
   * @param gem - Gem input with name, summary, pattern key, and prompt template.
   * @returns Persisted crystal gem.
   * @usage Called by CrystalService.elevateToGem when a candidate is elevated.
   */
  public createGem(gem: CrystalGemInput): CrystalGem {
    const now = Date.now();
    const gemId = randomUUID();

    this.db.query(`
      insert into crystal_gems(id, name, summary, pattern_key, prompt_template, confidence, hit_count, last_matched_at, created_at, updated_at, status)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(gemId, gem.name, gem.summary, gem.patternKey, gem.promptTemplate, 0.5, 0, now, now, now, "active");

    if (this.vectorEnabled) {
      const embedding = JSON.stringify(this.embedText(gem.summary));
      const mapResult = this.db.query("insert into crystal_gem_vector_map(gem_id) values (?)").run(gemId);
      const vectorRowId = Number(mapResult.lastInsertRowid);
      this.db.query("insert or replace into crystal_vectors(rowid, embedding) values (?, vec_f32(?))").run(vectorRowId, embedding);
    }

    return {
      gemId,
      name: gem.name,
      summary: gem.summary,
      promptTemplate: gem.promptTemplate,
      patternKey: gem.patternKey,
      confidence: 0.5,
      hitCount: 0,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
  }

  /**
   * Finds a Gem by its unique name.
   *
   * @param name - Gem name to look up.
   * @returns Matching gem or null when not found.
   * @usage Used for deduplication checks before creating a new Gem.
   */
  public findGemByName(name: string): CrystalGem | null {
    const row = this.db.query(`
      select id         as gemId,
             name,
             summary,
             pattern_key     as patternKey,
             prompt_template as promptTemplate,
             confidence,
             hit_count       as hitCount,
             last_matched_at as lastMatchedAt,
             created_at      as createdAt,
             updated_at      as updatedAt,
             status
      from crystal_gems
      where name = ?
    `).get(name) as Record<string, unknown> | null;
    if (!row) {
      return null;
    }
    return this.mapGemRow(row);
  }

  /**
   * Lists all currently active Gems.
   *
   * @returns Active gems ordered by confidence descending.
   * @usage CrystalService.matchGemForIntent narrows its search to active gems.
   */
  public listActiveGems(): readonly CrystalGem[] {
    const rows = this.db.query(`
      select id         as gemId,
             name,
             summary,
             pattern_key     as patternKey,
             prompt_template as promptTemplate,
             confidence,
             hit_count       as hitCount,
             last_matched_at as lastMatchedAt,
             created_at      as createdAt,
             updated_at      as updatedAt,
             status
      from crystal_gems
      where status = 'active'
      order by confidence desc
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapGemRow(row));
  }

  /**
   * Searches Gems by vector embedding using cosine similarity through
   * sqlite-vec.
   *
   * @param embedding - Query embedding vector (typically 4 dimensions).
   * @param limit - Maximum number of results.
   * @returns Ranked gems ordered by vector distance (closest first).
   * @usage CrystalService.matchGemForIntent uses this for semantic Gem matching.
   */
  public searchGemsByVector(embedding: readonly number[], limit: number): readonly CrystalGem[] {
    if (!this.vectorEnabled) {
      return [];
    }
    const rows = this.db.query(`
      select g.id         as gemId,
             g.name,
             g.summary,
             g.pattern_key     as patternKey,
             g.prompt_template as promptTemplate,
             g.confidence,
             g.hit_count       as hitCount,
             g.last_matched_at as lastMatchedAt,
             g.created_at      as createdAt,
             g.updated_at      as updatedAt,
             g.status,
             v.distance
      from crystal_gems g
      join crystal_gem_vector_map m on m.gem_id = g.id
      join crystal_vectors v on v.rowid = m.id
      where v.embedding match vec_f32(?)
        and k = ?
      order by v.distance
    `).all(JSON.stringify(embedding), limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapGemRow(row));
  }

  /**
   * Updates a Gem's confidence score.
   *
   * @param gemId - Gem id to update.
   * @param confidence - New confidence value from 0 to 1.
   * @returns Nothing.
   * @usage Called by CrystalService after user feedback adjusts Gem confidence.
   */
  public updateGemConfidence(gemId: string, confidence: number): void {
    const now = Date.now();
    this.db.query(`
      update crystal_gems
      set confidence = ?, updated_at = ?
      where id = ?
    `).run(Math.max(0, Math.min(1, confidence)), now, gemId);
  }

  /**
   * Marks a Gem as stale.
   *
   * @param gemId - Gem id to mark stale.
   * @returns Nothing.
   * @usage Called by CrystalService when a Gem is no longer producing useful matches.
   */
  public markGemStale(gemId: string): void {
    const now = Date.now();
    this.db.query(`
      update crystal_gems
      set status = 'stale', updated_at = ?
      where id = ?
    `).run(now, gemId);
  }

  // -----------------------------------------------------------------------
  // ASK log
  // -----------------------------------------------------------------------

  /**
   * Logs an ASK-answer pair for audit and pattern learning.
   *
   * @param ask - Serialized ASK payload text.
   * @param answer - Serialized answer payload text.
   * @param turnId - Turn that produced this interaction.
   * @returns Nothing.
   * @usage Called by CrystalService after processing each answer.
   */
  public logAsk(ask: string, answer: string, turnId: string): void {
    const id = randomUUID();
    const now = Date.now();
    this.db.query(`
      insert into crystal_ask_log(id, ask, answer, turn_id, created_at)
      values (?, ?, ?, ?, ?)
    `).run(id, ask, answer, turnId, now);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Derives a stable, deterministic pattern key from the ask context and
   * resolution text.
   *
   * @param askContext - Context that triggered the ASK.
   * @param resolution - User-chosen resolution text.
   * @returns Stable sha256-based pattern key.
   * @usage Called when creating a new candidate for idempotent upsert semantics.
   */
  private derivePatternKey(askContext: string, resolution: string): string {
    return createHash("sha256").update(`${askContext}\0${resolution}`).digest("hex");
  }

  /**
   * Maps a raw database row into a typed CrystalGem.
   *
   * @param row - Raw query result row.
   * @returns Typed CrystalGem.
   * @usage Internal helper for gem queries that share the same column shape.
   */
  private mapGemRow(row: Record<string, unknown>): CrystalGem {
    return {
      gemId: row["gemId"] as string,
      name: row["name"] as string,
      summary: row["summary"] as string,
      patternKey: row["patternKey"] as string,
      promptTemplate: row["promptTemplate"] as string,
      confidence: row["confidence"] as number,
      hitCount: row["hitCount"] as number,
      lastMatchedAt: row["lastMatchedAt"] as number | undefined,
      createdAt: row["createdAt"] as number,
      updatedAt: row["updatedAt"] as number,
      status: row["status"] as "active" | "stale" | "archived",
    };
  }
}
