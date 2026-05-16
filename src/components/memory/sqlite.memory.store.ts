import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths, SQLiteMemoryConfig } from "../../config/index.ts";
import { MemoryCandidateStatus, MemoryKind, MemoryLayer } from "../../protocol/contracts/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { SQLiteComponent } from "../base.component.ts";
import type { MemoryCandidate, MemoryRecord, MemorySearchRequest, MemorySearchResult } from "./types.ts";

interface MemoryRow {
    id: string;
    kind: string;
    content: string;
    scope: string;
    subject_id?: string;
    channel?: string;
    chat_id?: string;
    importance: number;
    confidence: number;
    created_at: string;
    updated_at: string;
    metadata_json?: string;
    rank?: number;
}

interface ExistingMemoryRow {
    id: string;
    created_at: string;
}

@Component()
export class SQLiteMemoryStore extends SQLiteComponent {
    private database?: Database;

    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly config: SQLiteMemoryConfig,
    ) {
        super();
    }

    public async initialize(): Promise<void> {
        if (!this.config.enabled || this.database) {
            return;
        }

        await mkdir(this.paths.memoryDir, { recursive: true });
        let database = openMemoryDatabase(join(this.paths.memoryDir, "memory.sqlite"));
        if (hasIncompatibleMemorySchema(database)) {
            database.close();
            database = openMemoryDatabase(join(this.paths.memoryDir, "memory.project.sqlite"));
        }
        database.exec(`
            CREATE TABLE IF NOT EXISTS memory_candidates (
                id TEXT PRIMARY KEY,
                target_file TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                content TEXT NOT NULL,
                project_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_message_id TEXT,
                source_reply_id TEXT,
                created_at TEXT NOT NULL,
                promoted_at TEXT,
                weights_json TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                scope TEXT NOT NULL,
                subject_id TEXT,
                channel TEXT,
                chat_id TEXT,
                importance REAL NOT NULL DEFAULT 0.5,
                confidence REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                id UNINDEXED,
                content,
                tokenize = 'unicode61'
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS pending_project_offer (
                user_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                trigger_kind TEXT NOT NULL,
                evidence_score REAL NOT NULL,
                related_ids_json TEXT NOT NULL,
                proposed_at TEXT NOT NULL,
                ttl_turns INTEGER NOT NULL
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS pending_skill_offer (
                user_id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                summary TEXT NOT NULL,
                support INTEGER NOT NULL,
                confidence REAL NOT NULL,
                mcp_tools_json TEXT NOT NULL,
                related_ids_json TEXT NOT NULL,
                proposed_at TEXT NOT NULL,
                ttl_turns INTEGER NOT NULL
            );
        `);
        database.exec("CREATE INDEX IF NOT EXISTS idx_candidates_status ON memory_candidates(status, created_at)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_memories_scope_updated ON memories(scope, updated_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(subject_id, updated_at DESC)");
        this.database = database;
    }

    public async addCandidate(candidate: MemoryCandidate): Promise<void> {
        await this.initialize();
        if (!this.database) {
            return;
        }
        this.database
            .query(
                `
                INSERT INTO memory_candidates (
                    id, target_file, kind, status, source_kind, content, project_id, source_id,
                    source_message_id, source_reply_id, created_at, promoted_at, weights_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                candidate.id,
                candidate.targetFile,
                candidate.kind,
                candidate.status,
                candidate.sourceKind,
                candidate.content,
                candidate.projectId,
                candidate.sourceId,
                candidate.sourceMessageId ?? null,
                candidate.sourceReplyId ?? null,
                candidate.createdAt,
                candidate.promotedAt ?? null,
                JSON.stringify(candidate.weights),
                JSON.stringify(candidate.metadata ?? {}),
            );
    }

    public async markCandidatePromoted(candidateId: string, promotedAt: string): Promise<void> {
        await this.initialize();
        this.database
            ?.query("UPDATE memory_candidates SET status = ?, promoted_at = ? WHERE id = ?")
            .run(MemoryCandidateStatus.Promoted, promotedAt, candidateId);
    }

    public async addSearchRecord(record: MemoryRecord): Promise<void> {
        await this.initialize();
        this.insertMemoryRecord(record);
    }

    public async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        await this.initialize();
        if (!this.database) {
            return [];
        }

        const match = toFtsQuery(request.query);
        const limit = Math.min(Math.max(request.limit, 1), this.config.maxPromptItems);
        const rows = match ? this.searchFts(match, request, limit) : this.searchRecent(request, limit);
        return rows.map((row) => {
            const record = rowToMemory(row);
            const baseScore = row.rank !== undefined ? 1 / (1 + Math.abs(row.rank)) : 0.5;
            return {
                layer: MemoryLayer.SQLite,
                score: scoreWithMemoryMatrix(baseScore, record),
                record,
            };
        });
    }

    private insertMemoryRecord(record: MemoryRecord): void {
        if (!this.database) {
            return;
        }
        const existing = this.database
            .query("SELECT id, created_at FROM memories WHERE scope = ? AND content = ? LIMIT 1")
            .get(record.scope, record.content) as ExistingMemoryRow | null;
        const storedRecord = existing
            ? {
                  ...record,
                  id: existing.id,
                  createdAt: existing.created_at,
              }
            : record;

        this.database
            .query(
                `
                INSERT OR REPLACE INTO memories (
                    id, kind, content, scope, subject_id, channel, chat_id,
                    importance, confidence, created_at, updated_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                storedRecord.id,
                storedRecord.kind,
                storedRecord.content,
                storedRecord.scope,
                storedRecord.subjectId ?? null,
                storedRecord.channel ?? null,
                storedRecord.chatId ?? null,
                storedRecord.importance,
                storedRecord.confidence,
                storedRecord.createdAt,
                storedRecord.updatedAt,
                JSON.stringify(storedRecord.metadata ?? {}),
            );
        this.database.query("DELETE FROM memories_fts WHERE id = ?").run(storedRecord.id);
        this.database
            .query("INSERT INTO memories_fts(id, content) VALUES (?, ?)")
            .run(storedRecord.id, storedRecord.content);
    }

    private searchFts(match: string, request: MemorySearchRequest, limit: number): MemoryRow[] {
        if (!this.database) {
            return [];
        }
        return this.database
            .query(
                `
                SELECT memories.*, bm25(memories_fts) AS rank
                FROM memories_fts
                JOIN memories ON memories.id = memories_fts.id
                WHERE memories_fts MATCH ?
                  AND memories.scope IN (?, 'global')
                  AND (? IS NULL OR memories.subject_id IS NULL OR memories.subject_id = ?)
                ORDER BY rank ASC, memories.updated_at DESC
                LIMIT ?
            `,
            )
            .all(match, request.scope, request.subjectId ?? null, request.subjectId ?? null, limit) as MemoryRow[];
    }

    private searchRecent(request: MemorySearchRequest, limit: number): MemoryRow[] {
        if (!this.database) {
            return [];
        }
        return this.database
            .query(
                `
                SELECT *
                FROM memories
                WHERE scope IN (?, 'global')
                  AND (? IS NULL OR subject_id IS NULL OR subject_id = ?)
                ORDER BY updated_at DESC
                LIMIT ?
            `,
            )
            .all(request.scope, request.subjectId ?? null, request.subjectId ?? null, limit) as MemoryRow[];
    }

    /** 持久化一个待用户确认的项目候选（每 userId 最多一条；存在则覆盖）。 */
    public async upsertProjectOffer(offer: PendingProjectOffer): Promise<void> {
        await this.initialize();
        if (!this.database) return;
        this.database
            .prepare(
                `INSERT INTO pending_project_offer (user_id, project_id, title, goal, trigger_kind, evidence_score, related_ids_json, proposed_at, ttl_turns)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET project_id=excluded.project_id, title=excluded.title, goal=excluded.goal,
                    trigger_kind=excluded.trigger_kind, evidence_score=excluded.evidence_score,
                    related_ids_json=excluded.related_ids_json, proposed_at=excluded.proposed_at, ttl_turns=excluded.ttl_turns`,
            )
            .run(
                offer.userId,
                offer.projectId,
                offer.title,
                offer.goal,
                offer.triggerKind,
                offer.evidenceScore,
                JSON.stringify(offer.relatedIds),
                offer.proposedAt,
                offer.ttlTurns,
            );
    }

    public async getProjectOffer(userId: string): Promise<PendingProjectOffer | undefined> {
        await this.initialize();
        if (!this.database) return undefined;
        const row = this.database
            .prepare(
                `SELECT user_id, project_id, title, goal, trigger_kind, evidence_score, related_ids_json, proposed_at, ttl_turns
                 FROM pending_project_offer WHERE user_id = ?`,
            )
            .get(userId) as
            | {
                  user_id: string;
                  project_id: string;
                  title: string;
                  goal: string;
                  trigger_kind: string;
                  evidence_score: number;
                  related_ids_json: string;
                  proposed_at: string;
                  ttl_turns: number;
              }
            | undefined;
        if (!row) return undefined;
        return {
            userId: row.user_id,
            projectId: row.project_id,
            title: row.title,
            goal: row.goal,
            triggerKind: row.trigger_kind,
            evidenceScore: row.evidence_score,
            relatedIds: safeParseArray(row.related_ids_json),
            proposedAt: row.proposed_at,
            ttlTurns: row.ttl_turns,
        };
    }

    /** TTL -1；返回更新后的剩余 TTL（不存在则返回 undefined）。 */
    public async decrementProjectOfferTtl(userId: string): Promise<number | undefined> {
        await this.initialize();
        if (!this.database) return undefined;
        const current = await this.getProjectOffer(userId);
        if (!current) return undefined;
        const next = current.ttlTurns - 1;
        if (next <= 0) {
            await this.deleteProjectOffer(userId);
            return 0;
        }
        this.database.prepare("UPDATE pending_project_offer SET ttl_turns = ? WHERE user_id = ?").run(next, userId);
        return next;
    }

    public async deleteProjectOffer(userId: string): Promise<void> {
        await this.initialize();
        if (!this.database) return;
        this.database.prepare("DELETE FROM pending_project_offer WHERE user_id = ?").run(userId);
    }

    /** 持久化一个待用户确认的技能候选（每 userId 最多一条；存在则覆盖）。 */
    public async upsertSkillOffer(offer: PendingSkillOffer): Promise<void> {
        await this.initialize();
        if (!this.database) return;
        this.database
            .prepare(
                `INSERT INTO pending_skill_offer (user_id, skill_id, name, description, summary, support, confidence, mcp_tools_json, related_ids_json, proposed_at, ttl_turns)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET skill_id=excluded.skill_id, name=excluded.name, description=excluded.description,
                    summary=excluded.summary, support=excluded.support, confidence=excluded.confidence,
                    mcp_tools_json=excluded.mcp_tools_json, related_ids_json=excluded.related_ids_json,
                    proposed_at=excluded.proposed_at, ttl_turns=excluded.ttl_turns`,
            )
            .run(
                offer.userId,
                offer.skillId,
                offer.name,
                offer.description,
                offer.summary,
                offer.support,
                offer.confidence,
                JSON.stringify(offer.mcpTools),
                JSON.stringify(offer.relatedIds),
                offer.proposedAt,
                offer.ttlTurns,
            );
    }

    public async getSkillOffer(userId: string): Promise<PendingSkillOffer | undefined> {
        await this.initialize();
        if (!this.database) return undefined;
        const row = this.database
            .prepare(
                `SELECT user_id, skill_id, name, description, summary, support, confidence, mcp_tools_json, related_ids_json, proposed_at, ttl_turns
                 FROM pending_skill_offer WHERE user_id = ?`,
            )
            .get(userId) as
            | {
                  user_id: string;
                  skill_id: string;
                  name: string;
                  description: string;
                  summary: string;
                  support: number;
                  confidence: number;
                  mcp_tools_json: string;
                  related_ids_json: string;
                  proposed_at: string;
                  ttl_turns: number;
              }
            | undefined;
        if (!row) return undefined;
        return {
            userId: row.user_id,
            skillId: row.skill_id,
            name: row.name,
            description: row.description,
            summary: row.summary,
            support: row.support,
            confidence: row.confidence,
            mcpTools: safeParseArray(row.mcp_tools_json),
            relatedIds: safeParseArray(row.related_ids_json),
            proposedAt: row.proposed_at,
            ttlTurns: row.ttl_turns,
        };
    }

    public async decrementSkillOfferTtl(userId: string): Promise<number | undefined> {
        await this.initialize();
        if (!this.database) return undefined;
        const current = await this.getSkillOffer(userId);
        if (!current) return undefined;
        const next = current.ttlTurns - 1;
        if (next <= 0) {
            await this.deleteSkillOffer(userId);
            return 0;
        }
        this.database.prepare("UPDATE pending_skill_offer SET ttl_turns = ? WHERE user_id = ?").run(next, userId);
        return next;
    }

    public async deleteSkillOffer(userId: string): Promise<void> {
        await this.initialize();
        if (!this.database) return;
        this.database.prepare("DELETE FROM pending_skill_offer WHERE user_id = ?").run(userId);
    }
}

