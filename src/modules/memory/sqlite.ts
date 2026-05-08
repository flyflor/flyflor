import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths, MemorySessionConfig, SQLiteMemoryConfig } from "../../config/index.ts";
import {
    ChatType,
    MemoryCandidateStatus,
    MemoryKind,
    MemoryLayer,
    ModelRole,
} from "../../shared/core/enums.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../shared/core/types.ts";
import type {
    HistoryEntry,
    MemoryCandidate,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
    SessionIdentity,
    SessionMessageRecord,
} from "./types.ts";

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

interface SessionRow {
    session_key: string;
    channel: string;
    chat_id: string;
    chat_type: string;
    thread_id?: string;
    account_id?: string;
    user_id: string;
    created_at: string;
    updated_at: string;
    last_consolidated_sequence: number;
    metadata_json?: string;
}

interface SessionMessageRow {
    id: string;
    session_key: string;
    sequence: number;
    role: string;
    content: string;
    gateway_message_id?: string;
    gateway_reply_id?: string;
    created_at: string;
    metadata_json?: string;
}

interface HistoryRow {
    cursor: number;
    timestamp: string;
    session_key: string;
    content: string;
    source_start_sequence?: number;
    source_end_sequence?: number;
    metadata_json?: string;
}

export class SQLiteMemoryStore {
    private database?: Database;

    constructor(
        private readonly paths: FlyflorPaths,
        private readonly config: SQLiteMemoryConfig,
    ) {}

