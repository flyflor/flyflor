import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { Database } from "bun:sqlite";
import { Component, Inject } from "../di";
import { ConfigService } from "../config/config.service";
import type {
  MemoryCheckpoint,
  MemoryCheckpointInput,
  MemoryChunk,
  MemoryArtifact,
  MemoryArtifactInput,
  MemoryClaim,
  MemoryClaimInput,
  MemoryConflict,
  MemoryDecision,
  MemoryDecisionInput,
  MemoryEntity,
  MemoryEntityInput,
  MemoryFact,
  MemoryFactInput,
  MemoryMessage,
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryRelation,
  MemoryRelationInput,
  MemoryRecoveryState,
  MemoryRetrievalTrace,
  MemoryStoreInput,
  MemoryTask,
  MemoryTaskInput,
  MemoryTreeRecallItem,
  MemoryTreeRecallResult,
} from "./memory.types";
import { SqliteVecLoader } from "./sqlite.vec.loader";

/**
 * Owns Flyflor's authoritative no-session memory database.
 *
 * @usage Runtime and tools call this component to persist turns, store memory chunks, and recall context.
 */
@Component()
export class MemoryComponent {
  private db!: Database;
  private vectorEnabled!: boolean;

  @Inject(ConfigService) private configService!: ConfigService;
  @Inject(SqliteVecLoader) private sqliteVecLoader!: SqliteVecLoader;

  public constructor();
  public constructor(configService?: ConfigService, sqliteVecLoader?: SqliteVecLoader);
  public constructor(configService?: ConfigService, sqliteVecLoader?: SqliteVecLoader) {
    if (configService) {
      this.configService = configService;
      this.sqliteVecLoader = sqliteVecLoader ?? new SqliteVecLoader(configService);
      this.initFromConstructor();
    }
  }

  public init(): void {
    if (this.db) return;
    this.initFromConstructor();
  }

