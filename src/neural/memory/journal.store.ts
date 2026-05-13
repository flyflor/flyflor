import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import type { AtomScore, MemoryAtom, ModelRole } from "../../protocol/contracts/index.ts";

export interface JournalStoreOptions {
    journalRoot: string;
    /**
     * LF-R1 read-only grace: refuse appendEpisode targeting day partitions
     * whose dateKey is older than (now - graceDays). brain.db is canonical
     * after the grace expires; this guard prevents accidental backfills into
     * legacy day partitions. Set to <= 0 or omit to disable (default 60).
     */
    legacyGraceDays?: number;
}

export class JournalWriteRejectedError extends Error {
    readonly code = "JOURNAL_LEGACY_GRACE";
    constructor(
        readonly dateKey: string,
        readonly ageDays: number,
        readonly graceDays: number,
    ) {
        super(
            `journal write rejected: day=${dateKey} age=${ageDays}d > grace=${graceDays}d (LF-R1 brain.db is canonical)`,
        );
        this.name = "JournalWriteRejectedError";
    }
}

export interface JournalEpisodeInput {
    id: string;
    userId: string;
    channelId: string;
    projectId: string;
    role: ModelRole;
    text: string;
    createdAt: string;
}

export interface JournalAtomWrite {
    atom: MemoryAtom;
    score: AtomScore;
}

export interface JournalWriteResult {
    atomIds: string[];
    dbPath: string;
    episodeId: string;
    week: string;
}

export interface JournalDayLocation {
    dateKey: string;
    dbPath: string;
    week: string;
    weekDir: string;
    weekIndexPath: string;
    weekSummaryPath: string;
}

export interface JournalDayStats {
    atomCount: number;
    dateKey: string;
    dbPath: string;
    episodeCount: number;
    week: string;
}

export interface JournalVisibleAtom {
    atom: MemoryAtom;
    score: AtomScore;
}

export interface JournalVisibleAtomWindowInput {
    days?: number;
    limit?: number;
    minScore: number;
    projectId?: string;
    userId?: string;
}

interface AtomRow {
    id: string;
    episode_ids_json: string;
    user_id: string;
    channel_id: string;
    project_id: string;
    role: string;
    task: string;
    context: string;
    problem: string | null;
    action: string;
    outcome: string;
    success: number | null;
    confidence: number;
    prior_weight: number;
    embedding_json: string;
    text: string;
    stage: string;
    created_at: string;
    refined_at: string | null;
    score_recency: number;
    score_access: number;
    score_success_prior: number;
    score_fanout: number;
    score_total: number;
    score_inbox_decay_applied: number;
    score_explain: string | null;
}

/**
 * LF-P1 day-partitioned journal store.
 *
 * This encapsulates the public journal contract used by the memory hot path.
 */
export class JournalStore {
    constructor(private readonly options: JournalStoreOptions) {}

    private assertWritable(dateKey: string, createdAt: string): void {
        const grace = this.options.legacyGraceDays ?? 60;
        if (grace <= 0) return;
        const target = Date.parse(createdAt);
        if (!Number.isFinite(target)) return;
        const ageDays = (Date.now() - target) / 86_400_000;
        if (ageDays > grace) {
            throw new JournalWriteRejectedError(dateKey, Math.floor(ageDays), grace);
        }
    }

    locationFor(date: Date | string): JournalDayLocation {
        const day = normalizeDate(date);
        const { year, week } = isoWeek(day);
        const weekName = `W${String(week).padStart(2, "0")}`;
        const weekDir = join(this.options.journalRoot, String(year), weekName);
        const dateKey = formatDate(day);
        return {
            dateKey,
            dbPath: join(weekDir, `day_${dateKey}.db`),
            week: `${year}/${weekName}`,
            weekDir,
            weekIndexPath: join(weekDir, "week.index.surreal"),
            weekSummaryPath: join(weekDir, "week.summary.md"),
        };
    }

