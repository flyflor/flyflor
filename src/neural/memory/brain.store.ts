import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
    type AtomScore,
    type MemoryAtom,
    type CodenameRecord,
    type EqLabel,
    type EqState,
    type MemoryEventRecord,
    MemoryEventType,
    MemoryEventStatus,
    type MemoryLinkRecord,
    type MemoryLinkType,
    type MemoryStateRecord,
    type MemorySummaryRecord,
    type SummaryRange,
} from "../../protocol/contracts/index.ts";

/**
 * LF-R1 brain.db single-file store.
 *
 * Boundary contract:
 * - `memory_events` is append-only. Any "update" is a new row + a `memory_state` redirect.
 * - `memory_state` is the only mutable layer Dream / sweeper may touch.
 * - Dream is forbidden from `DELETE FROM memory_events` (R7).
 * - Visibility gating (AtomScore) is the caller's responsibility; this store does no scoring.
 *
 * Read / write surface is intentionally narrow: callers consume protocol records,
 * never raw SQLite rows.
 */

export interface BrainStoreOptions {
    dbPath: string;
}

export interface BrainEventInput {
    id: string;
    ts: number;
    userId: string;
    channelId?: string;
    codenameId?: string;
    type: MemoryEventType;
    role?: MemoryEventRecord["role"];
    content: Record<string, unknown>;
    parentId?: string;
    embeddingId?: string;
    importance?: number;
}

export interface BrainEventListInput {
    userId?: string;
    codenameId?: string;
    type?: MemoryEventType;
    sinceTs?: number;
    untilTs?: number;
    limit?: number;
    statusIn?: MemoryEventRecord extends never ? never : MemoryStateRecord["status"][];
}

export interface BrainPromptAtomWindowInput {
    days?: number;
    limit?: number;
    minScore: number;
    /** Runtime prompt recall supplies this; diagnostics may omit it to inspect all inbox buckets. */
    userId?: string;
}

export interface BrainStateMutation {
    activation?: number;
    decayScore?: number;
    accessCount?: number;
    lastAccessed?: number;
    resumedAt?: number;
    status?: MemoryStateRecord["status"];
}

interface EventRow {
    id: string;
    ts: number;
    time_bucket: string;
    user_id: string;
    channel_id: string | null;
    codename_id: string | null;
    type: string;
    role: string | null;
    content: string;
    parent_id: string | null;
    embedding_id: string | null;
    importance: number;
}

interface StateRow {
    event_id: string;
    activation: number;
    decay_score: number;
    access_count: number;
    last_accessed: number | null;
    resumed_at: number | null;
    status: string;
}

interface SummaryRow {
    id: string;
    time_range: string;
    bucket_key: string;
    content: string;
    embedding_id: string | null;
    created_at: number;
}

interface LinkRow {
    id: string;
    from_id: string;
    to_id: string;
    strength: number;
    type: string;
    created_at: number;
}

interface CodenameRow {
    id: string;
    name: string;
    working_dir: string | null;
    description: string | null;
    user_id: string;
    created_at: number;
    last_used_at: number;
    use_count: number;
    project_id: string | null;
}

interface EqStateRow {
    user_id: string;
    valence: number;
    arousal: number;
    dominance: number;
    label: string;
    confidence: number;
    updated_at: number;
}

export interface BrainVisibleAtom {
    atom: MemoryAtom;
    score: AtomScore;
    sourceEventId: string;
    sourceEventTs: number;
}

export class BrainStore {
    private db: Database | null = null;
    private opened = false;

    constructor(private readonly options: BrainStoreOptions) {}

    async open(): Promise<void> {
        if (this.opened) return;
        await mkdir(dirname(this.options.dbPath), { recursive: true });
        const db = new Database(this.options.dbPath);
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA synchronous = NORMAL");
        db.exec("PRAGMA foreign_keys = ON");
        createSchema(db);
        this.db = db;
        this.opened = true;
    }

    close(): void {
        if (!this.opened) return;
        this.db?.close();
        this.db = null;
        this.opened = false;
    }

