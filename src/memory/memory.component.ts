import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import type { MemoryChunk, MemoryMessage, MemoryRecallResult, MemoryStoreInput } from "./memory.types";
import { SqliteVecLoader } from "./sqlite-vec-loader";

/**
 * Owns Flyflor's authoritative no-session memory database.
 *
 * @usage Runtime and tools call this component to persist turns, store memory chunks, and recall context.
 */
@Component()
export class MemoryComponent {
  private readonly db: Database;
  private readonly vectorLoaded: boolean;

  public constructor(
    private readonly configService = new ConfigService(),
    private readonly sqliteVecLoader = new SqliteVecLoader(configService),
  ) {
    const config = this.configService.getConfig();
    const dbPath = this.configService.ensureFileParent(config.paths.memoryDb);
    if (config.memory.enableSqliteVec) {
      this.sqliteVecLoader.prepare();
    }
    this.db = new Database(dbPath);
    this.vectorLoaded = config.memory.enableSqliteVec ? this.sqliteVecLoader.load(this.db) : false;
    this.initialize();
  }

  /**
   * Initializes all memory tables and vector tables.
   *
   * @returns Nothing.
   * @usage Called once from the constructor and safe to call repeatedly.
   */
  public initialize(): void {
    this.db.exec(readFileSync(this.configService.resolve("./sql/memory-schema.sql"), "utf8"));
    if (this.vectorLoaded) {
      this.db.exec("create virtual table if not exists memory_vectors using vec0(embedding float[4])");
    } else {
      this.db.exec("create table if not exists memory_vectors_fallback (chunk_id integer primary key, embedding text not null)");
    }
  }

  /**
   * Returns whether sqlite-vec was loaded.
   *
   * @returns True when vector search uses sqlite-vec, false when fallback storage is active.
   * @usage Scenario tests assert this to report backend evidence.
   */
  public isVectorLoaded(): boolean {
    return this.vectorLoaded;
  }

  /**
   * Appends a local conversation message.
   *
   * @param conversationId - Local no-session conversation id.
   * @param message - Message to persist.
   * @returns Persisted message.
   * @usage Runtime persists every user and assistant message before/after model work.
   */
  public appendMessage(conversationId: string, message: MemoryMessage): MemoryMessage {
    this.db.query("insert or ignore into conversations(id, title, created_at) values (?, ?, ?)").run(
      conversationId,
      conversationId,
      message.createdAt,
    );
    this.db.query("insert or replace into messages(id, conversation_id, role, content, created_at) values (?, ?, ?, ?, ?)").run(
      message.id,
      conversationId,
      message.role,
      message.content,
      message.createdAt,
    );
    return message;
  }

  /**
   * Lists recent messages for a local conversation.
   *
   * @param conversationId - Local conversation id.
   * @param limit - Maximum number of recent messages.
   * @returns Recent messages ordered oldest to newest.
   * @usage ContextModule preserves recent tail verbatim.
   */
  public recentMessages(conversationId: string, limit: number): readonly MemoryMessage[] {
    const rows = this.db.query(`
      select id, role, content, created_at as createdAt
      from messages
      where conversation_id = ?
      order by created_at desc
      limit ?
    `).all(conversationId, limit) as MemoryMessage[];
    return rows.reverse();
  }

  /**
   * Stores one durable memory chunk and its embedding.
   *
   * @param input - Memory content and provenance.
   * @returns Persisted memory chunk.
   * @usage Runtime and MemoryStoreTool use this for facts worth retaining.
   */
  public store(input: MemoryStoreInput): MemoryChunk {
    const createdAt = Date.now();
    const result = this.db.query("insert into memory_chunks(source_kind, source_id, content, importance, created_at) values (?, ?, ?, ?, ?)").run(
      input.sourceKind,
      input.sourceId,
      input.content,
      input.importance ?? 1,
      createdAt,
    );
    const id = Number(result.lastInsertRowid);
    const embedding = JSON.stringify(this.embed(input.content));
    if (this.vectorLoaded) {
      this.db.query("insert or replace into memory_vectors(rowid, embedding) values (?, vec_f32(?))").run(id, embedding);
    } else {
      this.db.query("insert or replace into memory_vectors_fallback(chunk_id, embedding) values (?, ?)").run(id, embedding);
    }
    const chunk = { id, sourceKind: input.sourceKind, sourceId: input.sourceId, content: input.content, importance: input.importance ?? 1, createdAt };
    this.writeProjection(chunk);
    return chunk;
  }

  /**
   * Recalls relevant memories for a query.
   *
   * @param query - User query or context search text.
   * @param limit - Maximum recall items.
   * @returns Ranked recall results with provenance.
   * @usage ContextModule injects these results into every no-session turn.
   */
  public recall(query: string, limit: number): readonly MemoryRecallResult[] {
    if (this.vectorLoaded) {
      const rows = this.db.query(`
        select c.id, c.source_kind as sourceKind, c.source_id as sourceId, c.content, c.importance, c.created_at as createdAt, v.distance
        from memory_vectors v
        join memory_chunks c on c.id = v.rowid
        where v.embedding match vec_f32(?) and k = ?
        order by v.distance
      `).all(JSON.stringify(this.embed(query)), limit) as Array<MemoryChunk & { distance: number }>;
      return rows.map((row) => ({
        chunk: row,
        score: 1 / (1 + row.distance) + row.importance,
      }));
    }
    const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
    const rows = this.db.query("select id, source_kind as sourceKind, source_id as sourceId, content, importance, created_at as createdAt from memory_chunks order by created_at desc").all() as MemoryChunk[];
    return rows
      .map((chunk) => ({
        chunk,
        score: tokens.reduce((score, token) => score + (chunk.content.toLowerCase().includes(token) ? 1 : 0), chunk.importance),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Creates a stable small embedding suitable for local smoke tests.
   *
   * @param text - Text to embed.
   * @returns Four-dimensional normalized vector.
   * @usage This deterministic adapter keeps scenario tests model-free while sqlite-vec plumbing is exercised.
   */
  public embed(text: string): readonly number[] {
    const vector = [0, 0, 0, 0];
    for (let index = 0; index < text.length; index += 1) {
      const bucket = index % vector.length;
      vector[bucket] = (vector[bucket] ?? 0) + text.charCodeAt(index) / 255;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => Number((value / norm).toFixed(6)));
  }

  /**
   * Writes a Markdown projection for human review.
   *
   * @param chunk - Chunk to project.
   * @returns Nothing.
   * @usage Projection is review-only; runtime recall still reads `memory.db`.
   */
  private writeProjection(chunk: MemoryChunk): void {
    const config = this.configService.getConfig();
    const dir = this.configService.ensureDir(`${config.paths.memoryWiki}/sources`);
    const safeSource = chunk.sourceId.replace(/[^a-zA-Z0-9_.-]+/g, "-");
    writeFileSync(
      join(dir, `${safeSource || "memory"}.md`),
      [`# ${chunk.sourceKind}:${chunk.sourceId}`, "", `- ${chunk.content}`].join("\n"),
      "utf8",
    );
  }
}