  private initFromConstructor(): void {
    const config = this.configService.getConfig();
    const dbPath = this.configService.ensureFileParent(config.paths.memoryDb);
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
   * Initializes all memory tables and vector tables.
   *
   * @returns Nothing.
   * @usage Called once from the constructor and safe to call repeatedly.
   */
  public initialize(): void {
    this.db.exec(readFileSync(this.configService.resolve("./sql/memory-schema.sql"), "utf8"));
    this.ensureToolProtocolColumns();
    if (this.vectorEnabled) {
      this.db.exec("create virtual table if not exists memory_vectors using vec0(embedding float[4])");
    }
  }

  /**
   * Ensures messages table has tool protocol columns for existing databases.
   *
   * @returns Nothing.
   * @usage Called during initialize to migrate old schema without tool_calls_json/tool_call_id.
   */
  private ensureToolProtocolColumns(): void {
    const columns = this.db.query("pragma table_info(messages)").all() as Array<{ readonly name: string }>;
    const columnNames = new Set(columns.map((col) => col.name));
    if (!columnNames.has("tool_calls_json")) {
      this.db.exec("alter table messages add column tool_calls_json text");
    }
    if (!columnNames.has("tool_call_id")) {
      this.db.exec("alter table messages add column tool_call_id text");
    }
  }

  /**
   * Returns whether sqlite-vec was loaded.
   *
   * @returns True when vector search uses sqlite-vec.
   * @usage Scenario tests assert this to report backend evidence.
   */
  public isVectorLoaded(): boolean {
    return this.vectorEnabled;
  }

  /**
   * Rebuilds critical memory indexes from a full-fidelity brain database.
   *
   * @param brainDbPath - Absolute or project-relative path to a monthly `brain.db`.
   * @returns Counts of replayed messages, durable chunks, and structured facts.
   * @usage Disaster recovery can create a fresh `memory.db` and replay audited model-selected facts from `brain.db`.
   */
  public rebuildCriticalIndexesFromBrain(brainDbPath: string): { readonly messages: number; readonly chunks: number; readonly facts: number } {
    const brain = new Database(isAbsolute(brainDbPath) ? brainDbPath : this.configService.resolve(brainDbPath), { readonly: true });
    const rows = brain.query(`
      select id, conversation_id as conversationId, role, content, created_at as createdAt, metadata
      from brain_messages
      order by created_at asc
    `).all() as Array<MemoryMessage & { readonly conversationId: string; readonly metadata: string | null }>;
    for (const row of rows) {
      let toolCalls: MemoryMessage["toolCalls"];
      let toolCallId: string | undefined;
      if (row.metadata) {
        try {
          const meta = JSON.parse(row.metadata);
          toolCalls = meta.toolCalls;
          toolCallId = meta.toolCallId;
        } catch {
          // ignore malformed metadata
        }
      }
      this.appendMessage(row.conversationId, {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
        toolCalls,
        toolCallId,
      });
    }
    const { chunks, facts } = this.replayAuditedMemoryFacts(brain);
    brain.close();
    return { messages: rows.length, chunks, facts };
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
    const toolCallsJson = message.toolCalls ? JSON.stringify(message.toolCalls) : null;
    this.db.query("insert or replace into messages(id, conversation_id, role, content, created_at, tool_calls_json, tool_call_id) values (?, ?, ?, ?, ?, ?, ?)").run(
      message.id,
      conversationId,
      message.role,
      message.content,
      message.createdAt,
      toolCallsJson,
      message.toolCallId ?? null,
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
      select id, role, content, created_at as createdAt, tool_calls_json as toolCallsJson, tool_call_id as toolCallId
      from messages
      where conversation_id = ?
      order by created_at desc
      limit ?
    `).all(conversationId, limit) as Array<Omit<MemoryMessage, "toolCalls"> & { readonly toolCallsJson: string | null; readonly toolCallId: string | null }>;
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
      toolCalls: row.toolCallsJson ? JSON.parse(row.toolCallsJson) : undefined,
      toolCallId: row.toolCallId ?? undefined,
    }));
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
    if (this.vectorEnabled) {
      this.db.query("insert or replace into memory_vectors(rowid, embedding) values (?, vec_f32(?))").run(id, embedding);
    }
    const chunk = { id, sourceKind: input.sourceKind, sourceId: input.sourceId, content: input.content, importance: input.importance ?? 1, createdAt };
    this.upsertRelation({
      fromRef: this.sourceRef(input.sourceKind, input.sourceId),
      toRef: `chunk:${id}`,
      kind: "produced",
      weight: 0.7,
      evidence: this.stringify({ sourceKind: input.sourceKind, sourceId: input.sourceId }),
    });
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
    if (this.shouldSkipRecall(options)) {
      return [];
    }
    return this.treeRecall(query, limit, options).chunks;
  }

  /**
   * Recalls graph-aware memory evidence for one query.
   *
   * @param query - User question or context search text.
   * @param limit - Maximum items per major evidence category.
   * @param options - Recall filters and trace controls.
   * @returns Structured tree recall result with chunks, facts, graph neighbors, and diagnostics.
   * @usage Memory-specific workflows call this when they need explainable fact and graph evidence.
   */
  public treeRecall(query: string, limit: number, options: MemoryRecallOptions = {}): MemoryTreeRecallResult {
    if (this.shouldSkipRecall(options)) {
      return this.emptyTreeRecall(query);
    }
    const queryTokens = this.tokenize(query);
    const chunks = this.rankRecall(query, this.chunkRecallCandidates(query, Math.max(limit * 8, 32), options), options)
      .slice(0, limit);
    const facts = this.rankFacts(queryTokens, Math.max(limit * 4, 24)).slice(0, limit);
    const claims = this.rankClaims(queryTokens, Math.max(limit * 3, 12)).slice(0, limit);
    const decisions = this.rankDecisions(queryTokens, Math.max(limit * 3, 12)).slice(0, limit);
    const tasks = this.rankTasks(queryTokens, Math.max(limit * 3, 12)).slice(0, limit);
    const artifacts = this.rankArtifacts(queryTokens, Math.max(limit * 3, 12)).slice(0, limit);
    const seedRefs = new Set<string>([
      ...chunks.map((item) => `chunk:${item.chunk.id}`),
      ...facts.map((fact) => `fact:${fact.id}`),
      ...claims.map((claim) => `claim:${claim.id}`),
      ...decisions.map((decision) => `decision:${decision.id}`),
      ...tasks.map((task) => `task:${task.id}`),
      ...artifacts.map((artifact) => `artifact:${artifact.id}`),
    ]);
    const matchedEntities = this.rankEntities(queryTokens, Math.max(limit * 3, 12));
    for (const entity of matchedEntities) {
      seedRefs.add(this.entityRef(entity.name));
    }
    const relations = this.neighborRelations(seedRefs, Math.max(limit * 8, 32));
    const graphRefs = new Set<string>(seedRefs);
    for (const relation of relations) {
      graphRefs.add(relation.fromRef);
      graphRefs.add(relation.toRef);
    }
    const entities = this.entitiesForRefs(graphRefs, matchedEntities, limit);
    const graphChunks = this.chunksForRefs(graphRefs)
      .filter((chunk) => !chunks.some((item) => item.chunk.id === chunk.id))
      .map((chunk) => ({
        chunk,
        score: chunk.importance + this.recencyBoost(chunk.createdAt) + 0.75,
        reasons: ["graph-neighborhood", "related-ref"],
      }));
    const combinedChunks = [...chunks, ...graphChunks]
      .sort((a, b) => b.score - a.score || b.chunk.createdAt - a.chunk.createdAt)
      .slice(0, limit);
    const graphFacts = this.factsForRefs(graphRefs)
      .filter((fact) => !facts.some((item) => item.id === fact.id));
    const combinedFacts = [...facts, ...graphFacts].slice(0, limit);
    const conflicts = this.conflictsForFacts(combinedFacts);
    const diagnostics = this.treeDiagnostics(
      combinedChunks,
      combinedFacts,
      relations,
      claims,
      decisions,
      tasks,
      artifacts,
      conflicts,
    );
    const result: MemoryTreeRecallResult = {
      query,
      chunks: combinedChunks,
      facts: combinedFacts,
      entities,
      relations,
      claims,
      decisions,
      tasks,
      artifacts,
      conflicts,
      diagnostics,
    };
    if (options.trace !== false) {
      this.recordRetrievalTrace({
        id: randomUUID(),
        conversationId: options.conversationId,
        query,
        strategy: this.vectorEnabled ? "tree+vector+lexical+fact+graph" : "tree+lexical+fact+graph",
        resultIds: diagnostics.map((item) => item.ref),
        diagnostics: JSON.stringify({
          items: diagnostics,
          conflicts,
          counts: {
            chunks: combinedChunks.length,
            facts: combinedFacts.length,
            entities: entities.length,
            relations: relations.length,
            claims: claims.length,
            decisions: decisions.length,
            tasks: tasks.length,
            artifacts: artifacts.length,
          },
        }),
        createdAt: Date.now(),
      });
    }
    return result;
  }

  /**
   * Deletes one memory chunk and its vector data.
   *
   * @param id - Memory chunk id to delete.
   * @returns True when a chunk row was removed.
   * @usage MemoryForgetTool uses this for real forgetting semantics.
   */
  public forgetChunk(id: number): boolean {
    if (this.vectorEnabled) {
      this.db.query("delete from memory_vectors where rowid = ?").run(id);
    }
    this.db.query("delete from memory_edges where from_id = ? or to_id = ?").run(id, id);
    this.db.query("delete from memory_relations where from_ref = ? or to_ref = ?").run(`chunk:${id}`, `chunk:${id}`);
    const result = this.db.query("delete from memory_chunks where id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * Upserts one named entity in the memory graph.
   *
   * @param input - Entity name and kind.
   * @returns Persisted entity row.
   * @usage Fact extraction and tree recall use entities as graph traversal roots.
   */
  public upsertEntity(input: MemoryEntityInput): MemoryEntity {
    const now = Date.now();
    const existing = this.db.query("select id, created_at as createdAt from memory_entities where name = ?").get(input.name) as Pick<MemoryEntity, "id" | "createdAt"> | null;
    this.db.query(`
      insert into memory_entities(name, kind, created_at)
      values (?, ?, ?)
      on conflict(name) do update set kind = excluded.kind
    `).run(input.name, input.kind, existing?.createdAt ?? now);
    const row = this.db.query("select id, name, kind, created_at as createdAt from memory_entities where name = ?")
      .get(input.name) as MemoryEntity | null;
    if (!row) {
      throw new Error(`failed to upsert memory entity ${input.name}`);
    }
    return row;
  }

  /**
   * Upserts one weighted graph relation between memory references.
   *
   * @param input - Relation endpoints, kind, ranking weight, and evidence.
   * @returns Persisted relation row.
   * @usage Tree recall traverses these relations to include neighboring facts, chunks, and entities.
   */
  public upsertRelation(input: MemoryRelationInput): MemoryRelation {
    const now = Date.now();
    const existing = this.db.query(`
      select id, created_at as createdAt
      from memory_relations
      where from_ref = ? and to_ref = ? and kind = ?
    `).get(input.fromRef, input.toRef, input.kind) as Pick<MemoryRelation, "id" | "createdAt"> | null;
    this.db.query(`
      insert into memory_relations(from_ref, to_ref, kind, weight, evidence, created_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(from_ref, to_ref, kind) do update set
        weight = excluded.weight,
        evidence = excluded.evidence
    `).run(
      input.fromRef,
      input.toRef,
      input.kind,
      input.weight ?? 1,
      input.evidence ?? "",
      existing?.createdAt ?? now,
    );
    const saved = this.db.query("select id from memory_relations where from_ref = ? and to_ref = ? and kind = ?")
      .get(input.fromRef, input.toRef, input.kind) as { readonly id: number } | null;
    const id = existing?.id ?? saved?.id;
    if (id === undefined) {
      throw new Error(`failed to upsert memory relation ${input.fromRef} -> ${input.toRef}`);
    }
    return {
      id,
      fromRef: input.fromRef,
      toRef: input.toRef,
      kind: input.kind,
      weight: input.weight ?? 1,
      evidence: input.evidence ?? "",
      createdAt: existing?.createdAt ?? now,
    };
  }

  /**
   * Links an existing chunk to a named entity.
   *
   * @param chunkId - Memory chunk row id.
   * @param entity - Entity to upsert and link.
   * @param relationKind - Optional relation label.
   * @returns Persisted relation from chunk to entity.
   * @usage Chunk stores can attach raw evidence to graph nodes for tree recall.
   */
  public linkChunkToEntity(chunkId: number, entity: MemoryEntityInput, relationKind = "mentions"): MemoryRelation {
    const savedEntity = this.upsertEntity(entity);
    return this.upsertRelation({
      fromRef: `chunk:${chunkId}`,
      toRef: this.entityRef(savedEntity.name),
      kind: relationKind,
      weight: 1,
      evidence: this.stringify({ chunkId, entity: savedEntity.name }),
    });
  }

  /**
   * Upserts one structured fact into the working memory graph.
   *
   * @param input - Fact namespace, subject, predicate, object, and provenance.
   * @returns Persisted fact.
   * @usage Runtime writes confirmed durable facts here in addition to raw memory chunks.
   */
  public upsertFact(input: MemoryFactInput): MemoryFact {
    const now = Date.now();
    const id = this.factId(input.namespace, input.subject, input.predicate, input.object);
    const existing = this.db.query("select created_at as createdAt from memory_facts where id = ?").get(id) as { readonly createdAt: number } | null;
    this.db.query(`
      insert into memory_facts(id, namespace, subject, predicate, object, confidence, source_kind, source_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        confidence = excluded.confidence,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.namespace,
      input.subject,
      input.predicate,
      input.object,
      input.confidence ?? 1,
      input.sourceKind,
      input.sourceId,
      existing?.createdAt ?? now,
      now,
    );
    const subject = this.upsertEntity({ name: `${input.namespace}:${input.subject}`, kind: "fact-subject" });
    const object = this.upsertEntity({ name: `${input.namespace}:${input.object}`, kind: "fact-object" });
    this.upsertRelation({
      fromRef: this.entityRef(subject.name),
      toRef: this.entityRef(object.name),
      kind: input.predicate,
      weight: input.confidence ?? 1,
      evidence: this.stringify({ factId: id, sourceKind: input.sourceKind, sourceId: input.sourceId }),
    });
    this.upsertRelation({
      fromRef: `fact:${id}`,
      toRef: this.entityRef(subject.name),
      kind: "subject",
      weight: 0.8,
      evidence: this.stringify({ subject: input.subject }),
    });
    this.upsertRelation({
      fromRef: `fact:${id}`,
      toRef: this.entityRef(object.name),
      kind: "object",
      weight: 0.8,
      evidence: this.stringify({ object: input.object }),
    });
    this.upsertRelation({
      fromRef: `fact:${id}`,
      toRef: this.sourceRef(input.sourceKind, input.sourceId),
      kind: "evidence",
      weight: 1,
      evidence: this.stringify({ sourceKind: input.sourceKind, sourceId: input.sourceId }),
    });
    return {
      id,
      namespace: input.namespace,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      confidence: input.confidence ?? 1,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  /**
   * Upserts one durable claim with explicit status.
   *
   * @param input - Claim text, status, evidence, and provenance.
   * @returns Persisted claim.
   * @usage Tree recall keeps uncertain assertions separate from confirmed facts.
   */
  public upsertClaim(input: MemoryClaimInput): MemoryClaim {
    const now = Date.now();
    const id = this.stableId("claim", input.namespace, input.claim);
    const existing = this.db.query("select created_at as createdAt from memory_claims where id = ?").get(id) as { readonly createdAt: number } | null;
    this.db.query(`
      insert into memory_claims(id, namespace, claim, status, evidence, source_kind, source_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        status = excluded.status,
        evidence = excluded.evidence,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        updated_at = excluded.updated_at
    `).run(id, input.namespace, input.claim, input.status, input.evidence ?? "", input.sourceKind, input.sourceId, existing?.createdAt ?? now, now);
    this.upsertRelation({
      fromRef: `claim:${id}`,
      toRef: this.sourceRef(input.sourceKind, input.sourceId),
      kind: "evidence",
      weight: 0.8,
      evidence: input.evidence ?? "",
    });
    return {
      id,
      namespace: input.namespace,
      claim: input.claim,
      status: input.status,
      evidence: input.evidence ?? "",
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  /**
   * Upserts one durable decision and rationale.
   *
   * @param input - Decision text, rationale, status, and provenance.
   * @returns Persisted decision.
   * @usage Tree recall recovers active decisions before raw historical chunks.
   */
  public upsertDecision(input: MemoryDecisionInput): MemoryDecision {
    const now = Date.now();
    const id = this.stableId("decision", input.namespace, input.decision);
    const existing = this.db.query("select created_at as createdAt from memory_decisions where id = ?").get(id) as { readonly createdAt: number } | null;
    const status = input.status ?? "active";
    this.db.query(`
      insert into memory_decisions(id, namespace, decision, rationale, status, source_kind, source_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        rationale = excluded.rationale,
        status = excluded.status,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        updated_at = excluded.updated_at
    `).run(id, input.namespace, input.decision, input.rationale, status, input.sourceKind, input.sourceId, existing?.createdAt ?? now, now);
    this.upsertRelation({
      fromRef: `decision:${id}`,
      toRef: this.sourceRef(input.sourceKind, input.sourceId),
      kind: "evidence",
      weight: 0.9,
      evidence: this.stringify({ rationale: input.rationale }),
    });
    return {
      id,
      namespace: input.namespace,
      decision: input.decision,
      rationale: input.rationale,
      status,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  /**
   * Upserts one durable task.
   *
   * @param input - Task title, status, evidence, and provenance.
   * @returns Persisted task.
   * @usage Recovery and handoff recall use this API for unfinished work.
   */
  public upsertTask(input: MemoryTaskInput): MemoryTask {
    const now = Date.now();
    const id = this.stableId("task", input.namespace, input.title);
    const existing = this.db.query("select created_at as createdAt from memory_tasks where id = ?").get(id) as { readonly createdAt: number } | null;
    this.db.query(`
      insert into memory_tasks(id, namespace, title, status, evidence, source_kind, source_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        status = excluded.status,
        evidence = excluded.evidence,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        updated_at = excluded.updated_at
    `).run(id, input.namespace, input.title, input.status, input.evidence ?? "", input.sourceKind, input.sourceId, existing?.createdAt ?? now, now);
    this.upsertRelation({
      fromRef: `task:${id}`,
      toRef: this.sourceRef(input.sourceKind, input.sourceId),
      kind: "evidence",
      weight: input.status === "done" ? 0.4 : 0.9,
      evidence: input.evidence ?? "",
    });
    return {
      id,
      namespace: input.namespace,
      title: input.title,
      status: input.status,
      evidence: input.evidence ?? "",
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  /**
   * Indexes one artifact reference in working memory.
   *
   * @param input - Artifact kind, path, byte count, metadata, and provenance.
   * @returns Persisted artifact.
   * @usage Tree recall can return artifact evidence without injecting large raw outputs.
   */
  public upsertArtifact(input: MemoryArtifactInput): MemoryArtifact {
    const now = Date.now();
    const id = this.stableId("artifact", input.kind, input.path, input.sourceKind, input.sourceId);
    const metadata = this.stringify(input.metadata ?? {});
    this.db.query(`
      insert into memory_artifacts(id, kind, path, source_kind, source_id, bytes, created_at, metadata)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        kind = excluded.kind,
        path = excluded.path,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        bytes = excluded.bytes,
        metadata = excluded.metadata
    `).run(id, input.kind, input.path, input.sourceKind, input.sourceId, input.bytes, now, metadata);
    this.upsertRelation({
      fromRef: `artifact:${id}`,
      toRef: this.sourceRef(input.sourceKind, input.sourceId),
      kind: "evidence",
      weight: 0.7,
      evidence: metadata,
    });
    return {
      id,
      kind: input.kind,
      path: input.path,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      bytes: input.bytes,
      createdAt: now,
      metadata,
    };
  }

  /**
   * Recalls structured facts using exact and fuzzy query matching.
   *
   * @param query - User question or internal recall query.
   * @param limit - Maximum facts to return.
   * @returns Facts ranked by simple lexical overlap and recency.
   * @usage ContextBuilderService includes these before raw chunks when answering fact questions.
   */
  public recallFacts(query: string, limit: number): readonly MemoryFact[] {
    return this.treeRecall(query, limit, { trace: false }).facts;
  }

  /**
   * Records a retrieval trace for debug, recovery, and audit.
   *
   * @param trace - Retrieval query, strategy, result ids, and diagnostics.
   * @returns Persisted trace.
   * @usage Recall and ContextBuilderService call this so socket debug can explain memory choices.
   */
  public recordRetrievalTrace(trace: MemoryRetrievalTrace): MemoryRetrievalTrace {
    this.db.query(`
      insert or replace into memory_retrieval_traces(id, conversation_id, query, strategy, result_ids, diagnostics, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      trace.id,
      trace.conversationId ?? null,
      trace.query,
      trace.strategy,
      JSON.stringify(trace.resultIds),
      trace.diagnostics,
      trace.createdAt,
    );
    this.pruneRetrievalTraces();
    return trace;
  }

  /**
   * Returns recent retrieval traces for a conversation or all conversations.
   *
   * @param limit - Maximum traces.
   * @param conversationId - Optional conversation id filter.
   * @returns Recent retrieval traces ordered newest first.
   * @usage Socket debug and recovery reports inspect these rows.
   */
  public recentRetrievalTraces(limit: number, conversationId?: string): readonly MemoryRetrievalTrace[] {
    const rows = conversationId
      ? this.db.query(`
        select id, conversation_id as conversationId, query, strategy, result_ids as resultIds, diagnostics, created_at as createdAt
        from memory_retrieval_traces
        where conversation_id = ?
        order by created_at desc
        limit ?
      `).all(conversationId, limit)
      : this.db.query(`
        select id, conversation_id as conversationId, query, strategy, result_ids as resultIds, diagnostics, created_at as createdAt
        from memory_retrieval_traces
        order by created_at desc
        limit ?
      `).all(limit);
    return (rows as Array<Omit<MemoryRetrievalTrace, "resultIds"> & { readonly resultIds: string }>)
      .map((row) => ({
        ...row,
        resultIds: this.parseStringList(row.resultIds),
      }));
  }

  /**
   * Writes durable recovery state into memory.db.
   *
   * @param key - Recovery key such as active-turn or startup-scan.
   * @param state - State label.
   * @param payload - JSON-safe recovery payload.
   * @returns Persisted recovery state.
   * @usage Runtime updates this around critical operations so restart can explain the last known state.
   */
  public setRecoveryState(key: string, state: string, payload: unknown): MemoryRecoveryState {
    const updatedAt = Date.now();
    this.db.query(`
      insert into memory_recovery_state(key, state, payload, updated_at)
      values (?, ?, ?, ?)
      on conflict(key) do update set state = excluded.state, payload = excluded.payload, updated_at = excluded.updated_at
    `).run(key, state, this.stringify(payload), updatedAt);
    return { key, state, payload, updatedAt };
  }

  /**
   * Reads durable recovery state from memory.db.
   *
   * @param key - Recovery key.
   * @returns Recovery state or undefined.
   * @usage Runtime startup combines this with brain.db interrupted work scanning.
   */
  public getRecoveryState(key: string): MemoryRecoveryState | undefined {
    const row = this.db.query(`
      select key, state, payload, updated_at as updatedAt
      from memory_recovery_state
      where key = ?
    `).get(key) as { readonly key: string; readonly state: string; readonly payload: string; readonly updatedAt: number } | null;
    if (!row) {
      return undefined;
    }
    return {
      key: row.key,
      state: row.state,
      payload: this.parseJson(row.payload),
      updatedAt: row.updatedAt,
    };
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
   * Creates an empty tree recall result.
   *
   * @param query - Query that produced no recall.
   * @returns Empty structured recall result.
   * @usage Skip paths keep the public API shape stable.
   */
  private emptyTreeRecall(query: string): MemoryTreeRecallResult {
    return {
      query,
      chunks: [],
      facts: [],
      entities: [],
      relations: [],
      claims: [],
      decisions: [],
      tasks: [],
      artifacts: [],
      conflicts: [],
      diagnostics: [],
    };
  }

  /**
   * Builds chunk recall candidates from lexical, vector, recency, and importance signals.
   *
   * @param query - Current user query.
   * @param limit - Maximum vector candidates to request.
   * @param options - Recall filters.
   * @returns Ranked chunk candidates before graph-neighborhood expansion.
   * @usage `treeRecall` keeps chunk scoring compatible with the old `recall` API.
   */
  private chunkRecallCandidates(query: string, limit: number, options: MemoryRecallOptions): readonly MemoryRecallResult[] {
    const queryTokens = this.tokenize(query);
    const vectorScores = this.vectorChunkScores(query, limit);
    const rows = this.db.query(`
      select id, source_kind as sourceKind, source_id as sourceId, content, importance, created_at as createdAt
      from memory_chunks
      order by created_at desc
      limit 500
    `).all() as MemoryChunk[];
    return rows
      .filter((chunk) => !options.sourceKinds || options.sourceKinds.includes(chunk.sourceKind))
      .map((chunk) => {
        const overlap = this.overlapScore(queryTokens, this.tokenize(chunk.content));
        const vector = vectorScores.get(chunk.id);
        const vectorScore = vector ? vector.score : 0;
        const score = overlap * 2 + vectorScore + chunk.importance + this.recencyBoost(chunk.createdAt);
        const reasons = [
          `lexical=${overlap}`,
          `importance=${chunk.importance.toFixed(2)}`,
          `recency=${this.recencyBoost(chunk.createdAt).toFixed(4)}`,
          ...(vector ? ["vector", `distance=${vector.distance.toFixed(4)}`] : []),
        ];
        return { chunk, score, reasons };
      })
      .filter((item) => item.score > item.chunk.importance || item.chunk.importance >= 2 || vectorScores.has(item.chunk.id))
      .sort((a, b) => b.score - a.score || b.chunk.createdAt - a.chunk.createdAt);
  }

  /**
   * Computes vector search scores for chunks when sqlite-vec is available.
   *
   * @param query - Current user query.
   * @param limit - Maximum vector rows.
   * @returns Map from chunk id to vector score and distance.
   * @usage Hybrid recall treats vector similarity as one signal, not the whole answer.
   */
  private vectorChunkScores(query: string, limit: number): Map<number, { readonly score: number; readonly distance: number }> {
    const scores = new Map<number, { readonly score: number; readonly distance: number }>();
    if (!this.vectorEnabled) {
      return scores;
    }
    const rows = this.db.query(`
      select c.id, v.distance
      from memory_vectors v
      join memory_chunks c on c.id = v.rowid
      where v.embedding match vec_f32(?) and k = ?
      order by v.distance
    `).all(JSON.stringify(this.embed(query)), limit) as Array<{ readonly id: number; readonly distance: number }>;
    for (const row of rows) {
      scores.set(row.id, { score: 1 / (1 + row.distance), distance: row.distance });
    }
    return scores;
  }

  /**
   * Ranks facts by lexical match, confidence, recency, and conflict/current signals.
   *
   * @param queryTokens - Tokenized query.
   * @param limit - Maximum rows to return.
   * @returns Ranked facts.
   * @usage Tree recall prefers current relevant facts over stale unrelated memories.
   */
  private rankFacts(queryTokens: readonly string[], limit: number): readonly MemoryFact[] {
    const wantsCurrent = queryTokens.some((token) => ["current", "latest", "now", "当前", "现在", "最新"].includes(token));
    const rows = this.db.query(`
      select id, namespace, subject, predicate, object, confidence, source_kind as sourceKind, source_id as sourceId, created_at as createdAt, updated_at as updatedAt
      from memory_facts
      order by updated_at desc
      limit 500
    `).all() as MemoryFact[];
    return rows
      .map((fact) => {
        const overlap = this.overlapScore(queryTokens, this.tokenize(`${fact.namespace} ${fact.subject} ${fact.predicate} ${fact.object}`));
        const currentBoost = wantsCurrent ? this.recencyBoost(fact.updatedAt) * 3 : this.recencyBoost(fact.updatedAt);
        return { fact, score: overlap * 3 + fact.confidence + currentBoost };
      })
      .filter((item) => item.score > item.fact.confidence)
      .sort((a, b) => b.score - a.score || b.fact.updatedAt - a.fact.updatedAt)
      .slice(0, limit)
      .map((item) => item.fact);
  }

  /**
   * Ranks entities by lexical overlap.
   *
   * @param queryTokens - Tokenized query.
   * @param limit - Maximum entities.
   * @returns Ranked entities.
   * @usage Tree recall seeds graph traversal from matched entity names.
   */
  private rankEntities(queryTokens: readonly string[], limit: number): readonly MemoryEntity[] {
    const rows = this.db.query("select id, name, kind, created_at as createdAt from memory_entities order by created_at desc limit 500").all() as MemoryEntity[];
    return rows
      .map((entity) => ({ entity, score: this.overlapScore(queryTokens, this.tokenize(`${entity.name} ${entity.kind}`)) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entity.createdAt - a.entity.createdAt)
      .slice(0, limit)
      .map((item) => item.entity);
  }

  /**
   * Ranks claims by lexical overlap, status, and recency.
   *
   * @param queryTokens - Tokenized query.
   * @param limit - Maximum claims.
   * @returns Ranked claims.
   * @usage Tree recall surfaces uncertain assertions separately from facts.
   */
  private rankClaims(queryTokens: readonly string[], limit: number): readonly MemoryClaim[] {
    const rows = this.db.query(`
      select id, namespace, claim, status, evidence, source_kind as sourceKind, source_id as sourceId, created_at as createdAt, updated_at as updatedAt
      from memory_claims
      order by updated_at desc
      limit 300
    `).all() as MemoryClaim[];
    return rows
      .map((claim) => ({ claim, score: this.overlapScore(queryTokens, this.tokenize(`${claim.namespace} ${claim.claim} ${claim.status}`)) + this.recencyBoost(claim.updatedAt) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.claim.updatedAt - a.claim.updatedAt)
      .slice(0, limit)
      .map((item) => item.claim);
  }

  /**
   * Ranks decisions by lexical overlap, active status, and recency.
   *
   * @param queryTokens - Tokenized query.
   * @param limit - Maximum decisions.
   * @returns Ranked decisions.
   * @usage Tree recall gives current project decisions structured context.
   */
  private rankDecisions(queryTokens: readonly string[], limit: number): readonly MemoryDecision[] {
    const rows = this.db.query(`
      select id, namespace, decision, rationale, status, source_kind as sourceKind, source_id as sourceId, created_at as createdAt, updated_at as updatedAt
      from memory_decisions
      order by updated_at desc
      limit 300
    `).all() as MemoryDecision[];
    return rows
      .map((decision) => {
        const statusBoost = decision.status === "active" ? 0.5 : 0;
        return { decision, score: this.overlapScore(queryTokens, this.tokenize(`${decision.namespace} ${decision.decision} ${decision.rationale}`)) + statusBoost + this.recencyBoost(decision.updatedAt) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.decision.updatedAt - a.decision.updatedAt)
      .slice(0, limit)
      .map((item) => item.decision);
  }

  /**
   * Ranks tasks by lexical overlap, open status, and recency.
   *
   * @param queryTokens - Tokenized query.
   * @param limit - Maximum tasks.
   * @returns Ranked tasks.
   * @usage Tree recall keeps unfinished task state visible during recovery.
   */
  private rankTasks(queryTokens: readonly string[], limit: number): readonly MemoryTask[] {
    const rows = this.db.query(`
      select id, namespace, title, status, evidence, source_kind as sourceKind, source_id as sourceId, created_at as createdAt, updated_at as updatedAt
      from memory_tasks
      order by updated_at desc
      limit 300
    `).all() as MemoryTask[];
    return rows
      .map((task) => {
        const statusBoost = task.status === "done" ? 0 : 0.5;
        return { task, score: this.overlapScore(queryTokens, this.tokenize(`${task.namespace} ${task.title} ${task.status}`)) + statusBoost + this.recencyBoost(task.updatedAt) };
      })
      .filter((item) => item.score > 0.5)
      .sort((a, b) => b.score - a.score || b.task.updatedAt - a.task.updatedAt)
      .slice(0, limit)
      .map((item) => item.task);
  }

  /**
   * Ranks artifacts by lexical overlap and recency.
   *
   * @param queryTokens - Tokenized query.
   * @param limit - Maximum artifacts.
   * @returns Ranked artifact references.
   * @usage Tree recall returns artifact references without loading artifact contents.
   */
  private rankArtifacts(queryTokens: readonly string[], limit: number): readonly MemoryArtifact[] {
    const rows = this.db.query(`
      select id, kind, path, source_kind as sourceKind, source_id as sourceId, bytes, created_at as createdAt, metadata
      from memory_artifacts
      order by created_at desc
      limit 300
    `).all() as MemoryArtifact[];
    return rows
      .map((artifact) => ({ artifact, score: this.overlapScore(queryTokens, this.tokenize(`${artifact.kind} ${artifact.path} ${artifact.metadata}`)) + this.recencyBoost(artifact.createdAt) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.artifact.createdAt - a.artifact.createdAt)
      .slice(0, limit)
      .map((item) => item.artifact);
  }

  /**
   * Finds relations adjacent to seed references.
   *
   * @param seedRefs - Starting graph references.
   * @param limit - Maximum relations.
   * @returns Neighboring relations sorted by weight and recency.
   * @usage Tree recall explains how selected evidence is connected.
   */
  private neighborRelations(seedRefs: ReadonlySet<string>, limit: number): readonly MemoryRelation[] {
    if (seedRefs.size === 0) {
      return [];
    }
    const rows = this.db.query(`
      select id, from_ref as fromRef, to_ref as toRef, kind, weight, evidence, created_at as createdAt
      from memory_relations
      order by created_at desc
      limit 1000
    `).all() as MemoryRelation[];
    return rows
      .filter((relation) => seedRefs.has(relation.fromRef) || seedRefs.has(relation.toRef))
      .sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Loads entities referenced by graph refs and combines them with lexical matches.
   *
   * @param refs - Graph references.
   * @param matchedEntities - Entities matched directly by query text.
   * @param limit - Maximum entities.
   * @returns Entities relevant to the tree recall result.
   * @usage Retrieval traces include entities as named graph anchors.
   */
  private entitiesForRefs(refs: ReadonlySet<string>, matchedEntities: readonly MemoryEntity[], limit: number): readonly MemoryEntity[] {
    const names = new Set([...refs].filter((ref) => ref.startsWith("entity:")).map((ref) => ref.slice("entity:".length)));
    const rows = this.db.query("select id, name, kind, created_at as createdAt from memory_entities order by created_at desc limit 500").all() as MemoryEntity[];
    const entities = [...matchedEntities];
    for (const entity of rows) {
      if (names.has(entity.name) && !entities.some((item) => item.id === entity.id)) {
        entities.push(entity);
      }
    }
    return entities.slice(0, limit);
  }

  /**
   * Loads chunks referenced by graph refs.
   *
   * @param refs - Graph references.
   * @returns Referenced chunks.
   * @usage Graph traversal can pull raw evidence chunks adjacent to selected facts.
   */
  private chunksForRefs(refs: ReadonlySet<string>): readonly MemoryChunk[] {
    const ids = new Set([...refs]
      .filter((ref) => ref.startsWith("chunk:"))
      .map((ref) => Number(ref.slice("chunk:".length)))
      .filter((id) => Number.isFinite(id)));
    if (ids.size === 0) {
      return [];
    }
    const rows = this.db.query(`
      select id, source_kind as sourceKind, source_id as sourceId, content, importance, created_at as createdAt
      from memory_chunks
      order by created_at desc
      limit 500
    `).all() as MemoryChunk[];
    return rows.filter((chunk) => ids.has(chunk.id));
  }

  /**
   * Loads facts referenced by graph refs.
   *
   * @param refs - Graph references.
   * @returns Referenced facts.
   * @usage Graph traversal can include fact nodes reached from entities.
   */
  private factsForRefs(refs: ReadonlySet<string>): readonly MemoryFact[] {
    const ids = new Set([...refs].filter((ref) => ref.startsWith("fact:")).map((ref) => ref.slice("fact:".length)));
    if (ids.size === 0) {
      return [];
    }
    const rows = this.db.query(`
      select id, namespace, subject, predicate, object, confidence, source_kind as sourceKind, source_id as sourceId, created_at as createdAt, updated_at as updatedAt
      from memory_facts
      order by updated_at desc
      limit 500
    `).all() as MemoryFact[];
    return rows.filter((fact) => ids.has(fact.id));
  }

  /**
   * Finds conflicting fact groups among selected fact keys.
   *
   * @param selectedFacts - Facts selected for the query.
   * @returns Conflict groups with differing objects.
   * @usage Recall exposes contradictions and stale values for model-side resolution.
   */
  private conflictsForFacts(selectedFacts: readonly MemoryFact[]): readonly MemoryConflict[] {
    const keys = new Set(selectedFacts.map((fact) => [fact.namespace, fact.subject, fact.predicate].join("\0")));
    if (keys.size === 0) {
      return [];
    }
    const rows = this.db.query(`
      select id, namespace, subject, predicate, object, confidence, source_kind as sourceKind, source_id as sourceId, created_at as createdAt, updated_at as updatedAt
      from memory_facts
      order by updated_at desc
      limit 1000
    `).all() as MemoryFact[];
    const groups = new Map<string, MemoryFact[]>();
    for (const fact of rows) {
      const key = [fact.namespace, fact.subject, fact.predicate].join("\0");
      if (!keys.has(key)) {
        continue;
      }
      groups.set(key, [...(groups.get(key) ?? []), fact]);
    }
    return [...groups.entries()]
      .map(([key, facts]) => ({
        key: key.replaceAll("\0", "/"),
        factIds: facts.map((fact) => fact.id),
        objects: [...new Set(facts.map((fact) => fact.object))],
      }))
      .filter((conflict) => conflict.objects.length > 1);
  }

  /**
   * Builds serializable tree recall diagnostics.
   *
   * @param chunks - Selected chunk results.
   * @param facts - Selected facts.
   * @param relations - Traversed relations.
   * @param claims - Selected claims.
   * @param decisions - Selected decisions.
   * @param tasks - Selected tasks.
   * @param artifacts - Selected artifacts.
   * @param conflicts - Selected conflict groups.
   * @returns Ranked diagnostic items for retrieval traces.
   * @usage Socket and brain audit views explain recall choices from these items.
   */
  private treeDiagnostics(
    chunks: readonly MemoryRecallResult[],
    facts: readonly MemoryFact[],
    relations: readonly MemoryRelation[],
    claims: readonly MemoryClaim[],
    decisions: readonly MemoryDecision[],
    tasks: readonly MemoryTask[],
    artifacts: readonly MemoryArtifact[],
    conflicts: readonly MemoryConflict[],
  ): readonly MemoryTreeRecallItem[] {
    return [
      ...chunks.map((item) => ({
        ref: `chunk:${item.chunk.id}`,
        score: item.score,
        reasons: item.reasons ?? [],
        evidenceRefs: [this.sourceRef(item.chunk.sourceKind, item.chunk.sourceId)],
      })),
      ...facts.map((fact) => ({
        ref: `fact:${fact.id}`,
        score: fact.confidence + this.recencyBoost(fact.updatedAt),
        reasons: ["structured-fact", `confidence=${fact.confidence.toFixed(2)}`],
        evidenceRefs: [this.sourceRef(fact.sourceKind, fact.sourceId)],
      })),
      ...relations.map((relation) => ({
        ref: `relation:${relation.id}`,
        score: relation.weight,
        reasons: ["graph-neighborhood", relation.kind],
        evidenceRefs: [relation.fromRef, relation.toRef],
      })),
      ...claims.map((claim) => ({
        ref: `claim:${claim.id}`,
        score: this.recencyBoost(claim.updatedAt),
        reasons: ["claim", claim.status],
        evidenceRefs: [this.sourceRef(claim.sourceKind, claim.sourceId)],
      })),
      ...decisions.map((decision) => ({
        ref: `decision:${decision.id}`,
        score: this.recencyBoost(decision.updatedAt) + (decision.status === "active" ? 0.5 : 0),
        reasons: ["decision", decision.status],
        evidenceRefs: [this.sourceRef(decision.sourceKind, decision.sourceId)],
      })),
      ...tasks.map((task) => ({
        ref: `task:${task.id}`,
        score: this.recencyBoost(task.updatedAt) + (task.status === "done" ? 0 : 0.5),
        reasons: ["task", task.status],
        evidenceRefs: [this.sourceRef(task.sourceKind, task.sourceId)],
      })),
      ...artifacts.map((artifact) => ({
        ref: `artifact:${artifact.id}`,
        score: this.recencyBoost(artifact.createdAt),
        reasons: ["artifact", artifact.kind],
        evidenceRefs: [this.sourceRef(artifact.sourceKind, artifact.sourceId)],
      })),
      ...conflicts.map((conflict) => ({
        ref: `conflict:${conflict.key}`,
        score: conflict.objects.length,
        reasons: ["conflict", `objects=${conflict.objects.length}`],
        evidenceRefs: conflict.factIds.map((id) => `fact:${id}`),
      })),
    ].sort((a, b) => b.score - a.score);
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
   * Checks whether structured recall options disable durable recall.
   *
   * @param options - Recall options supplied by ContextModule.
   * @returns True when the caller explicitly selected no source kinds.
   * @usage Turn decisions gate memory injection before this recall method is called.
   */
  private shouldSkipRecall(options: MemoryRecallOptions): boolean {
    if (options.sourceKinds && options.sourceKinds.length === 0) {
      return true;
    }
    return false;
  }

  /**
   * Replays model-selected durable facts from brain audit events.
   *
   * @param brain - Read-only monthly brain database.
   * @returns Counts of replayed chunks and structured facts.
   * @usage Recovery restores only facts that were already audited as structured runtime decisions.
   */
  private replayAuditedMemoryFacts(brain: Database): { readonly chunks: number; readonly facts: number } {
    const rows = brain.query(`
      select id, payload
      from brain_events
      where type = ?
      order by created_at asc
    `).all("memory.fact.stored") as Array<{ readonly id: number; readonly payload: string }>;
    let chunks = 0;
    let facts = 0;
    for (const row of rows) {
      const payload = this.parseJson(row.payload);
      if (!payload || typeof payload !== "object") {
        continue;
      }
      const record = payload as Record<string, unknown>;
      const sourceKind = typeof record.sourceKind === "string" && record.sourceKind.length > 0
        ? record.sourceKind
        : "brain-replay";
      const sourceId = typeof record.sourceId === "string" && record.sourceId.length > 0
        ? record.sourceId
        : `brain-event:${row.id}`;
      if (typeof record.content === "string" && record.content.length > 0) {
        this.store({
          sourceKind,
          sourceId,
          content: record.content,
          importance: 3,
        });
        chunks += 1;
      }
      const auditedFacts = Array.isArray(record.facts) ? record.facts : [];
      for (const item of auditedFacts) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const fact = item as Record<string, unknown>;
        if (
          typeof fact.namespace !== "string"
          || typeof fact.subject !== "string"
          || typeof fact.predicate !== "string"
          || typeof fact.object !== "string"
        ) {
          continue;
        }
        this.upsertFact({
          namespace: fact.namespace,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          confidence: typeof fact.confidence === "number" ? fact.confidence : 1,
          sourceKind: typeof fact.sourceKind === "string" && fact.sourceKind.length > 0 ? fact.sourceKind : sourceKind,
          sourceId: typeof fact.sourceId === "string" && fact.sourceId.length > 0 ? fact.sourceId : sourceId,
        });
        facts += 1;
      }
    }
    return { chunks, facts };
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
        const overlap = this.overlapScore(queryTokens, this.tokenize(item.chunk.content));
        return {
          chunk: item.chunk,
          score: item.score + overlap,
          reasons: [...(item.reasons ?? []), `rerank-overlap=${overlap}`],
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
    const normalized = text
      .toLowerCase()
      .split(/[^a-z0-9_\-.一-龥]+/u)
      .filter((token) => token.length >= 2);
    const tokens = new Set<string>(normalized);
    const cjkText = text.match(/[一-龥]+/gu)?.join("") ?? "";
    for (let index = 0; index < cjkText.length - 1; index += 1) {
      tokens.add(cjkText.slice(index, index + 2));
    }
    return [...tokens];
  }

  /**
   * Counts query-token overlap with a candidate token list.
   *
   * @param queryTokens - Tokenized query.
   * @param candidateTokens - Tokenized candidate text.
   * @returns Number of shared tokens.
   * @usage Hybrid ranking uses this shared scoring primitive for chunks and structured rows.
   */
  private overlapScore(queryTokens: readonly string[], candidateTokens: readonly string[]): number {
    const candidates = new Set(candidateTokens);
    return queryTokens.reduce((score, token) => score + (candidates.has(token) ? 1 : 0), 0);
  }

  /**
   * Computes a bounded recency boost from a timestamp.
   *
   * @param timestamp - Unix timestamp in milliseconds.
   * @returns Score between near zero and one.
   * @usage Current facts win ties without drowning lexical relevance.
   */
  private recencyBoost(timestamp: number): number {
    const ageHours = Math.max(0, Date.now() - timestamp) / 3_600_000;
    return 1 / (1 + ageHours / 24);
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

  /**
   * Creates a stable fact id from fact identity fields.
   *
   * @param namespace - Fact namespace.
   * @param subject - Fact subject.
   * @param predicate - Fact predicate.
   * @param object - Fact object.
   * @returns Stable sha256-based id.
   * @usage Upsert semantics require deterministic ids across restarts and brain replay.
   */
  private factId(namespace: string, subject: string, predicate: string, object: string): string {
    return this.stableId("fact", namespace, subject, predicate, object);
  }

  /**
   * Creates a stable sha256 id from arbitrary identity parts.
   *
   * @param parts - Identity values.
   * @returns Stable sha256-based id.
   * @usage Graph tables use deterministic ids for idempotent replay.
   */
  private stableId(...parts: readonly string[]): string {
    return createHash("sha256").update(parts.join("\0")).digest("hex");
  }

  /**
   * Builds a graph reference for a source row.
   *
   * @param sourceKind - Source category.
   * @param sourceId - Source id.
   * @returns Graph reference string.
   * @usage Relations store compact references without cross-table foreign keys.
   */
  private sourceRef(sourceKind: string, sourceId: string): string {
    if ((sourceKind === "chunk" || sourceKind === "memory_chunk") && /^\d+$/.test(sourceId)) {
      return `chunk:${sourceId}`;
    }
    return `${sourceKind}:${sourceId}`;
  }

  /**
   * Builds a graph reference for an entity name.
   *
   * @param name - Entity name.
   * @returns Entity graph reference.
   * @usage Graph traversal uses `entity:` prefixes to distinguish named nodes.
   */
  private entityRef(name: string): string {
    return `entity:${name}`;
  }

  /**
   * Deletes old hot retrieval traces after the configured retention count.
   *
   * @returns Nothing.
   * @usage `brain.db` keeps full audit; memory.db only keeps hot traces for debug and context work.
   */
  private pruneRetrievalTraces(): void {
    const max = this.configService.getConfig().memory.maxRetrievalTraces;
    if (max <= 0) {
      return;
    }
    this.db.query(`
      delete from memory_retrieval_traces
      where id in (
        select id from memory_retrieval_traces
        order by created_at desc
        limit -1 offset ?
      )
    `).run(max);
  }

  /**
   * Parses a JSON string list.
   *
   * @param value - Serialized list value.
   * @returns Parsed list.
   * @usage Retrieval traces keep ids as JSON for compact SQLite storage.
   */
  private parseStringList(value: string): readonly string[] {
    const parsed = this.parseJson(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  }

  /**
   * Safely parses JSON payload text.
   *
   * @param value - JSON text.
   * @returns Parsed value or raw text when parsing fails.
   * @usage Recovery payloads and retrieval traces must remain readable even after partial writes.
   */
  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Safely stringifies a memory payload.
   *
   * @param value - Unknown payload.
   * @returns JSON text.
   * @usage Recovery state must not throw on diagnostics that contain non-serializable values.
   */
  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value ?? null);
    } catch (error) {
      return JSON.stringify({ unserializable: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
