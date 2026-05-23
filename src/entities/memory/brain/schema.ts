import type { Database } from "bun:sqlite";

/**
 * Schema installer for the single-file brain database.
 *
 * BrainStore owns connection lifecycle; this class owns DDL so the store does
 * not grow a bottom-level schema function block.
 */
export class BrainSchema {
    public install(db: Database): void {
        this.resetLegacyRuntimeTables(db);
        db.exec(`
            CREATE TABLE IF NOT EXISTS memory_events (
                id TEXT PRIMARY KEY,
                ts INTEGER NOT NULL,
                time_bucket TEXT NOT NULL,
                owner_key TEXT NOT NULL,
                source_key TEXT,
                source_surface TEXT,
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
            CREATE INDEX IF NOT EXISTS idx_events_owner    ON memory_events(owner_key, ts);
            CREATE INDEX IF NOT EXISTS idx_events_owner_type_ts ON memory_events(owner_key, type, ts DESC);
            -- Ask pending checks and continuation evidence checks are relationship lookups, not semantic text reads.
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

            CREATE TABLE IF NOT EXISTS brain_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

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
                created_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 0,
                scope_id TEXT,
                UNIQUE (name)
            );
            CREATE INDEX IF NOT EXISTS idx_codename_used ON codenames(last_used_at DESC);

            CREATE TABLE IF NOT EXISTS scopes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                goal TEXT,
                project_dir TEXT NOT NULL,
                project_memory_dir TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_scopes_used ON scopes(last_used_at DESC);

            CREATE TABLE IF NOT EXISTS memory_eq_state (
                owner_key     TEXT PRIMARY KEY,
                source_key    TEXT,
                valence       REAL NOT NULL,
                arousal       REAL NOT NULL,
                dominance     REAL NOT NULL,
                label         TEXT NOT NULL,
                confidence    REAL NOT NULL,
                updated_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_plans (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                source_key TEXT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                status TEXT NOT NULL,
                progress REAL NOT NULL,
                step_count INTEGER NOT NULL,
                completed_step_count INTEGER NOT NULL,
                steps_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_event_id TEXT,
                source_ask_id TEXT,
                source_blackboard_turn_id TEXT,
                source_replay_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_task_plans_owner_updated ON task_plans(owner_key, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_plans_source_event ON task_plans(source_event_id);
            CREATE INDEX IF NOT EXISTS idx_task_plans_blackboard ON task_plans(source_blackboard_turn_id);

            CREATE TABLE IF NOT EXISTS context_forks (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                source_key TEXT,
                parent_id TEXT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                scope_summary TEXT NOT NULL,
                max_context_tokens INTEGER NOT NULL,
                inherited_event_ids_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_event_id TEXT,
                source_ask_id TEXT,
                source_blackboard_turn_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_context_forks_owner_updated ON context_forks(owner_key, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_context_forks_source_event ON context_forks(source_event_id);
            CREATE INDEX IF NOT EXISTS idx_context_forks_blackboard ON context_forks(source_blackboard_turn_id);

            CREATE TABLE IF NOT EXISTS replay_records (
                id TEXT PRIMARY KEY,
                owner_key TEXT NOT NULL,
                source_key TEXT,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                detail TEXT,
                visible_facts_json TEXT NOT NULL,
                open_questions_json TEXT NOT NULL,
                task_plan_id TEXT,
                context_fork_id TEXT,
                blackboard_turn_id TEXT,
                source_event_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_replay_records_owner_updated ON replay_records(owner_key, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_replay_records_source_event ON replay_records(source_event_id);
            CREATE INDEX IF NOT EXISTS idx_replay_records_blackboard ON replay_records(blackboard_turn_id);
        `);
    }

    /**
     * Legacy brain.db data is not carried across the release-seal boundary.
     * If an old table/column shape is detected, clear the runtime ledger tables
     * and let the canonical DDL below recreate an empty current schema.
     */
    private resetLegacyRuntimeTables(db: Database): void {
        if (!this.hasLegacyRuntimeSchema(db)) return;
        db.exec("PRAGMA foreign_keys = OFF;");
        for (const table of [
            "memory_links",
            "memory_state",
            "memory_events",
            "memory_summary",
            "memory_eq_state",
            "task_plans",
            "context_forks",
            "replay_records",
            "scene_records",
            "codenames",
            "scopes",
            "projects",
            "brain_meta",
        ]) {
            db.exec(`DROP TABLE IF EXISTS ${table};`);
        }
        db.exec("PRAGMA foreign_keys = ON;");
    }

    public hasLegacyRuntimeSchema(db: Database): boolean {
        if (this.tableExists(db, "projects") || this.tableExists(db, "scene_records")) return true;
        if (this.hasLegacyColumns(db, "memory_events", [
            "id",
            "ts",
            "time_bucket",
            "owner_key",
            "source_key",
            "source_surface",
            "codename_id",
            "type",
            "role",
            "content",
            "parent_id",
            "embedding_id",
            "importance",
        ])) return true;
        if (this.hasLegacyColumns(db, "codenames", [
            "id",
            "name",
            "working_dir",
            "description",
            "created_at",
            "last_used_at",
            "use_count",
            "scope_id",
        ])) return true;
        if (this.hasLegacyColumns(db, "scopes", [
            "id",
            "title",
            "goal",
            "project_dir",
            "project_memory_dir",
            "created_at",
            "updated_at",
            "last_used_at",
            "use_count",
        ])) return true;
        if (this.hasLegacyColumns(db, "memory_eq_state", [
            "owner_key",
            "source_key",
            "valence",
            "arousal",
            "dominance",
            "label",
            "confidence",
            "updated_at",
        ])) return true;
        if (this.hasLegacyColumns(db, "task_plans", [
            "id",
            "owner_key",
            "source_key",
            "title",
            "summary",
            "status",
            "progress",
            "step_count",
            "completed_step_count",
            "steps_json",
            "created_at",
            "updated_at",
            "source_event_id",
            "source_ask_id",
            "source_blackboard_turn_id",
            "source_replay_id",
        ])) return true;
        if (this.hasLegacyColumns(db, "context_forks", [
            "id",
            "owner_key",
            "source_key",
            "parent_id",
            "title",
            "summary",
            "scope_summary",
            "max_context_tokens",
            "inherited_event_ids_json",
            "created_at",
            "updated_at",
            "source_event_id",
            "source_ask_id",
            "source_blackboard_turn_id",
        ])) return true;
        return this.hasLegacyColumns(db, "replay_records", [
            "id",
            "owner_key",
            "source_key",
            "kind",
            "title",
            "summary",
            "detail",
            "visible_facts_json",
            "open_questions_json",
            "task_plan_id",
            "context_fork_id",
            "blackboard_turn_id",
            "source_event_id",
            "created_at",
            "updated_at",
        ]);
    }

    private hasLegacyColumns(db: Database, table: string, canonicalColumns: string[]): boolean {
        if (!this.tableExists(db, table)) return false;
        const columns = this.columns(db, table);
        if (["user_id", "channel_id", "project_id", "legacy_source_key", "audit_source_key", "source_scene_id"].some((name) => columns.includes(name))) {
            return true;
        }
        return canonicalColumns.some((name) => !columns.includes(name));
    }

    private tableExists(db: Database, table: string): boolean {
        const row = db
            .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
            .get(table);
        return Boolean(row);
    }

    private columns(db: Database, table: string): string[] {
        return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    }

}

export const brainSchema = new BrainSchema();