    async initialize(): Promise<void> {
        if (!this.config.enabled || this.database) {
            return;
        }

        await mkdir(this.paths.memoryDir, { recursive: true });
        const database = new Database(join(this.paths.memoryDir, "memory.sqlite"));
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_key TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                chat_type TEXT NOT NULL,
                thread_id TEXT,
                account_id TEXT,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_consolidated_sequence INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS session_messages (
                id TEXT PRIMARY KEY,
                session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
                sequence INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                gateway_message_id TEXT,
                gateway_reply_id TEXT,
                created_at TEXT NOT NULL,
                metadata_json TEXT,
                UNIQUE(session_key, sequence)
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS history_entries (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
                content TEXT NOT NULL,
                source_start_sequence INTEGER,
                source_end_sequence INTEGER,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS memory_candidates (
                id TEXT PRIMARY KEY,
                target_file TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                content TEXT NOT NULL,
                session_key TEXT NOT NULL,
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
        database.exec("CREATE INDEX IF NOT EXISTS idx_session_messages_session_sequence ON session_messages(session_key, sequence)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_history_session_cursor ON history_entries(session_key, cursor)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_candidates_status ON memory_candidates(status, created_at)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_memories_scope_updated ON memories(scope, updated_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(subject_id, updated_at DESC)");
        this.database = database;
    }

    async recordTurn(message: GatewayMessage, reply: GatewayReply, context: RuntimeContext): Promise<SessionIdentity> {
        await this.initialize();
        const session = sessionIdentityFor(message);
        this.upsertSession(session, context.now);
        this.insertSessionMessage({
            id: crypto.randomUUID(),
            sessionKey: session.key,
            sequence: this.nextSequence(session.key),
            role: ModelRole.User,
            content: redactForMemory(message.text),
            gatewayMessageId: message.id,
            createdAt: context.now,
            metadata: {
                requestId: context.requestId,
            },
        });
        this.insertSessionMessage({
            id: crypto.randomUUID(),
            sessionKey: session.key,
            sequence: this.nextSequence(session.key),
            role: ModelRole.Assistant,
            content: redactForMemory(reply.text),
            gatewayReplyId: reply.messageId,
            createdAt: context.now,
            metadata: {
                requestId: context.requestId,
            },
        });
        return session;
    }

    async addCandidate(candidate: MemoryCandidate): Promise<void> {
        await this.initialize();
        if (!this.database) {
            return;
        }
        this.database
            .query(
                `
                INSERT INTO memory_candidates (
                    id, target_file, kind, status, source_kind, content, session_key,
                    source_message_id, source_reply_id, created_at, promoted_at, weights_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                candidate.id,
                candidate.targetFile,
                candidate.kind,
                candidate.status,
                candidate.sourceKind,
                candidate.content,
                candidate.sessionKey,
                candidate.sourceMessageId ?? null,
                candidate.sourceReplyId ?? null,
                candidate.createdAt,
                candidate.promotedAt ?? null,
                JSON.stringify(candidate.weights),
                JSON.stringify(candidate.metadata ?? {}),
            );
    }

    async markCandidatePromoted(candidateId: string, promotedAt: string): Promise<void> {
        await this.initialize();
        this.database
            ?.query("UPDATE memory_candidates SET status = ?, promoted_at = ? WHERE id = ?")
            .run(MemoryCandidateStatus.Promoted, promotedAt, candidateId);
    }

    async addSearchRecord(record: MemoryRecord): Promise<void> {
        await this.initialize();
        this.insertMemoryRecord(record);
    }

    async recentMessages(sessionKey: string, limit: number): Promise<SessionMessageRecord[]> {
        await this.initialize();
        if (!this.database || limit <= 0) {
            return [];
        }

        const session = this.database
            .query("SELECT last_consolidated_sequence FROM sessions WHERE session_key = ?")
            .get(sessionKey) as { last_consolidated_sequence: number } | null;
        const lastConsolidated = session?.last_consolidated_sequence ?? 0;
        const rows = this.database
            .query(
                `
                SELECT *
                FROM session_messages
                WHERE session_key = ? AND sequence > ?
                ORDER BY sequence DESC
                LIMIT ?
            `,
            )
            .all(sessionKey, lastConsolidated, Math.max(1, limit)) as SessionMessageRow[];
        return rows.toReversed().map(rowToSessionMessage);
    }

    async consolidateSession(sessionKey: string, config: MemorySessionConfig, now: string): Promise<HistoryEntry[]> {
        await this.initialize();
        if (!this.database) {
            return [];
        }

        const session = this.database
            .query("SELECT * FROM sessions WHERE session_key = ?")
            .get(sessionKey) as SessionRow | null;
        if (!session) {
            return [];
        }

        const liveCount = Number(
            (
                this.database
                    .query("SELECT COUNT(*) AS count FROM session_messages WHERE session_key = ? AND sequence > ?")
                    .get(sessionKey, session.last_consolidated_sequence) as { count: number }
            ).count,
        );
        if (liveCount <= config.maxLiveMessages) {
            return [];
        }

        const rows = this.database
            .query(
                `
                SELECT *
                FROM session_messages
                WHERE session_key = ? AND sequence > ?
                ORDER BY sequence ASC
                LIMIT ?
            `,
            )
            .all(sessionKey, session.last_consolidated_sequence, config.consolidationBatchSize) as SessionMessageRow[];
        if (rows.length === 0) {
            return [];
        }

        const content = truncateHistory(formatHistorySummary(rows), config.maxHistoryEntryChars);
        const start = rows[0]?.sequence;
        const end = rows.at(-1)?.sequence;
        if (start === undefined || end === undefined) {
            return [];
        }

        const cursor = this.insertHistoryEntry({
            timestamp: now,
            sessionKey,
            content,
            sourceStartSequence: start,
            sourceEndSequence: end,
            metadata: {
                strategy: "bounded-session-summary",
            },
        });
        this.database
            .query("UPDATE sessions SET last_consolidated_sequence = ?, updated_at = ? WHERE session_key = ?")
            .run(end, now, sessionKey);

        const entry: HistoryEntry = {
            cursor,
            timestamp: now,
            sessionKey,
            content,
            sourceStartSequence: start,
            sourceEndSequence: end,
            metadata: {
                strategy: "bounded-session-summary",
            },
        };
        this.insertMemoryRecord({
            id: `history:${cursor}`,
            kind: MemoryKind.History,
            content,
            scope: sessionKey,
            subjectId: session.user_id,
            channel: session.channel,
            chatId: session.chat_id,
            importance: 0.45,
            confidence: 0.8,
            createdAt: now,
            updatedAt: now,
            metadata: {
                cursor,
                sourceStartSequence: start,
                sourceEndSequence: end,
            },
        });
        return [entry];
    }

    async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        await this.initialize();
        if (!this.database) {
            return [];
        }

        const match = toFtsQuery(request.query);
        const limit = Math.min(Math.max(request.limit, 1), this.config.maxPromptItems);
        const rows = match ? this.searchFts(match, request, limit) : this.searchRecent(request, limit);
        return rows.map((row) => ({
            layer: MemoryLayer.SQLite,
            score: row.rank !== undefined ? 1 / (1 + Math.abs(row.rank)) : 0.5,
            record: rowToMemory(row),
        }));
    }

    private upsertSession(session: SessionIdentity, now: string): void {
        if (!this.database) {
            return;
        }
        const existing = this.database
            .query("SELECT session_key FROM sessions WHERE session_key = ?")
            .get(session.key) as { session_key: string } | null;
        if (existing) {
            this.database.query("UPDATE sessions SET updated_at = ?, user_id = ? WHERE session_key = ?").run(
                now,
                session.userId,
                session.key,
            );
            return;
        }
        this.database
            .query(
                `
                INSERT INTO sessions (
                    session_key, channel, chat_id, chat_type, thread_id, account_id,
                    user_id, created_at, updated_at, last_consolidated_sequence, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            `,
            )
            .run(
                session.key,
                session.channel,
                session.chatId,
                session.chatType,
                session.threadId ?? null,
                session.accountId ?? null,
                session.userId,
                now,
                now,
                JSON.stringify({ schemaVersion: 1 }),
            );
    }

    private nextSequence(sessionKey: string): number {
        if (!this.database) {
            return 1;
        }
        const row = this.database
            .query("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM session_messages WHERE session_key = ?")
            .get(sessionKey) as { sequence: number };
        return row.sequence;
    }

    private insertSessionMessage(record: SessionMessageRecord): void {
        this.database
            ?.query(
                `
                INSERT INTO session_messages (
                    id, session_key, sequence, role, content, gateway_message_id,
                    gateway_reply_id, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                record.id,
                record.sessionKey,
                record.sequence,
                record.role,
                record.content,
                record.gatewayMessageId ?? null,
                record.gatewayReplyId ?? null,
                record.createdAt,
                JSON.stringify(record.metadata ?? {}),
            );
    }

    private insertHistoryEntry(entry: Omit<HistoryEntry, "cursor">): number {
        if (!this.database) {
            return 0;
        }
        const result = this.database
            .query(
                `
                INSERT INTO history_entries (
                    timestamp, session_key, content, source_start_sequence, source_end_sequence, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                entry.timestamp,
                entry.sessionKey,
                entry.content,
                entry.sourceStartSequence ?? null,
                entry.sourceEndSequence ?? null,
                JSON.stringify(entry.metadata ?? {}),
            );
        return Number(result.lastInsertRowid);
    }

    private insertMemoryRecord(record: MemoryRecord): void {
        if (!this.database) {
            return;
        }
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
                record.id,
                record.kind,
                record.content,
                record.scope,
                record.subjectId ?? null,
                record.channel ?? null,
                record.chatId ?? null,
                record.importance,
                record.confidence,
                record.createdAt,
                record.updatedAt,
                JSON.stringify(record.metadata ?? {}),
            );
        this.database.query("DELETE FROM memories_fts WHERE id = ?").run(record.id);
        this.database.query("INSERT INTO memories_fts(id, content) VALUES (?, ?)").run(record.id, record.content);
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
}

export function sessionIdentityFor(message: GatewayMessage): SessionIdentity {
    return {
        key: scopeFor(message),
        channel: message.route.channel,
        chatId: message.route.chatId,
        chatType: message.route.chatType || ChatType.Unknown,
        threadId: message.route.threadId,
        accountId: message.route.accountId,
        userId: message.user.id,
    };
}

export function scopeFor(message: GatewayMessage): string {
    return [message.route.channel, message.route.accountId, message.route.chatId, message.route.threadId]
        .filter(Boolean)
        .join(":");
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

function rowToSessionMessage(row: SessionMessageRow): SessionMessageRecord {
    return {
        id: row.id,
        sessionKey: row.session_key,
        sequence: row.sequence,
        role: row.role as typeof ModelRole.User | typeof ModelRole.Assistant | typeof ModelRole.System | typeof ModelRole.Tool,
        content: row.content,
        gatewayMessageId: row.gateway_message_id,
        gatewayReplyId: row.gateway_reply_id,
        createdAt: row.created_at,
        metadata: parseMetadata(row.metadata_json),
    };
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
    if (!value) {
        return undefined;
    }
    try {
        return JSON.parse(value) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function formatHistorySummary(rows: SessionMessageRow[]): string {
    return rows
        .map((row) => {
            const role = row.role === ModelRole.Assistant ? "Assistant" : "User";
            return `- [${row.sequence} ${role}] ${row.content.replace(/\s+/g, " ").trim()}`;
        })
        .join("\n");
}

function truncateHistory(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n... (truncated)`;
}

function redactForMemory(value: string): string {
    return value
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted-api-key]")
        .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]");
}
