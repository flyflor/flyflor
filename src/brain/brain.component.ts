import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { Database } from "bun:sqlite";
import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import type {
  BrainEventInput,
  BrainInterruptedTool,
  BrainInterruptedTurn,
  BrainMessageInput,
  BrainRecoveryPointInput,
  BrainRecoveryReport,
  BrainRuntimeSessionInput,
  BrainToolCallInput,
  BrainTurnInput,
} from "./brain.types";

/**
 * Owns Flyflor's monthly full-fidelity biography and audit database.
 *
 * @usage Runtime, tools, memory, socket, and recovery flows call this component to preserve reviewable raw evidence.
 */
@Component()
export class BrainComponent {
  private readonly db: Database;
  private readonly runtimeSessionId = randomUUID();

  public constructor(private readonly configService = new ConfigService()) {
    this.db = new Database(this.currentDatabasePath());
    this.initialize();
    this.recordRuntimeSession({
      id: this.runtimeSessionId,
      startedAt: Date.now(),
      projectRoot: this.configService.getProjectRoot(),
      metadata: {
        provider: this.configService.getConfig().model.provider,
        model: this.configService.getActiveModelName(),
      },
    });
  }

  /**
   * Initializes the monthly brain database schema.
   *
   * @returns Nothing.
   * @usage Called once on construction and safe to call repeatedly.
   */
  public initialize(): void {
    this.db.exec(readFileSync(this.configService.resolve("./sql/brain-schema.sql"), "utf8"));
  }

  /**
   * Returns the local runtime session id.
   *
   * @returns Stable session id for the current process lifetime.
   * @usage AgentRuntimeService writes turns with this id for audit grouping.
   */
  public getRuntimeSessionId(): string {
    return this.runtimeSessionId;
  }

  /**
   * Returns the active monthly brain database path.
   *
   * @returns Absolute path to `YYYY-MM.brain.db`.
   * @usage Tests and debug pages use this for audit evidence.
   */
  public getDatabasePath(): string {
    return this.currentDatabasePath();
  }

  /**
   * Records a runtime session.
   *
   * @param input - Runtime session metadata.
   * @returns Nothing.
   * @usage Constructor calls this once; recovery replay can also seed sessions.
   */
  public recordRuntimeSession(input: BrainRuntimeSessionInput): void {
    this.db.query(`
      insert or ignore into brain_runtime_sessions(id, started_at, project_root, metadata)
      values (?, ?, ?, ?)
    `).run(input.id, input.startedAt, input.projectRoot, this.stringify(input.metadata ?? {}));
  }

  /**
   * Inserts or updates one turn audit row.
   *
   * @param input - Turn lifecycle payload.
   * @returns Nothing.
   * @usage Runtime writes running, completed, failed, and interrupted states through this method.
   */
  public upsertTurn(input: BrainTurnInput): void {
    this.db.query(`
      insert into brain_turns(id, runtime_session_id, conversation_id, status, started_at, completed_at, error, metadata)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        status = excluded.status,
        completed_at = excluded.completed_at,
        error = excluded.error,
        metadata = excluded.metadata
    `).run(
      input.id,
      input.runtimeSessionId,
      input.conversationId,
      input.status,
      input.startedAt,
      input.completedAt ?? null,
      input.error ?? null,
      this.stringify(input.metadata ?? {}),
    );
  }