    async appendEpisode(input: JournalEpisodeInput, atoms: JournalAtomWrite[] = []): Promise<JournalWriteResult> {
        const location = this.locationFor(input.createdAt);
        this.assertWritable(location.dateKey, input.createdAt);
        await ensureWeekFiles(location);
        const db = openWritable(location.dbPath);
        try {
            createSchema(db);
            const insertEpisode = db.query(`
                INSERT INTO journal_episode (
                    id, user_id, channel_id, project_id, role, text, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const insertAtom = db.query(`
                INSERT INTO memory_atom (
                    id, episode_ids_json, user_id, channel_id, project_id, role,
                    task, context, problem, action, outcome, success, confidence,
                    prior_weight, embedding_json, text, stage, created_at, refined_at,
                    score_recency, score_access, score_success_prior, score_fanout,
                    score_total, score_inbox_decay_applied, score_explain
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const tx = db.transaction(() => {
                insertEpisode.run(
                    input.id,
                    input.userId,
                    input.channelId,
                    input.projectId,
                    input.role,
                    input.text,
                    input.createdAt,
                );
                for (const entry of atoms) {
                    assertAtomBelongsToEpisode(entry.atom, input.id);
                    insertAtom.run(
                        entry.atom.id,
                        JSON.stringify(entry.atom.episodeIds),
                        entry.atom.userId,
                        entry.atom.channelId,
                        entry.atom.projectId,
                        entry.atom.role,
                        entry.atom.task,
                        entry.atom.context,
                        entry.atom.problem ?? null,
                        entry.atom.action,
                        entry.atom.outcome,
                        typeof entry.atom.success === "boolean" ? (entry.atom.success ? 1 : 0) : null,
                        entry.atom.confidence,
                        entry.atom.priorWeight,
                        JSON.stringify(entry.atom.embedding),
                        entry.atom.text,
                        entry.atom.stage,
                        entry.atom.createdAt,
                        entry.atom.refinedAt ?? null,
                        entry.score.recency,
                        entry.score.access,
                        entry.score.successPrior,
                        entry.score.fanout,
                        entry.score.total,
                        entry.score.inboxDecayApplied ? 1 : 0,
                        entry.score.explain ?? null,
                    );
                }
            });
            tx();
        } finally {
            db.close();
        }
        return {
            atomIds: atoms.map((entry) => entry.atom.id),
            dbPath: location.dbPath,
            episodeId: input.id,
            week: location.week,
        };
    }

    async dayStats(date: Date | string): Promise<JournalDayStats> {
        const location = this.locationFor(date);
        const file = Bun.file(location.dbPath);
        if (!(await file.exists())) {
            return {
                atomCount: 0,
                dateKey: location.dateKey,
                dbPath: location.dbPath,
                episodeCount: 0,
                week: location.week,
            };
        }
        const db = new Database(location.dbPath, { readonly: true });
        try {
            return {
                atomCount: readCount(db, "memory_atom"),
                dateKey: location.dateKey,
                dbPath: location.dbPath,
                episodeCount: readCount(db, "journal_episode"),
                week: location.week,
            };
        } finally {
            db.close();
        }
    }

    async listVisibleAtoms(
        date: Date | string,
        input: { limit?: number; minScore: number; projectId?: string; userId?: string },
    ): Promise<JournalVisibleAtom[]> {
        const location = this.locationFor(date);
        const file = Bun.file(location.dbPath);
        if (!(await file.exists())) return [];
        const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
        const conditions = ["score_total >= ?"];
        const values: Array<number | string> = [input.minScore];
        if (input.projectId) {
            conditions.push("project_id = ?");
            values.push(input.projectId);
        }
        if (input.userId) {
            conditions.push("user_id = ?");
            values.push(input.userId);
        }

        const db = new Database(location.dbPath, { readonly: true });
        try {
            const rows = db
                .query(
                    `
                    SELECT * FROM memory_atom
                    WHERE ${conditions.join(" AND ")}
                    ORDER BY score_total DESC, created_at DESC
                    LIMIT ?
                `,
                )
                .all(...values, limit) as AtomRow[];
            return rows.map(rowToVisibleAtom);
        } finally {
            db.close();
        }
    }

    async listVisibleAtomsWindow(date: Date | string, input: JournalVisibleAtomWindowInput): Promise<JournalVisibleAtom[]> {
        const days = Math.max(1, Math.min(31, Math.floor(input.days ?? 7)));
        const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
        const end = normalizeDate(date);
        const all: JournalVisibleAtom[] = [];
        for (let offset = 0; offset < days; offset += 1) {
            const current = new Date(end.getTime() - offset * 86_400_000);
            all.push(
                ...(await this.listVisibleAtoms(current, {
                    limit,
                    minScore: input.minScore,
                    projectId: input.projectId,
                    userId: input.userId,
                })),
            );
        }
        all.sort((a, b) => {
            const byScore = b.score.total - a.score.total;
            if (byScore !== 0) return byScore;
            return b.atom.createdAt.localeCompare(a.atom.createdAt);
        });
        return all.slice(0, limit);
    }
}

async function ensureWeekFiles(location: JournalDayLocation): Promise<void> {
    await mkdir(dirname(location.dbPath), { recursive: true });
    await writeFile(location.weekIndexPath, "-- Flyflor week semantic index placeholder\n", { flag: "a" });
    await writeFile(location.weekSummaryPath, "# Week Summary\n\n", { flag: "a" });
}

function openWritable(dbPath: string): Database {
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    return db;
}

function createSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS journal_episode (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_atom (
            id TEXT PRIMARY KEY,
            episode_ids_json TEXT NOT NULL,
            user_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            role TEXT NOT NULL,
            task TEXT NOT NULL,
            context TEXT NOT NULL,
            problem TEXT,
            action TEXT NOT NULL,
            outcome TEXT NOT NULL,
            success INTEGER,
            confidence REAL NOT NULL,
            prior_weight REAL NOT NULL,
            embedding_json TEXT NOT NULL,
            text TEXT NOT NULL,
            stage TEXT NOT NULL,
            created_at TEXT NOT NULL,
            refined_at TEXT,
            score_recency REAL NOT NULL,
            score_access REAL NOT NULL,
            score_success_prior REAL NOT NULL,
            score_fanout REAL NOT NULL,
            score_total REAL NOT NULL,
            score_inbox_decay_applied INTEGER NOT NULL,
            score_explain TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_journal_episode_project_time
            ON journal_episode(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_memory_atom_visible
            ON memory_atom(score_total DESC, project_id, user_id, created_at DESC);
    `);
}

function assertAtomBelongsToEpisode(atom: MemoryAtom, episodeId: string): void {
    if (!atom.episodeIds.includes(episodeId)) {
        throw new Error(`Memory atom ${atom.id} does not reference episode ${episodeId}.`);
    }
}

function rowToVisibleAtom(row: AtomRow): JournalVisibleAtom {
    return {
        atom: {
            id: row.id,
            episodeIds: readJsonArray(row.episode_ids_json),
            userId: row.user_id,
            channelId: row.channel_id,
            projectId: row.project_id,
            role: row.role as ModelRole,
            task: row.task,
            context: row.context,
            problem: row.problem ?? undefined,
            action: row.action,
            outcome: row.outcome,
            success: row.success === null ? undefined : row.success === 1,
            confidence: row.confidence,
            priorWeight: row.prior_weight,
            embedding: readJsonNumberArray(row.embedding_json),
            text: row.text,
            stage: row.stage as MemoryAtom["stage"],
            createdAt: row.created_at,
            refinedAt: row.refined_at ?? undefined,
        },
        score: {
            atomId: row.id,
            recency: row.score_recency,
            access: row.score_access,
            successPrior: row.score_success_prior,
            fanout: row.score_fanout,
            total: row.score_total,
            inboxDecayApplied: row.score_inbox_decay_applied === 1,
            explain: row.score_explain ?? undefined,
        },
    };
}

function readJsonArray(value: string): string[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function readJsonNumberArray(value: string): number[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
}

function readCount(db: Database, table: string): number {
    const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
}

function normalizeDate(date: Date | string): Date {
    if (date instanceof Date) {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }
    const parsed = new Date(date);
    if (!Number.isFinite(parsed.getTime())) {
        throw new Error(`Invalid journal date: ${date}`);
    }
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function formatDate(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}_${mm}_${dd}`;
}

function isoWeek(date: Date): { year: number; week: number } {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return { year: day.getUTCFullYear(), week };
}
