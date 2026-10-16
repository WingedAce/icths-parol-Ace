-- ===== Tables =====
create table public.workspaces (
  id text primary key,            -- text: your seed ids are "batch-26", etc.
  name text not null,
  type text not null check (type in ('batch','company')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.nodes (
  id text primary key,
  parent_id text not null,
  type text not null check (type in ('section','parol','group','animation')),
  name text not null,
  locked boolean not null default false,
  data jsonb not null default '{}'::jsonb,  -- zones, pins, frames, audio analysis...
  created_at timestamptz not null default clock_timestamp()
);
create index nodes_parent_idx on public.nodes (parent_id);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ===== Admin check =====
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ===== Row Level Security =====
alter table public.workspaces enable row level security;
alter table public.nodes      enable row level security;
alter table public.admins     enable row level security;  -- no policies = only is_admin() can read it

-- Workspaces: any signed-in session (students are anonymous sessions)
create policy "workspaces read"   on public.workspaces for select to authenticated using (true);
create policy "workspaces insert" on public.workspaces for insert to authenticated with check (true);
create policy "workspaces update" on public.workspaces for update to authenticated using (true) with check (true);
create policy "workspaces delete" on public.workspaces for delete to authenticated using (true);

-- Nodes: same, but locked designs can only be changed by admins
create policy "nodes read"   on public.nodes for select to authenticated using (true);
create policy "nodes insert" on public.nodes for insert to authenticated
  with check (locked = false or public.is_admin());
create policy "nodes update" on public.nodes for update to authenticated
  using (locked = false or public.is_admin())
  with check (locked = false or public.is_admin());
create policy "nodes delete" on public.nodes for delete to authenticated
  using (locked = false or public.is_admin());

-- ===== Seed your three starting workspaces =====
insert into public.workspaces (id, name, type) values
  ('batch-26',  'Batch ''26',  'batch'),
  ('batch-27',  'Batch ''27',  'batch'),
  ('company-1', 'Company XYZ', 'company')
on conflict (id) do nothing;

-- ===== Storage buckets (private) =====
insert into storage.buckets (id, name, public, file_size_limit) values
  ('drawings', 'drawings', false, 15728640),   -- 15 MB, matches /segment limit
  ('audio',    'audio',    false, 31457280)    -- 30 MB, matches /analyze-audio limit
on conflict (id) do nothing;

create policy "app files read"   on storage.objects for select to authenticated
  using (bucket_id in ('drawings','audio'));
create policy "app files insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('drawings','audio'));
create policy "app files update" on storage.objects for update to authenticated
  using (bucket_id in ('drawings','audio'));
create policy "app files delete" on storage.objects for delete to authenticated
  using (bucket_id in ('drawings','audio'));