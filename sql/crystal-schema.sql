pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists crystal_candidates (
  id text primary key,
  pattern_key text not null,
  ask_context text not null,
  resolution text not null,
  hit_count integer not null default 0,
  first_hit_at integer not null,
  last_hit_at integer not null,
  status text not null
);

create index if not exists idx_crystal_candidates_pattern
  on crystal_candidates(pattern_key, status);

create table if not exists crystal_gems (
  id text primary key,
  name text not null,
  summary text not null,
  pattern_key text not null,
  prompt_template text not null,
  confidence real not null,
  hit_count integer not null default 0,
  last_matched_at integer not null,
  created_at integer not null,
  updated_at integer not null,
  status text not null
);

create index if not exists idx_crystal_gems_pattern
  on crystal_gems(pattern_key, status);

create table if not exists crystal_ask_log (
  id text primary key,
  ask text not null,
  answer text not null,
  turn_id text not null,
  created_at integer not null
);

create index if not exists idx_crystal_ask_log_turn
  on crystal_ask_log(turn_id, created_at);
