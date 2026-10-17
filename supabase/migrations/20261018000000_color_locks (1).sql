-- ONE color lock per group, shared by every device.
-- Run this ONCE in Supabase -> SQL Editor. Safe to run twice.
-- It does not touch or delete any existing data.
--
-- How it works: the color combo is now saved here (scrambled, never as plain
-- text) instead of in each browser. The wrong-guess counter and the 24-hour
-- lockout live here too, so they are shared by every device as well.
-- The table has no public access at all; the browser can only use the small
-- functions below (so nobody can read the scrambled combos and guess them).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.color_locks (
  group_id     text primary key,          -- the group's node id
  combo_hash   text not null,             -- bcrypt of the combo, never plain text
  fails        int  not null default 0,   -- wrong guesses so far
  locked_until timestamptz,               -- set when 3 wrong guesses are used
  created_at   timestamptz not null default clock_timestamp()
);

alter table public.color_locks enable row level security;
-- No policies on purpose: only the functions below can touch this table.
revoke all on public.color_locks from public, anon, authenticated;

-- ---------- status: does this group have a lock, and is it locked out? ----------
create or replace function public.color_lock_status(p_group_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.color_locks;
begin
  select * into r from public.color_locks where group_id = p_group_id;

  if not found then
    return jsonb_build_object('exists', false, 'locked_until', null, 'fails_left', 3);
  end if;

  if r.locked_until is not null and r.locked_until > clock_timestamp() then
    return jsonb_build_object('exists', true, 'locked_until', r.locked_until, 'fails_left', 0);
  end if;

  if r.locked_until is not null then
    -- the 24 hours ran out: start fresh
    return jsonb_build_object('exists', true, 'locked_until', null, 'fails_left', 3);
  end if;

  return jsonb_build_object(
    'exists', true, 'locked_until', null, 'fails_left', greatest(0, 3 - r.fails)
  );
end;
$$;

-- ---------- create: first device to set a combo wins ----------
create or replace function public.color_lock_create(p_group_id text, p_combo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n int;
begin
  if p_group_id is null or length(p_group_id) = 0 or length(p_group_id) > 100 then
    raise exception 'bad group id';
  end if;
  if p_combo is null or length(p_combo) = 0 or length(p_combo) > 200 then
    raise exception 'bad combo';
  end if;

  insert into public.color_locks (group_id, combo_hash)
  values (p_group_id, crypt(p_combo, gen_salt('bf')))
  on conflict (group_id) do nothing;

  get diagnostics n = row_count;
  -- created = false means another device made this group's lock first
  return jsonb_build_object('created', n > 0);
end;
$$;

-- ---------- check: right combo? counts wrong guesses for ALL devices ----------
create or replace function public.color_lock_check(p_group_id text, p_combo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r         public.color_locks;
  v_fails   int;
  v_until   timestamptz;
  max_fails constant int := 3;
begin
  -- "for update" makes two devices guessing at the same moment line up in a queue
  select * into r from public.color_locks where group_id = p_group_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'exists', false, 'locked_until', null, 'fails_left', max_fails);
  end if;

  if r.locked_until is not null and r.locked_until > clock_timestamp() then
    return jsonb_build_object('ok', false, 'exists', true, 'locked_until', r.locked_until, 'fails_left', 0);
  end if;

  v_fails := r.fails;
  if r.locked_until is not null then
    v_fails := 0;  -- old lockout ended
  end if;

  if r.combo_hash = crypt(coalesce(p_combo, ''), r.combo_hash) then
    update public.color_locks set fails = 0, locked_until = null where group_id = p_group_id;
    return jsonb_build_object('ok', true, 'exists', true, 'locked_until', null, 'fails_left', max_fails);
  end if;

  v_fails := v_fails + 1;

  if v_fails >= max_fails then
    v_until := clock_timestamp() + interval '24 hours';
    update public.color_locks set fails = v_fails, locked_until = v_until where group_id = p_group_id;
    return jsonb_build_object('ok', false, 'exists', true, 'locked_until', v_until, 'fails_left', 0);
  end if;

  update public.color_locks set fails = v_fails, locked_until = null where group_id = p_group_id;
  return jsonb_build_object('ok', false, 'exists', true, 'locked_until', null, 'fails_left', max_fails - v_fails);
end;
$$;

-- ---------- admin only: which groups have a lock, and reset ----------
create or replace function public.color_lock_list()
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  return coalesce((select array_agg(group_id) from public.color_locks), '{}');
end;
$$;

create or replace function public.color_lock_reset(p_group_ids text[])
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  delete from public.color_locks where group_id = any(p_group_ids);
end;
$$;

-- ---------- when a group is deleted, its color lock goes with it ----------
create or replace function public.color_lock_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.color_locks where group_id = old.id;
  return old;
end;
$$;

drop trigger if exists nodes_color_lock_cleanup on public.nodes;
create trigger nodes_color_lock_cleanup
  after delete on public.nodes
  for each row execute function public.color_lock_cleanup();

-- ---------- who may call what ----------
revoke all on function public.color_lock_status(text)        from public, anon;
revoke all on function public.color_lock_create(text, text)  from public, anon;
revoke all on function public.color_lock_check(text, text)   from public, anon;
revoke all on function public.color_lock_list()              from public, anon;
revoke all on function public.color_lock_reset(text[])       from public, anon;
revoke all on function public.color_lock_cleanup()           from public, anon, authenticated;

grant execute on function public.color_lock_status(text)       to authenticated;
grant execute on function public.color_lock_create(text, text) to authenticated;
grant execute on function public.color_lock_check(text, text)  to authenticated;
grant execute on function public.color_lock_list()             to authenticated;  -- checks is_admin() inside
grant execute on function public.color_lock_reset(text[])      to authenticated; -- checks is_admin() inside
