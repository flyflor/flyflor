CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_scope_id ON memories(scope_id);
