-- SPECIAL ROUND: settings shared by every device.
-- Run this ONCE in Supabase -> SQL Editor (running it again is safe).
-- It only ADDS a small table and a few functions. It does not touch, change or
-- delete any existing table, policy, storage bucket or data.
--
-- What is kept here:
--   special_round_unlocked : the developer's "Unlock Special Round" switch.
--                            Groups can only USE the round while this is on:
--                            when the countdown ends they still wait for the
--                            system confirmation until a developer turns it on
--   special_round_song     : the ONE song every group uses for the Special
--                            Round (analysis result; the mp3 itself is in the
--                            existing "audio" bucket)
-- (An older version of this file also made special_round_set_started; it is no
-- longer used and can stay or be dropped.)
-- The December 7, 2026 3:00 PM (Asia/Manila) deadline is NOT stored here: it is
-- fixed in the website code, so none of these switches can ever move it.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.app_settings enable row level security;
-- No policies on purpose: the browser can only use the functions below.
revoke all on public.app_settings from public, anon, authenticated;

-- Small status, polled by every device. Also returns the server clock so every
-- device shows the same countdown even if its own clock is off.
create or replace function public.special_round_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'unlocked', coalesce(
      (select (value)::text = 'true' from public.app_settings where key = 'special_round_unlocked'), false),
    -- counts "Remove Special Round song" resets (see special_round_remove_song)
    'epoch', coalesce(
      (select (value)::text::int from public.app_settings where key = 'special_round_epoch'), 0),
    'song_version', (
      select updated_at from public.app_settings
      where key = 'special_round_song' and value <> 'null'::jsonb),
    'now', clock_timestamp()
  );
$$;

-- The song itself (only fetched when its version changes).
create or replace function public.special_round_song_get()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when value = 'null'::jsonb then null else value end
  from public.app_settings where key = 'special_round_song';
$$;

-- ---------- developers (admins) only: change the settings ----------
create or replace function public.special_round_set(p_unlocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  insert into public.app_settings (key, value, updated_at)
  values ('special_round_unlocked', to_jsonb(coalesce(p_unlocked, false)), clock_timestamp())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.special_round_set_song(p_song jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  insert into public.app_settings (key, value, updated_at)
  values ('special_round_song', coalesce(p_song, 'null'::jsonb), clock_timestamp())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

-- "Remove Special Round song": removes the song AND tells every group to clear
-- its Special Round keyframes (each group does it the next time it opens the
-- round). Replacing the song does NOT use this, so replacing keeps keyframes.
create or replace function public.special_round_remove_song()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  insert into public.app_settings (key, value, updated_at)
  values ('special_round_song', 'null'::jsonb, clock_timestamp())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;
  insert into public.app_settings (key, value, updated_at)
  values ('special_round_epoch', to_jsonb(1), clock_timestamp())
  on conflict (key) do update
    set value = to_jsonb(coalesce((public.app_settings.value)::text::int, 0) + 1),
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.special_round_status()               from public, anon;
revoke all on function public.special_round_song_get()             from public, anon;
revoke all on function public.special_round_set(boolean)           from public, anon;
revoke all on function public.special_round_set_song(jsonb)        from public, anon;
revoke all on function public.special_round_remove_song()          from public, anon;
grant execute on function public.special_round_status()             to authenticated;
grant execute on function public.special_round_song_get()           to authenticated;
grant execute on function public.special_round_set(boolean)         to authenticated;  -- checks is_admin() inside
grant execute on function public.special_round_set_song(jsonb)      to authenticated;  -- checks is_admin() inside
grant execute on function public.special_round_remove_song()        to authenticated;  -- checks is_admin() inside