    appendEvent(input: BrainEventInput): MemoryEventRecord {
        const db = this.requireDb();
        const importance = input.importance ?? 0.5;
        const bucket = formatBucket(input.ts);
        db.query(
            `INSERT INTO memory_events (
                id, ts, time_bucket, user_id, channel_id, codename_id,
                type, role, content, parent_id, embedding_id, importance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            input.id,
            input.ts,
            bucket,
            input.userId,
            input.channelId ?? null,
            input.codenameId ?? null,
            input.type,
            input.role ?? null,
            JSON.stringify(input.content),
            input.parentId ?? null,
            input.embeddingId ?? null,
            importance,
        );
        return {
            id: input.id,
            ts: input.ts,
            timeBucket: bucket,
            userId: input.userId,
            channelId: input.channelId,
            codenameId: input.codenameId,
            type: input.type,
            role: input.role,
            content: input.content,
            parentId: input.parentId,
            embeddingId: input.embeddingId,
            importance,
        };
    }

    getEvent(id: string): MemoryEventRecord | null {
        const db = this.requireDb();
        const row = db.query("SELECT * FROM memory_events WHERE id = ?").get(id) as EventRow | null;
        return row ? rowToEvent(row) : null;
    }

    listEvents(input: BrainEventListInput = {}): MemoryEventRecord[] {
        const db = this.requireDb();
        const conditions: string[] = [];
        const values: Array<string | number> = [];
        if (input.userId !== undefined) {
            conditions.push("e.user_id = ?");
            values.push(input.userId);
        }
        if (input.codenameId !== undefined) {
            conditions.push("e.codename_id = ?");
            values.push(input.codenameId);
        }
        if (input.type !== undefined) {
            conditions.push("e.type = ?");
            values.push(input.type);
        }
        if (input.sinceTs !== undefined) {
            conditions.push("e.ts >= ?");
            values.push(input.sinceTs);
        }
        if (input.untilTs !== undefined) {
            conditions.push("e.ts <= ?");
            values.push(input.untilTs);
        }
        if (input.statusIn && input.statusIn.length > 0) {
            const placeholders = input.statusIn.map(() => "?").join(", ");
            conditions.push(`COALESCE(s.status, '${MemoryEventStatus.Live}') IN (${placeholders})`);
            for (const status of input.statusIn) values.push(status);
        }
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = db
            .query(
                `SELECT e.* FROM memory_events e
                 LEFT JOIN memory_state s ON s.event_id = e.id
                 ${where}
                 ORDER BY e.ts DESC
                 LIMIT ?`,
            )
            .all(...values, limit) as EventRow[];
        return rows.map(rowToEvent);
    }

    /**
     * prompt recall 的 brain 权威窗口：从 `memory_events` 展开结构化 `content.atoms`。
     * 不做字符匹配，只按时间窗、状态层与 JSON shape 过滤。
     */
    listPromptAtomsWindow(date: Date | string, input: BrainPromptAtomWindowInput): BrainVisibleAtom[] {
        const days = Math.max(1, Math.min(31, Math.floor(input.days ?? 7)));
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const sinceTs = normalizeTimestamp(date) - days * 86_400_000;
        const events = this.listEvents({
            ...(input.userId ? { userId: input.userId } : {}),
            type: MemoryEventType.Event,
            sinceTs,
            limit,
            statusIn: [MemoryEventStatus.Live, MemoryEventStatus.Resumed],
        });
        const visible: BrainVisibleAtom[] = [];
        for (const event of events) {
            const atoms = readPromptAtomEntries(event);
            for (const entry of atoms) {
                if (entry.score.total < input.minScore) continue;
                visible.push(entry);
            }
        }
        visible.sort((a, b) => {
            const byScore = b.score.total - a.score.total;
            if (byScore !== 0) return byScore;
            const byTime = b.sourceEventTs - a.sourceEventTs;
            if (byTime !== 0) return byTime;
            return b.atom.createdAt.localeCompare(a.atom.createdAt);
        });
        return visible.slice(0, limit);
    }

    getState(eventId: string): MemoryStateRecord | null {
        const db = this.requireDb();
        const row = db.query("SELECT * FROM memory_state WHERE event_id = ?").get(eventId) as StateRow | null;
        return row ? rowToState(row) : null;
    }

    upsertState(eventId: string, mutation: BrainStateMutation): MemoryStateRecord {
        const db = this.requireDb();
        const existing = this.getState(eventId);
        const next: MemoryStateRecord = {
            eventId,
            activation: mutation.activation ?? existing?.activation ?? 0,
            decayScore: mutation.decayScore ?? existing?.decayScore ?? 0,
            accessCount: mutation.accessCount ?? existing?.accessCount ?? 0,
            lastAccessed: mutation.lastAccessed ?? existing?.lastAccessed,
            resumedAt: mutation.resumedAt ?? existing?.resumedAt,
            status: mutation.status ?? existing?.status ?? MemoryEventStatus.Live,
        };
        db.query(
            `INSERT INTO memory_state (
                event_id, activation, decay_score, access_count,
                last_accessed, resumed_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO UPDATE SET
                activation = excluded.activation,
                decay_score = excluded.decay_score,
                access_count = excluded.access_count,
                last_accessed = excluded.last_accessed,
                resumed_at = excluded.resumed_at,
                status = excluded.status`,
        ).run(
            eventId,
            next.activation,
            next.decayScore,
            next.accessCount,
            next.lastAccessed ?? null,
            next.resumedAt ?? null,
            next.status,
        );
        return next;
    }

    writeSummary(record: MemorySummaryRecord): void {
        const db = this.requireDb();
        db.query(
            `INSERT INTO memory_summary (id, time_range, bucket_key, content, embedding_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                time_range = excluded.time_range,
                bucket_key = excluded.bucket_key,
                content = excluded.content,
                embedding_id = excluded.embedding_id,
                created_at = excluded.created_at`,
        ).run(
            record.id,
            record.timeRange,
            record.bucketKey,
            record.content,
            record.embeddingId ?? null,
            record.createdAt,
        );
    }

    getSummary(id: string): MemorySummaryRecord | null {
        const db = this.requireDb();
        const row = db.query("SELECT * FROM memory_summary WHERE id = ?").get(id) as SummaryRow | null;
        return row ? rowToSummary(row) : null;
    }

    listSummaries(input: { timeRange?: SummaryRange; limit?: number } = {}): MemorySummaryRecord[] {
        const db = this.requireDb();
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const conditions: string[] = [];
        const values: Array<string | number> = [];
        if (input.timeRange !== undefined) {
            conditions.push("time_range = ?");
            values.push(input.timeRange);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = db
            .query(`SELECT * FROM memory_summary ${where} ORDER BY created_at DESC LIMIT ?`)
            .all(...values, limit) as SummaryRow[];
        return rows.map(rowToSummary);
    }

    writeLink(record: MemoryLinkRecord): void {
        const db = this.requireDb();
        db.query(
            `INSERT OR REPLACE INTO memory_links (id, from_id, to_id, strength, type, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(record.id, record.fromId, record.toId, record.strength, record.type, record.createdAt);
    }

    listLinks(input: { fromId?: string; toId?: string; type?: MemoryLinkType; limit?: number } = {}): MemoryLinkRecord[] {
        const db = this.requireDb();
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const conditions: string[] = [];
        const values: Array<string | number> = [];
        if (input.fromId !== undefined) {
            conditions.push("from_id = ?");
            values.push(input.fromId);
        }
        if (input.toId !== undefined) {
            conditions.push("to_id = ?");
            values.push(input.toId);
        }
        if (input.type !== undefined) {
            conditions.push("type = ?");
            values.push(input.type);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = db
            .query(`SELECT * FROM memory_links ${where} ORDER BY created_at DESC LIMIT ?`)
            .all(...values, limit) as LinkRow[];
        return rows.map(rowToLink);
    }

    upsertCodename(record: CodenameRecord): CodenameRecord {
        const db = this.requireDb();
        db.query(
            `INSERT INTO codenames (
                id, name, working_dir, description, user_id,
                created_at, last_used_at, use_count, project_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                working_dir = excluded.working_dir,
                description = excluded.description,
                last_used_at = excluded.last_used_at,
                use_count = excluded.use_count,
                project_id = excluded.project_id`,
        ).run(
            record.id,
            record.name,
            record.workingDir ?? null,
            record.description ?? null,
            record.userId,
            record.createdAt,
            record.lastUsedAt,
            record.useCount,
            record.projectId ?? null,
        );
        return record;
    }

    touchCodename(id: string, ts: number): void {
        const db = this.requireDb();
        db.query(
            `UPDATE codenames
             SET last_used_at = ?, use_count = use_count + 1
             WHERE id = ?`,
        ).run(ts, id);
    }

    bindCodenameProject(id: string, projectId: string): void {
        const db = this.requireDb();
        db.query(`UPDATE codenames SET project_id = ? WHERE id = ?`).run(projectId, id);
    }

    getCodename(id: string): CodenameRecord | null {
        const db = this.requireDb();
        const row = db.query("SELECT * FROM codenames WHERE id = ?").get(id) as CodenameRow | null;
        return row ? rowToCodename(row) : null;
    }

    listCodenames(input: { userId?: string; limit?: number } = {}): CodenameRecord[] {
        const db = this.requireDb();
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const conditions: string[] = [];
        const values: Array<string | number> = [];
        if (input.userId !== undefined) {
            conditions.push("user_id = ?");
            values.push(input.userId);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = db
            .query(`SELECT * FROM codenames ${where} ORDER BY last_used_at DESC LIMIT ?`)
            .all(...values, limit) as CodenameRow[];
        return rows.map(rowToCodename);
    }

    getCodenameByName(userId: string, name: string): CodenameRecord | null {
        const db = this.requireDb();
        const row = db
            .query("SELECT * FROM codenames WHERE user_id = ? AND name = ?")
            .get(userId, name) as CodenameRow | null;
        return row ? rowToCodename(row) : null;
    }

    /**
     * P2 inbox 收口：取用户最近被 touch 过且仍未升格（projectId IS NULL）的 codename，
     * 用于召回侧偏变（让 inbox 召回向"用户当前正在用的那个 codename"倾斜）。
     * 零字符匹配——只看 last_used_at >= sinceTs 资源指标 + project_id IS NULL 结构化字段。
     */
    getMostRecentTouchedCodename(userId: string, sinceTs: number): CodenameRecord | null {
        const db = this.requireDb();
        const row = db
            .query(
                `SELECT * FROM codenames
                 WHERE user_id = ? AND project_id IS NULL AND last_used_at >= ?
                 ORDER BY last_used_at DESC
                 LIMIT 1`,
            )
            .get(userId, sinceTs) as CodenameRow | null;
        return row ? rowToCodename(row) : null;
    }

    /**
     * EQ-01 slice A：写入 / 覆盖某用户最新情绪状态（latest-only UPSERT）。
     * append-only 历史轨迹由 `memory_events` 中模型同轮记录的对话事件携带，
     * 此处只保留"现在的样子"以便快速取读 + 衰减。
     */
    upsertEqState(state: EqState): void {
        const db = this.requireDb();
        db.run(
            `INSERT INTO memory_eq_state (user_id, valence, arousal, dominance, label, confidence, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                valence = excluded.valence,
                arousal = excluded.arousal,
                dominance = excluded.dominance,
                label = excluded.label,
                confidence = excluded.confidence,
                updated_at = excluded.updated_at`,
            [
                state.userId,
                state.valence,
                state.arousal,
                state.dominance,
                state.label,
                state.confidence,
                state.updatedAt,
            ],
        );
    }

    /** 取某用户最新 EQ 状态。无记录返回 null。 */
    getEqState(userId: string): EqState | null {
        const db = this.requireDb();
        const row = db
            .query("SELECT * FROM memory_eq_state WHERE user_id = ?")
            .get(userId) as EqStateRow | null;
        return row ? rowToEq(row) : null;
    }

    /**
     * LF-R3：取该用户最近一次未答复的 ask 事件。"未答复"= 既不是 Abandoned/Archived，
     * 也没有任何 ask-answer-pair 子事件（parent_id 指向它）。
     */
    getLatestPendingAsk(userId: string): MemoryEventRecord | null {
        const db = this.requireDb();
        const row = db
            .query(
                `SELECT e.* FROM memory_events e
                 LEFT JOIN memory_state s ON s.event_id = e.id
                 WHERE e.user_id = ? AND e.type = 'ask'
                   AND COALESCE(s.status, '${MemoryEventStatus.Live}') IN ('${MemoryEventStatus.Live}', '${MemoryEventStatus.Resumed}')
                   AND NOT EXISTS (
                     SELECT 1 FROM memory_events c
                     WHERE c.parent_id = e.id AND c.type = 'ask-answer-pair'
                   )
                 ORDER BY e.ts DESC
                 LIMIT 1`,
            )
            .get(userId) as EventRow | null;
        return row ? rowToEvent(row) : null;
    }

    /**
     * LF-R3：链深度 = 从 pending ask 沿 parent_id 反向追溯，前序 ask 事件个数 + 1。
     * 用于 `memory.tuning.ghost.maxChainDepth` 强制 reply 阈值检查。
     */
    countAskChainDepth(askEventId: string): number {
        const db = this.requireDb();
        let depth = 1;
        let cursor: string | null = askEventId;
        for (let i = 0; i < 32 && cursor; i += 1) {
            const row = db.query("SELECT parent_id, type FROM memory_events WHERE id = ?").get(cursor) as
                | { parent_id: string | null; type: string }
                | null;
            if (!row) break;
            if (row.parent_id == null) break;
            const parent = db
                .query("SELECT type FROM memory_events WHERE id = ?")
                .get(row.parent_id) as { type: string } | null;
            cursor = row.parent_id;
            if (parent?.type === "ask") {
                depth += 1;
                continue;
            }
            break;
        }
        return depth;
    }

    /**
     * LF-R4：列出当前用户的 ghost-context 事件，按 ts 倒序。
     * "active" = status ∈ {live, resumed}（drop = abandoned；archive = archived；不展示）。
     * codenameId 可选，传入则只看该工作目录下的 ghost。
     */
    listActiveGhosts(
        userId: string,
        options: { codenameId?: string | null; limit?: number } = {},
    ): MemoryEventRecord[] {
        const db = this.requireDb();
        const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
        const conditions: string[] = ["e.user_id = ?", "e.type = 'ghost-context'"];
        const values: Array<string | number> = [userId];
        if (options.codenameId !== undefined) {
            if (options.codenameId === null) {
                conditions.push("e.codename_id IS NULL");
            } else {
                conditions.push("e.codename_id = ?");
                values.push(options.codenameId);
            }
        }
        conditions.push(
            `COALESCE(s.status, '${MemoryEventStatus.Live}') IN ('${MemoryEventStatus.Live}', '${MemoryEventStatus.Resumed}')`,
        );
        const rows = db
            .query(
                `SELECT e.* FROM memory_events e
                 LEFT JOIN memory_state s ON s.event_id = e.id
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY e.ts DESC
                 LIMIT ?`,
            )
            .all(...values, limit) as EventRow[];
        return rows.map(rowToEvent);
    }

    /**
     * LF-R4 fork/fresh hint：合并 patch 到 ghost-context content，并保留其它字段。
     * 仅对 `type='ghost-context'` 生效；其他类型直接抛错避免误用。
     */
    patchGhostContent(eventId: string, patch: Record<string, unknown>): MemoryEventRecord | null {
        const db = this.requireDb();
        const row = db.query("SELECT * FROM memory_events WHERE id = ?").get(eventId) as EventRow | null;
        if (!row) return null;
        if (row.type !== "ghost-context") {
            throw new Error(`patchGhostContent: ${eventId} is not a ghost-context event`);
        }
        // patch 会改写事件 content；若原 content 已坏，必须先暴露损坏，不能用空对象覆盖掉证据。
        let parsed: unknown;
        try {
            parsed = JSON.parse(row.content) as unknown;
        } catch (error) {
            throw new Error(`Invalid ghost-context content JSON for event ${eventId}: ${String(error)}`);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`Invalid ghost-context content JSON for event ${eventId}.`);
        }
        const current = parsed as Record<string, unknown>;
        const next = { ...current, ...patch };
        db.run("UPDATE memory_events SET content = ? WHERE id = ?", [JSON.stringify(next), eventId]);
        return this.getEvent(eventId);
    }

    /**
     * LF-R5 identity revert：通用的事件 content 整体替换（不限 type）。
     * Identity revert 等审计操作只允许写入 content；schema 列（type、parent_id、user_id 等）不可改。
     */
    updateEventContent(eventId: string, nextContent: Record<string, unknown>): MemoryEventRecord | null {
        const db = this.requireDb();
        const row = db.query("SELECT id FROM memory_events WHERE id = ?").get(eventId) as { id: string } | null;
        if (!row) return null;
        db.run("UPDATE memory_events SET content = ? WHERE id = ?", [JSON.stringify(nextContent), eventId]);
        return this.getEvent(eventId);
    }

    /**
     * LF-R4 evidence weight：判断给定 askEventId 是否已有 ask-answer-pair 子事件。
     * 仅消费结构化关系（parent_id + type），不读对话文本。
     */
    hasAskBeenAnswered(askEventId: string): boolean {
        const db = this.requireDb();
        const row = db
            .query(
                `SELECT 1 FROM memory_events
                 WHERE parent_id = ? AND type = 'ask-answer-pair'
                 LIMIT 1`,
            )
            .get(askEventId) as { 1: number } | null;
        return row !== null;
    }

    /**
     * LF-R5 identity 召回：列出指定 user 的 live `identity-append` 事件，按 ts 倒序。
     * 状态层为 `abandoned` 的（revert 过）会被过滤；`archived` 同理（冷归档已外迁）。
     */
    listActiveIdentity(userId: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        const db = this.requireDb();
        const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 32)));
        const rows = db
            .query(
                `SELECT e.* FROM memory_events e
                 LEFT JOIN memory_state s ON s.event_id = e.id
                 WHERE e.user_id = ? AND e.type = 'identity-append'
                   AND COALESCE(s.status, 'live') = 'live'
                 ORDER BY e.ts DESC
                 LIMIT ?`,
            )
            .all(userId, limit) as EventRow[];
        return rows.map(rowToEvent);
    }

    /**
     * LF-R5 identity 历史：列出所有 identity append（含 revert / archived），按 ts 倒序。
     * 仅 CLI / TUI 审计使用，prompt 召回请用 listActiveIdentity。
     */
    listAllIdentity(userId: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        const db = this.requireDb();
        const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 64)));
        const rows = db
            .query(
                `SELECT e.* FROM memory_events e
                 WHERE e.user_id = ? AND e.type = 'identity-append'
                 ORDER BY e.ts DESC
                 LIMIT ?`,
            )
            .all(userId, limit) as EventRow[];
        return rows.map(rowToEvent);
    }

    private requireDb(): Database {
        if (!this.db || !this.opened) {
            throw new Error("BrainStore is not opened; call open() before use.");
        }
        return this.db;
    }
}

function createSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_events (
            id TEXT PRIMARY KEY,
            ts INTEGER NOT NULL,
            time_bucket TEXT NOT NULL,
            user_id TEXT NOT NULL,
            channel_id TEXT,
            codename_id TEXT,
            type TEXT NOT NULL,
            role TEXT,
            content TEXT NOT NULL,
            parent_id TEXT,
            embedding_id TEXT,
            importance REAL NOT NULL DEFAULT 0.5,
            FOREIGN KEY (parent_id) REFERENCES memory_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_time     ON memory_events(ts);
        CREATE INDEX IF NOT EXISTS idx_events_bucket   ON memory_events(time_bucket);
        CREATE INDEX IF NOT EXISTS idx_events_codename ON memory_events(codename_id, ts);
        CREATE INDEX IF NOT EXISTS idx_events_type     ON memory_events(type, ts);
        CREATE INDEX IF NOT EXISTS idx_events_user     ON memory_events(user_id, ts);
        -- Hot prompt / identity / ghost recall always starts from one user's typed time window.
        -- Keep this as a composite index so a large single brain.db does not degrade into broad scans.
        CREATE INDEX IF NOT EXISTS idx_events_user_type_ts ON memory_events(user_id, type, ts DESC);
        -- Ask pending checks and ghost evidence checks are relationship lookups, not semantic text reads.
        -- Index parent_id + type together because these checks sit on the interactive turn path.
        CREATE INDEX IF NOT EXISTS idx_events_parent_type ON memory_events(parent_id, type);

        CREATE TABLE IF NOT EXISTS memory_state (
            event_id TEXT PRIMARY KEY,
            activation REAL NOT NULL DEFAULT 0,
            decay_score REAL NOT NULL DEFAULT 0,
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed INTEGER,
            resumed_at INTEGER,
            status TEXT NOT NULL DEFAULT 'live',
            FOREIGN KEY (event_id) REFERENCES memory_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_state_status ON memory_state(status);

        CREATE TABLE IF NOT EXISTS memory_summary (
            id TEXT PRIMARY KEY,
            time_range TEXT NOT NULL,
            bucket_key TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding_id TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_summary_range_bucket ON memory_summary(time_range, bucket_key);

        CREATE TABLE IF NOT EXISTS memory_links (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            strength REAL NOT NULL,
            type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (from_id) REFERENCES memory_events(id),
            FOREIGN KEY (to_id) REFERENCES memory_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_id);
        CREATE INDEX IF NOT EXISTS idx_links_to   ON memory_links(to_id);
        CREATE INDEX IF NOT EXISTS idx_links_type ON memory_links(type);

        CREATE TABLE IF NOT EXISTS codenames (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            working_dir TEXT,
            description TEXT,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 0,
            project_id TEXT,
            UNIQUE (user_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_codename_user_used ON codenames(user_id, last_used_at DESC);

        CREATE TABLE IF NOT EXISTS memory_eq_state (
            user_id     TEXT PRIMARY KEY,
            valence     REAL NOT NULL,
            arousal     REAL NOT NULL,
            dominance   REAL NOT NULL,
            label       TEXT NOT NULL,
            confidence  REAL NOT NULL,
            updated_at  INTEGER NOT NULL
        );
    `);
}

function formatBucket(ts: number): string {
    const date = new Date(ts);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function rowToEvent(row: EventRow): MemoryEventRecord {
    return {
        id: row.id,
        ts: row.ts,
        timeBucket: row.time_bucket,
        userId: row.user_id,
        channelId: row.channel_id ?? undefined,
        codenameId: row.codename_id ?? undefined,
        type: row.type as MemoryEventType,
        role: row.role ? (row.role as MemoryEventRecord["role"]) : undefined,
        content: parseContent(row.content),
        parentId: row.parent_id ?? undefined,
        embeddingId: row.embedding_id ?? undefined,
        importance: row.importance,
    };
}

function readPromptAtomEntries(event: MemoryEventRecord): BrainVisibleAtom[] {
    const content = isRecord(event.content) ? event.content : null;
    const rawAtoms = content && Array.isArray(content.atoms) ? content.atoms : [];
    const visible: BrainVisibleAtom[] = [];
    for (const raw of rawAtoms) {
        const entry = parsePromptAtomEntry(raw, event);
        if (entry) visible.push(entry);
    }
    return visible;
}

function parsePromptAtomEntry(raw: unknown, event: MemoryEventRecord): BrainVisibleAtom | null {
    if (!isRecord(raw)) return null;
    const atom = parseMemoryAtom(raw.atom, event);
    const score = parseAtomScore(raw.score, atom?.id ?? event.id);
    if (!atom || !score) return null;
    return {
        atom,
        score,
        sourceEventId: event.id,
        sourceEventTs: event.ts,
    };
}

function parseMemoryAtom(raw: unknown, event: MemoryEventRecord): MemoryAtom | null {
    if (!isRecord(raw)) return null;
    const id = readString(raw.id);
    const episodeIds = readStringArray(raw.episodeIds);
    const userId = readString(raw.userId) ?? event.userId;
    const channelId = readString(raw.channelId) ?? event.channelId ?? null;
    const projectId = readString(raw.projectId);
    const role = readString(raw.role);
    const task = readString(raw.task);
    const context = readString(raw.context);
    const action = readString(raw.action);
    const outcome = readString(raw.outcome);
    const confidence = readNumber(raw.confidence);
    const priorWeight = readNumber(raw.priorWeight);
    const embedding = readNumberArray(raw.embedding);
    const text = readString(raw.text);
    const stage = readString(raw.stage);
    const createdAt = readString(raw.createdAt) ?? new Date(event.ts).toISOString();
    if (
        !id ||
        episodeIds.length === 0 ||
        !userId ||
        !channelId ||
        !projectId ||
        !role ||
        !task ||
        !context ||
        !action ||
        !outcome ||
        confidence === null ||
        priorWeight === null ||
        !text ||
        !stage
    ) {
        return null;
    }
    return {
        id,
        episodeIds,
        userId,
        channelId,
        projectId,
        role: role as MemoryAtom["role"],
        task,
        context,
        problem: readString(raw.problem) ?? undefined,
        action,
        outcome,
        success: readBoolean(raw.success) ?? undefined,
        confidence,
        priorWeight,
        embedding,
        text,
        stage: stage as MemoryAtom["stage"],
        createdAt,
        refinedAt: readString(raw.refinedAt) ?? undefined,
    };
}

function parseAtomScore(raw: unknown, atomId: string): AtomScore | null {
    if (!isRecord(raw)) return null;
    const recency = readNumber(raw.recency);
    const access = readNumber(raw.access);
    const successPrior = readNumber(raw.successPrior);
    const fanout = readNumber(raw.fanout);
    const total = readNumber(raw.total);
    const inboxDecayApplied = readBoolean(raw.inboxDecayApplied);
    if (
        recency === null ||
        access === null ||
        successPrior === null ||
        fanout === null ||
        total === null ||
        inboxDecayApplied === null
    ) {
        return null;
    }
    return {
        atomId: readString(raw.atomId) ?? atomId,
        recency,
        access,
        successPrior,
        fanout,
        total,
        inboxDecayApplied,
        explain: readString(raw.explain) ?? undefined,
    };
}

function rowToState(row: StateRow): MemoryStateRecord {
    return {
        eventId: row.event_id,
        activation: row.activation,
        decayScore: row.decay_score,
        accessCount: row.access_count,
        lastAccessed: row.last_accessed ?? undefined,
        resumedAt: row.resumed_at ?? undefined,
        status: row.status as MemoryStateRecord["status"],
    };
}

function rowToSummary(row: SummaryRow): MemorySummaryRecord {
    return {
        id: row.id,
        timeRange: row.time_range as SummaryRange,
        bucketKey: row.bucket_key,
        content: row.content,
        embeddingId: row.embedding_id ?? undefined,
        createdAt: row.created_at,
    };
}

function rowToLink(row: LinkRow): MemoryLinkRecord {
    return {
        id: row.id,
        fromId: row.from_id,
        toId: row.to_id,
        strength: row.strength,
        type: row.type as MemoryLinkType,
        createdAt: row.created_at,
    };
}

function rowToCodename(row: CodenameRow): CodenameRecord {
    return {
        id: row.id,
        name: row.name,
        workingDir: row.working_dir ?? undefined,
        description: row.description ?? undefined,
        userId: row.user_id,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        useCount: row.use_count,
        projectId: row.project_id ?? undefined,
    };
}

function rowToEq(row: EqStateRow): EqState {
    return {
        userId: row.user_id,
        valence: row.valence,
        arousal: row.arousal,
        dominance: row.dominance,
        label: row.label as EqLabel,
        confidence: row.confidence,
        updatedAt: row.updated_at,
    };
}

function parseContent(value: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // fallthrough
    }
    return { raw: value };
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return null;
}

function readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(date: Date | string): number {
    const parsed = date instanceof Date ? date.getTime() : Date.parse(date);
    return Number.isFinite(parsed) ? parsed : Date.now();
}
