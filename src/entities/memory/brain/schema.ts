import type { Database } from "bun:sqlite";

/**
 * Schema installer for the single-file brain database.
 *
 * BrainStore owns connection lifecycle; this class owns DDL so the store does
 * not grow a bottom-level schema function block.
 */
export class BrainSchema {
    public install(db: Database): void {
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
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 0,
                project_id TEXT,
                UNIQUE (user_id, name)
            );
            CREATE INDEX IF NOT EXISTS idx_codename_user_used ON codenames(user_id, last_used_at DESC);

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                goal TEXT,
                project_dir TEXT NOT NULL,
                project_memory_dir TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_projects_user_used ON projects(user_id, last_used_at DESC);

            CREATE TABLE IF NOT EXISTS memory_eq_state (
                user_id     TEXT PRIMARY KEY,
                valence     REAL NOT NULL,
                arousal     REAL NOT NULL,
                dominance   REAL NOT NULL,
                label       TEXT NOT NULL,
                confidence  REAL NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_plans (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
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
                source_scene_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_task_plans_user_updated ON task_plans(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_plans_source_event ON task_plans(source_event_id);
            CREATE INDEX IF NOT EXISTS idx_task_plans_blackboard ON task_plans(source_blackboard_turn_id);

            CREATE TABLE IF NOT EXISTS context_forks (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
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
            CREATE INDEX IF NOT EXISTS idx_context_forks_user_updated ON context_forks(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_context_forks_source_event ON context_forks(source_event_id);
            CREATE INDEX IF NOT EXISTS idx_context_forks_blackboard ON context_forks(source_blackboard_turn_id);

            CREATE TABLE IF NOT EXISTS scene_records (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
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
            CREATE INDEX IF NOT EXISTS idx_scene_records_user_updated ON scene_records(user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_scene_records_source_event ON scene_records(source_event_id);
            CREATE INDEX IF NOT EXISTS idx_scene_records_blackboard ON scene_records(blackboard_turn_id);
        `);
    }
}

export const brainSchema = new BrainSchema();
