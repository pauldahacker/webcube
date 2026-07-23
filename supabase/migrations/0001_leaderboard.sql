-- Leaderboard + ghost storage for webcube.
-- Identity is an opaque user_id string ('guest:<uuid>' now, 'cg:<userId>' at
-- Full Launch) so these tables never change when auth swaps.

create extension if not exists pgcrypto;

-- Thin track registry; geometry stays client-side (the .json maps are the
-- single source of truth). version bumps segregate the board when a track's
-- shape changes, so old times never get compared against a different course.
create table if not exists tracks (
  slug text primary key,
  name text not null,
  version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ghost replay blob, one per (track, version, player), base64 text so the DB
-- never has to know the codec (src/net/ghostcodec.ts owns the format).
create table if not exists ghosts (
  id uuid primary key default gen_random_uuid(),
  track_slug text not null,
  track_version int not null,
  user_id text not null,
  blob text not null,
  frame_count integer not null,
  created_at timestamptz not null default now(),
  unique (track_slug, track_version, user_id)
);

-- One best row per (track, version, player).
create table if not exists scores (
  track_slug text not null references tracks(slug),
  track_version int not null,
  user_id text not null,
  display_name text not null default 'Player',
  time_ms integer not null check (time_ms > 0),
  verified boolean not null default false,
  ghost_id uuid references ghosts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (track_slug, track_version, user_id)
);

-- Ranking + "rival directly above me" both walk this order.
create index if not exists scores_board_idx
  on scores (track_slug, track_version, time_ms);

-- Public read: a leaderboard and its ghosts are public competition data.
-- Writes are the submit-score edge function's job (service role, bypasses RLS)
-- so anon clients can never post an unvalidated score.
alter table tracks enable row level security;
alter table scores enable row level security;
alter table ghosts enable row level security;
drop policy if exists tracks_read on tracks;
drop policy if exists scores_read on scores;
drop policy if exists ghosts_read on ghosts;
create policy tracks_read on tracks for select using (true);
create policy scores_read on scores for select using (true);
create policy ghosts_read on ghosts for select using (true);

-- Expose exactly these three tables through the Data API by name, so reads work
-- even with "automatically expose new tables" off. Rows are still gated by the
-- RLS policies above.
grant select on tracks, scores, ghosts to anon, authenticated;

-- The submit-score edge function connects as service_role. With "auto-expose new
-- tables" off it gets no privileges automatically, so grant them explicitly (it
-- bypasses RLS, but table-level GRANTs are still checked first).
grant all on tracks, scores, ghosts to service_role;

-- Seed the current maps (slug = map filename without .json).
insert into tracks (slug, name) values
  ('track2', 'Try Not To Drift'),
  ('firstreal', 'First Map')
on conflict (slug) do nothing;
