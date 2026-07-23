-- Normalize display names: one row per player, referenced by scores, so a
-- rename updates a single row and every board reflects it instantly (instead of
-- a name copied onto each score row and going stale until the next PB).

create table if not exists players (
  user_id text primary key,
  display_name text not null default 'Player',
  updated_at timestamptz not null default now()
);

alter table players enable row level security;
drop policy if exists players_read on players;
create policy players_read on players for select using (true);
grant select on players to anon, authenticated;
grant all on players to service_role;

-- Backfill from the existing denormalized names so no score is orphaned. Guarded
-- so re-running after the column is dropped is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'scores' and column_name = 'display_name'
  ) then
    insert into players (user_id, display_name)
    select user_id, max(display_name) from scores group by user_id
    on conflict (user_id) do nothing;
  end if;
end $$;

-- Point scores at players, then drop the denormalized copy.
alter table scores
  drop constraint if exists scores_player_fk,
  add constraint scores_player_fk foreign key (user_id) references players(user_id) on delete cascade;

alter table scores drop column if exists display_name;
