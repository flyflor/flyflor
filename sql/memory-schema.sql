pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists conversations (
  id text primary key,
  title text not null,
  created_at integer not null
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null,
  role text not null,
  content text not null,
  created_at integer not null
);

create index if not exists idx_messages_conversation_created
  on messages(conversation_id, created_at);

create table if not exists context_checkpoints (
  id text primary key,
  conversation_id text not null,
  summary text not null,
  created_at integer not null
);

create table if not exists memory_chunks (
  id integer primary key autoincrement,
  source_kind text not null,
  source_id text not null,
  content text not null,
  importance real not null,
  created_at integer not null
);

create index if not exists idx_memory_chunks_source
  on memory_chunks(source_kind, source_id);

create table if not exists memory_entities (
  id integer primary key autoincrement,
  name text not null unique,
  kind text not null,
  created_at integer not null
);

create table if not exists memory_edges (
  id integer primary key autoincrement,
  from_id integer not null,
  to_id integer not null,
  kind text not null,
  created_at integer not null
);

create table if not exists memory_jobs (
  id text primary key,
  kind text not null,
  payload text not null,
  status text not null,
  created_at integer not null
);