export interface PendingSkillOffer {
    userId: string;
    skillId: string;
    name: string;
    description: string;
    summary: string;
    support: number;
    confidence: number;
    mcpTools: string[];
    relatedIds: string[];
    proposedAt: string;
    ttlTurns: number;
}

export interface PendingProjectOffer {
    userId: string;
    projectId: string;
    title: string;
    goal: string;
    triggerKind: string;
    evidenceScore: number;
    relatedIds: string[];
    proposedAt: string;
    ttlTurns: number;
}

function openMemoryDatabase(path: string): Database {
    const database = new Database(path);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec("PRAGMA foreign_keys = ON");
    return database;
}

function hasIncompatibleMemorySchema(database: Database): boolean {
    return tableExists(database, "memory_candidates") && !tableHasColumn(database, "memory_candidates", "source_id");
}

function tableExists(database: Database, table: string): boolean {
    const row = database
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { name: string } | null;
    return Boolean(row);
}

function tableHasColumn(database: Database, table: string, column: string): boolean {
    const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
}

function safeParseArray(raw: string): string[] {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error("Memory sqlite row expected a JSON array.");
    }
    return parsed.filter((v): v is string => typeof v === "string");
}

function toFtsQuery(input: string): string {
    return input
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((token) => token.length >= 2 && token.length <= 48)
        .slice(0, 12)
        .map((token) => `"${token.replace(/"/g, "")}"`)
        .join(" OR ");
}

function rowToMemory(row: MemoryRow): MemoryRecord {
    return {
        id: row.id,
        kind: row.kind as MemoryKind,
        content: row.content,
        scope: row.scope,
        subjectId: row.subject_id,
        channel: row.channel,
        chatId: row.chat_id,
        importance: row.importance,
        confidence: row.confidence,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: parseMetadata(row.metadata_json),
    };
}

function scoreWithMemoryMatrix(baseScore: number, record: MemoryRecord): number {
    const recallBoost = recallBoostFromMetadata(record.metadata);
    return clamp01(baseScore * 0.72 + record.importance * 0.18 + recallBoost * 0.1);
}

function recallBoostFromMetadata(metadata: Record<string, unknown> | undefined): number {
    const matrix = metadata?.matrix;
    if (!isRecord(matrix)) {
        return 0;
    }
    const aggregate = matrix.aggregate;
    if (!isRecord(aggregate)) {
        return 0;
    }
    const value = aggregate.recallBoost;
    return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
    if (!value) {
        return undefined;
    }
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Memory sqlite metadata expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
}