  /**
   * Records one full visible message.
   *
   * @param input - Message audit payload.
   * @returns Nothing.
   * @usage Runtime stores user, assistant, tool, and visible reasoning summary content without compression.
   */
  public recordMessage(input: BrainMessageInput): void {
    this.db.query(`
      insert or replace into brain_messages(id, turn_id, conversation_id, role, content, visible_reasoning, created_at, metadata)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.turnId,
      input.conversationId,
      input.role,
      input.content,
      input.visibleReasoning ?? null,
      input.createdAt,
      this.stringify(input.metadata ?? {}),
    );
  }

  /**
   * Records one observable event.
   *
   * @param input - Event payload.
   * @returns Nothing.
   * @usage Signal mirroring, context builds, model deltas, memory traces, and recovery flows use this.
   */
  public recordEvent(input: BrainEventInput): void {
    this.db.query(`
      insert into brain_events(turn_id, conversation_id, type, payload, created_at)
      values (?, ?, ?, ?, ?)
    `).run(
      input.turnId ?? null,
      input.conversationId ?? null,
      input.type,
      this.stringify(input.payload),
      input.createdAt ?? Date.now(),
    );
  }

  /**
   * Inserts or updates one audited tool call.
   *
   * @param input - Tool call lifecycle payload.
   * @returns Nothing.
   * @usage Tool execution stores running and completed states here for replay and review.
   */
  public upsertToolCall(input: BrainToolCallInput): void {
    this.db.query(`
      insert into brain_tool_calls(id, turn_id, tool_name, input, status, output, artifact_path, error, started_at, completed_at, metadata)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        status = excluded.status,
        output = excluded.output,
        artifact_path = excluded.artifact_path,
        error = excluded.error,
        completed_at = excluded.completed_at,
        metadata = excluded.metadata
    `).run(
      input.id,
      input.turnId,
      input.toolName,
      this.stringify(input.input),
      input.status,
      input.output ?? null,
      input.artifactPath ?? null,
      input.error ?? null,
      input.startedAt,
      input.completedAt ?? null,
      this.stringify(input.metadata ?? {}),
    );
  }

  /**
   * Records a large artifact reference in the brain database.
   *
   * @param turnId - Optional owning turn id.
   * @param kind - Artifact kind such as model-delta, tool-output, or subagent-log.
   * @param path - Absolute artifact path.
   * @param bytes - Artifact byte count.
   * @param metadata - Optional JSON-safe metadata.
   * @returns Artifact id.
   * @usage Components store raw large data as files and keep references queryable through brain.db.
   */
  public recordArtifact(
    turnId: string | undefined,
    kind: string,
    path: string,
    bytes: number,
    metadata: Record<string, unknown> = {},
  ): string {
    const id = randomUUID();
    this.db.query(`
      insert into brain_artifacts(id, turn_id, kind, path, bytes, created_at, metadata)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(id, turnId ?? null, kind, path, bytes, Date.now(), this.stringify(metadata));
    return id;
  }

  /**
   * Writes raw text into the brain artifact directory and records the reference.
   *
   * @param turnId - Optional owning turn id.
   * @param kind - Artifact kind used in the file name.
   * @param content - Raw text content.
   * @param metadata - Optional JSON-safe metadata.
   * @returns Absolute artifact path.
   * @usage Model deltas, tool output, and sub-agent transcripts use this when payloads are too large for normal context.
   */
  public writeTextArtifact(
    turnId: string | undefined,
    kind: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): string {
    const dir = this.configService.ensureDir(this.configService.getConfig().paths.brainArtifacts);
    const safeKind = kind.replace(/[^a-zA-Z0-9_.-]+/g, "-") || "artifact";
    const path = join(dir, `${Date.now()}-${safeKind}-${randomUUID()}.txt`);
    writeFileSync(path, content, "utf8");
    this.recordArtifact(turnId, safeKind, path, Buffer.byteLength(content), { ...metadata, file: basename(path) });
    return path;
  }

  /**
   * Records one recovery point.
   *
   * @param input - Recovery point payload.
   * @returns Nothing.
   * @usage Runtime writes these around every critical step so restart diagnostics can explain what happened.
   */
  public recordRecoveryPoint(input: BrainRecoveryPointInput): void {
    this.db.query(`
      insert into brain_recovery_points(id, turn_id, conversation_id, state, payload, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.turnId ?? null,
      input.conversationId ?? null,
      input.state,
      this.stringify(input.payload),
      input.createdAt,
    );
  }

  /**
   * Scans the latest monthly database for interrupted work.
   *
   * @returns Recovery report listing running turns and tool calls.
   * @usage Runtime startup emits this report through SignalBus and socket debug.
   */
  public scanRecovery(): BrainRecoveryReport {
    const interruptedTurns = this.db.query(`
      select id, conversation_id as conversationId, started_at as startedAt, status
      from brain_turns
      where status not in ('completed', 'failed', 'interrupted')
      order by started_at desc
      limit 20
    `).all() as BrainInterruptedTurn[];
    const interruptedTools = this.db.query(`
      select id, turn_id as turnId, tool_name as toolName, started_at as startedAt, status
      from brain_tool_calls
      where status not in ('completed', 'failed', 'interrupted')
      order by started_at desc
      limit 20
    `).all() as BrainInterruptedTool[];
    const latestRecovery = this.db.query(`
      select state
      from brain_recovery_points
      order by created_at desc
      limit 1
    `).get() as { readonly state: string } | null;
    return {
      interruptedTurns,
      interruptedTools,
      latestRecoveryState: latestRecovery?.state,
    };
  }

  /**
   * Marks stale running work as interrupted after recovery scanning.
   *
   * @returns Number of affected rows.
   * @usage Startup recovery prevents old running records from being mistaken for active work.
   */
  public markInterruptedWork(): number {
    const now = Date.now();
    const turns = this.db.query(`
      update brain_turns
      set status = 'interrupted', completed_at = ?, error = coalesce(error, 'runtime restarted before completion')
      where status not in ('completed', 'failed', 'interrupted')
    `).run(now).changes;
    const tools = this.db.query(`
      update brain_tool_calls
      set status = 'interrupted', completed_at = ?, error = coalesce(error, 'runtime restarted before completion')
      where status not in ('completed', 'failed', 'interrupted')
    `).run(now).changes;
    return turns + tools;
  }

  /**
   * Resolves the current monthly database path.
   *
   * @returns Absolute database path for the current local month.
   * @usage BrainComponent rotates naturally by creating one database per year-month.
   */
  private currentDatabasePath(): string {
    const date = new Date();
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const dir = this.configService.ensureDir(this.configService.getConfig().paths.brainDir);
    mkdirSync(dir, { recursive: true });
    return join(dir, `${month}.brain.db`);
  }

  /**
   * Safely stringifies a payload for SQLite storage.
   *
   * @param value - Unknown event, metadata, or input payload.
   * @returns JSON string or an explicit unserializable diagnostic.
   * @usage Brain audit must not crash the runtime on circular or unserializable diagnostics.
   */
  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value ?? null);
    } catch (error) {
      return JSON.stringify({
        unserializable: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
