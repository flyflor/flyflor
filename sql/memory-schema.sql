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
  created_at integer not null,
  tool_calls_json text,
  tool_call_id text
);

create index if not exists idx_messages_conversation_created
  on messages(conversation_id, created_at);

create table if not exists context_checkpoints (
  id text primary key,
  conversation_id text not null,
  summary text not null,
  created_at integer not null
);

create table if not exists memory_documents (
  id text primary key,
  namespace text not null,
  source_kind text not null,
  source_id text not null,
  title text not null,
  content text not null,
  created_at integer not null,
  updated_at integer not null,
  metadata text not null
);

create index if not exists idx_memory_documents_namespace
  on memory_documents(namespace, updated_at);

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

create table if not exists memory_relations (
  id integer primary key autoincrement,
  from_ref text not null,
  to_ref text not null,
  kind text not null,
  weight real not null default 1,
  evidence text not null default '',
  created_at integer not null
);

create index if not exists idx_memory_relations_from
  on memory_relations(from_ref, kind);

create index if not exists idx_memory_relations_to
  on memory_relations(to_ref, kind);

create unique index if not exists idx_memory_relations_unique
  on memory_relations(from_ref, to_ref, kind);

create table if not exists memory_edges (
  id integer primary key autoincrement,
  from_id integer not null,
  to_id integer not null,
  kind text not null,
  created_at integer not null
);

create table if not exists memory_facts (
  id text primary key,
  namespace text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence real not null,
  source_kind text not null,
  source_id text not null,
  created_at integer not null,
  updated_at integer not null
);

create index if not exists idx_memory_facts_subject
  on memory_facts(namespace, subject, predicate);

create index if not exists idx_memory_facts_source
  on memory_facts(source_kind, source_id);

create table if not exists memory_claims (
  id text primary key,
  namespace text not null,
  claim text not null,
  status text not null,
  evidence text not null,
  source_kind text not null,
  source_id text not null,
  created_at integer not null,
  updated_at integer not null
);

create table if not exists memory_decisions (
  id text primary key,
  namespace text not null,
  decision text not null,
  rationale text not null,
  status text not null,
  source_kind text not null,
  source_id text not null,
  created_at integer not null,
  updated_at integer not null
);

create table if not exists memory_tasks (
  id text primary key,
  namespace text not null,
  title text not null,
  status text not null,
  evidence text not null,
  source_kind text not null,
  source_id text not null,
  created_at integer not null,
  updated_at integer not null
);

create index if not exists idx_memory_tasks_status
  on memory_tasks(namespace, status, updated_at);

create table if not exists memory_artifacts (
  id text primary key,
  kind text not null,
  path text not null,
  source_kind text not null,
  source_id text not null,
  bytes integer not null,
  created_at integer not null,
  metadata text not null
);

create index if not exists idx_memory_artifacts_source
  on memory_artifacts(source_kind, source_id);

create table if not exists memory_retrieval_traces (
  id text primary key,
  conversation_id text,
  query text not null,
  strategy text not null,
  result_ids text not null,
  diagnostics text not null,
  created_at integer not null
);

create index if not exists idx_memory_retrieval_created
  on memory_retrieval_traces(created_at);

create table if not exists memory_recovery_state (
  key text primary key,
  state text not null,
  payload text not null,
  updated_at integer not null
);

create table if not exists memory_jobs (
  id text primary key,
  kind text not null,
  payload text not null,
  status text not null,
  created_at integer not null
);
