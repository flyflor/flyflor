pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists brain_runtime_sessions (
  id text primary key,
  started_at integer not null,
  project_root text not null,
  metadata text not null
);

create table if not exists brain_turns (
  id text primary key,
  runtime_session_id text not null,
  conversation_id text not null,
  status text not null,
  started_at integer not null,
  completed_at integer,
  error text,
  metadata text not null
);

create index if not exists idx_brain_turns_conversation_started
  on brain_turns(conversation_id, started_at);

create table if not exists brain_messages (
  id text primary key,
  turn_id text not null,
  conversation_id text not null,
  role text not null,
  content text not null,
  visible_reasoning text,
  created_at integer not null,
  metadata text not null
);

create index if not exists idx_brain_messages_turn
  on brain_messages(turn_id, created_at);

create table if not exists brain_events (
  id integer primary key autoincrement,
  turn_id text,
  conversation_id text,
  type text not null,
  payload text not null,
  created_at integer not null
);

create index if not exists idx_brain_events_turn_created
  on brain_events(turn_id, created_at);

create table if not exists brain_tool_calls (
  id text primary key,
  turn_id text not null,
  tool_name text not null,
  input text not null,
  status text not null,
  output text,
  artifact_path text,
  error text,
  started_at integer not null,
  completed_at integer,
  metadata text not null
);

create index if not exists idx_brain_tool_calls_turn_started
  on brain_tool_calls(turn_id, started_at);

create table if not exists brain_subagents (
  id text primary key,
  turn_id text,
  name text not null,
  worktree_path text,
  status text not null,
  prompt text,
  handoff text,
  started_at integer not null,
  completed_at integer,
  metadata text not null
);

create table if not exists brain_artifacts (
  id text primary key,
  turn_id text,
  kind text not null,
  path text not null,
  bytes integer not null,
  created_at integer not null,
  metadata text not null
);

create table if not exists brain_recovery_points (
  id text primary key,
  turn_id text,
  conversation_id text,
  state text not null,
  payload text not null,
  created_at integer not null
);

create index if not exists idx_brain_recovery_created
  on brain_recovery_points(created_at);
