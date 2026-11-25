-- SPECIAL ROUND TIMER + TEST RUN: one shared clock for every device.
-- Run this ONCE in Supabase -> SQL Editor, AFTER 20261120000000_special_round.sql
-- (running it again is safe).
--
-- What this does (nothing is deleted, no existing row is changed):
--   * adds 3 new keys to the existing app_settings table:
--       special_round_duration_min : how long the round lasts, in minutes (default 15)
--       special_round_run_started  : server time (ms) the OFFICIAL round was unlocked
--       special_round_test         : the developers-only TEST RUN {active, started_at}
--   * special_round_status() now also returns those values. The old keys are
--     unchanged, so an old copy of the website keeps working.
--     The test run is only returned to developers (is_admin()): regular users
--     never receive it, so they can never be shown it.
--   * special_round_set() keeps doing exactly what it did (the unlock switch)
--     and additionally stamps the start time when it goes from OFF to ON, and
--     ends any test run. Turning it OFF and ON again starts a new timer.
--   * 2 new developer-only functions: special_round_set_duration, special_round_test_set.
-- The December 7, 2026 3:00 PM (Asia/Manila) deadline is NOT stored here. It stays
-- fixed in the website code, so nothing in this file can move it.

-- Server time as whole milliseconds since 1970 (what the website uses).
create or replace function public.special_round_now_ms()
returns bigint
language sql
stable
as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- Same function as before, plus: duration_min, run_started_at, test.
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
    'epoch', coalesce(
      (select (value)::text::int from public.app_settings where key = 'special_round_epoch'), 0),
    'song_version', (
      select updated_at from public.app_settings
      where key = 'special_round_song' and value <> 'null'::jsonb),
    'now', clock_timestamp(),
    'now_ms', public.special_round_now_ms(),
    'duration_min', coalesce(
      (select (value)::text::int from public.app_settings where key = 'special_round_duration_min'), 15),
    -- Only meaningful while unlocked. Falls back to the moment the switch was
    -- last saved, for a round that was unlocked before this file was run.
    'run_started_at', case
      when coalesce(
        (select (value)::text = 'true' from public.app_settings where key = 'special_round_unlocked'), false)
      then coalesce(
        (select (value)::text::bigint from public.app_settings where key = 'special_round_run_started'),
        (select floor(extract(epoch from updated_at) * 1000)::bigint
           from public.app_settings where key = 'special_round_unlocked'))
      else null end,
    -- Developers only.
    'test', case when public.is_admin()
      then (select value from public.app_settings where key = 'special_round_test')
      else null end
  );
$$;

-- The unlock switch: unchanged behaviour, plus the shared start time.
create or replace function public.special_round_set(p_unlocked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was boolean;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  v_was := coalesce(
    (select (value)::text = 'true' from public.app_settings where key = 'special_round_unlocked'), false);

  insert into public.app_settings (key, value, updated_at)
  values ('special_round_unlocked', to_jsonb(coalesce(p_unlocked, false)), clock_timestamp())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;

  -- OFF -> ON: the official timer starts now, and any test run is over.
  if coalesce(p_unlocked, false) and not v_was then
    insert into public.app_settings (key, value, updated_at)
    values ('special_round_run_started', to_jsonb(public.special_round_now_ms()), clock_timestamp())
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;

    insert into public.app_settings (key, value, updated_at)
    values ('special_round_test', jsonb_build_object('active', false), clock_timestamp())
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  end if;
end;
$$;

-- Developers only: the round's length in minutes (1 to 60). Applies to the
-- official round and to TEST RUN, for every group, immediately.
create or replace function public.special_round_set_duration(p_minutes int)
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
  values ('special_round_duration_min',
          to_jsonb(least(60, greatest(1, coalesce(p_minutes, 15)))),
          clock_timestamp())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

-- Developers only: start or end the TEST RUN. It never touches the unlock
-- switch or the deadline. Starting while one is already running does nothing
-- (end it first to restart).
create or replace function public.special_round_test_set(p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_running boolean;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  v_running := coalesce(
    (select (value ->> 'active') = 'true' from public.app_settings where key = 'special_round_test'), false);

  if coalesce(p_active, false) then
    if v_running then
      return;
    end if;
    insert into public.app_settings (key, value, updated_at)
    values ('special_round_test',
            jsonb_build_object('active', true, 'started_at', public.special_round_now_ms()),
            clock_timestamp())
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  else
    insert into public.app_settings (key, value, updated_at)
    values ('special_round_test', jsonb_build_object('active', false), clock_timestamp())
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  end if;
end;
$$;

revoke all on function public.special_round_now_ms()                from public, anon;
revoke all on function public.special_round_status()                from public, anon;
revoke all on function public.special_round_set(boolean)            from public, anon;
revoke all on function public.special_round_set_duration(int)       from public, anon;
revoke all on function public.special_round_test_set(boolean)       from public, anon;
grant execute on function public.special_round_now_ms()             to authenticated;
grant execute on function public.special_round_status()             to authenticated;
grant execute on function public.special_round_set(boolean)         to authenticated;  -- checks is_admin() inside
grant execute on function public.special_round_set_duration(int)    to authenticated;  -- checks is_admin() inside
grant execute on function public.special_round_test_set(boolean)    to authenticated;  -- checks is_admin() inside
