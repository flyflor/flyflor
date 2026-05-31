pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists scopes (
  id text primary key,
  name text not null,
  codename text not null unique,
  namespace text not null,
  keywords text not null,
  constitution text not null,
  status text not null,
  created_at integer not null,
  updated_at integer not null
);

create index if not exists idx_scopes_namespace
  on scopes(namespace, updated_at);

create table if not exists scope_recall_log (
  id text primary key,
  scope_id text not null,
  query text not null,
  result_ids text not null,
  created_at integer not null
);

create index if not exists idx_scope_recall_log_scope
  on scope_recall_log(scope_id, created_at);

create table if not exists scope_mirrors (
  id text primary key,
  scope_id text not null,
  memory_chunk_id integer not null,
  mirrored_at integer not null
);

create index if not exists idx_scope_mirrors_scope
  on scope_mirrors(scope_id, memory_chunk_id);
