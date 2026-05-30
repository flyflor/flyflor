import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import type { MemoryCheckpoint, MemoryCheckpointInput, MemoryChunk, MemoryMessage, MemoryRecallOptions, MemoryRecallResult, MemoryStoreInput } from "./memory.types";
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
  public recall(query: string, limit: number, options: MemoryRecallOptions = {}): readonly MemoryRecallResult[] {
    if (this.shouldSkipRecall(query, options)) {
      return [];
    }
    if (this.vectorLoaded) {
      const rows = this.db.query(`
        select c.id, c.source_kind as sourceKind, c.source_id as sourceId, c.content, c.importance, c.created_at as createdAt, v.distance
        from memory_vectors v
        join memory_chunks c on c.id = v.rowid
        where v.embedding match vec_f32(?) and k = ?
        order by v.distance
      `).all(JSON.stringify(this.embed(query)), limit) as Array<MemoryChunk & { distance: number }>;
      return this.rankRecall(query, rows.map((row) => ({
        chunk: row,
        score: 1 / (1 + row.distance) + row.importance,
      })), options).slice(0, limit);
    }
    const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
    const rows = this.db.query("select id, source_kind as sourceKind, source_id as sourceId, content, importance, created_at as createdAt from memory_chunks order by created_at desc").all() as MemoryChunk[];
    return [...this.rankRecall(query, rows
      .map((chunk) => ({
        chunk,
        score: tokens.reduce((score, token) => score + (chunk.content.toLowerCase().includes(token) ? 1 : 0), chunk.importance),
      }))
      .filter((item) => item.score > 0), options)]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Deletes one memory chunk and its vector data.
   *
   * @param id - Memory chunk id to delete.
   * @returns True when a chunk row was removed.
   * @usage MemoryForgetTool uses this for real first-phase forgetting semantics.
   */
  public forgetChunk(id: number): boolean {
    if (this.vectorLoaded) {
      this.db.query("delete from memory_vectors where rowid = ?").run(id);
    } else {
      this.db.query("delete from memory_vectors_fallback where chunk_id = ?").run(id);
    }
    this.db.query("delete from memory_edges where from_id = ? or to_id = ?").run(id, id);
    const result = this.db.query("delete from memory_chunks where id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * Stores one context checkpoint.
   *
   * @param input - Checkpoint summary and source message ids.
   * @returns Persisted checkpoint.
   * @usage ContextCompactTool writes compacted conversation state through this method.
   */
  public storeCheckpoint(input: MemoryCheckpointInput): MemoryCheckpoint {
    const checkpoint: MemoryCheckpoint = {
      id: randomUUID(),
      conversationId: input.conversationId,
      summary: input.summary,
      sourceMessageIds: input.sourceMessageIds,
      createdAt: Date.now(),
    };
    this.db.query("insert into context_checkpoints(id, conversation_id, summary, created_at) values (?, ?, ?, ?)").run(
      checkpoint.id,
      checkpoint.conversationId,
      JSON.stringify({ summary: checkpoint.summary, sourceMessageIds: checkpoint.sourceMessageIds }),
      checkpoint.createdAt,
    );
    return checkpoint;
  }

  /**
   * Reads the latest context checkpoint for one conversation.
   *
   * @param conversationId - Local conversation id.
   * @returns Latest checkpoint or undefined when none exists.
   * @usage ContextBuilderService injects this before recent tail messages.
   */
  public latestCheckpoint(conversationId: string): MemoryCheckpoint | undefined {
    const row = this.db.query(`
      select id, conversation_id as conversationId, summary, created_at as createdAt
      from context_checkpoints
      where conversation_id = ?
      order by created_at desc
      limit 1
    `).get(conversationId) as { readonly id: string; readonly conversationId: string; readonly summary: string; readonly createdAt: number } | null;
    if (!row) {
      return undefined;
    }
    const parsed = this.parseCheckpointSummary(row.summary);
    return {
      id: row.id,
      conversationId: row.conversationId,
      summary: parsed.summary,
      sourceMessageIds: parsed.sourceMessageIds,
      createdAt: row.createdAt,
    };
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

  /**
   * Parses persisted checkpoint summary payloads.
   *
   * @param value - Raw DB summary value.
   * @returns Summary text and source message ids.
   * @usage Maintains compatibility if older rows stored plain summary text.
   */
  private parseCheckpointSummary(value: string): { readonly summary: string; readonly sourceMessageIds: readonly string[] } {
    try {
      const parsed = JSON.parse(value) as Partial<{ readonly summary: string; readonly sourceMessageIds: readonly string[] }>;
      return {
        summary: parsed.summary ?? value,
        sourceMessageIds: parsed.sourceMessageIds ?? [],
      };
    } catch {
      return { summary: value, sourceMessageIds: [] };
    }
  }

  /**
   * Checks whether a query should avoid durable recall entirely.
   *
   * @param query - Current user query.
   * @param options - Recall options supplied by ContextModule.
   * @returns True when durable recall would likely pollute the answer.
   * @usage Project/code reading should start from tools and recent context, not unrelated user facts.
   */
  private shouldSkipRecall(query: string, options: MemoryRecallOptions): boolean {
    if (options.sourceKinds && options.sourceKinds.length === 0) {
      return true;
    }
    return /(仔细阅读|阅读这个项目|分析这个项目|看看这个项目|read this project|analyze this project|codebase)/i.test(query);
  }

  /**
   * Filters and reranks raw recall results against the question text.
   *
   * @param query - Current user query.
   * @param results - Raw vector or lexical recall results.
   * @param options - Recall options supplied by ContextModule.
   * @returns Filtered and reranked recall results.
   * @usage Prevents question chunks and unrelated source kinds from entering model context.
   */
  private rankRecall(
    query: string,
    results: readonly MemoryRecallResult[],
    options: MemoryRecallOptions,
  ): readonly MemoryRecallResult[] {
    const queryTokens = this.tokenize(query);
    return results
      .filter((item) => !options.sourceKinds || options.sourceKinds.includes(item.chunk.sourceKind))
      .filter((item) => !options.excludeQuestionLike || !this.isQuestionLike(item.chunk.content))
      .map((item) => {
        const overlap = this.tokenize(item.chunk.content).filter((token) => queryTokens.includes(token)).length;
        return {
          chunk: item.chunk,
          score: item.score + overlap,
        };
      })
      .filter((item) => item.score >= 1)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Tokenizes mixed Chinese/English text for lightweight recall reranking.
   *
   * @param text - Text to tokenize.
   * @returns Lowercase token list.
   * @usage Avoids adding a heavy tokenizer while making recall question-aware.
   */
  private tokenize(text: string): readonly string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9_\-.一-龥]+/u)
      .filter((token) => token.length >= 2);
  }

  /**
   * Detects whether text is a user question rather than a durable fact.
   *
   * @param text - Memory chunk content.
   * @returns True when the content looks question-like.
   * @usage Recall filters avoid injecting prior questions as if they were facts.
   */
  private isQuestionLike(text: string): boolean {
    return /[?？]|是什么|为什么|怎么|如何|吗\b|呢\b/.test(text);
  }
}
