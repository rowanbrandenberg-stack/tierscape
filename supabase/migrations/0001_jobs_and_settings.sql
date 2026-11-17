-- Accounts and saved work, ready for when jobs move off the device.
-- Each landscaper owns their settings and jobs; row level security keeps
-- every company's data private to its members.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  primary key (company_id, user_id)
);

create table if not exists public.settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  profile jsonb not null,
  pricing jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  address text not null,
  state text,
  county text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_company_updated on public.jobs (company_id, updated_at desc);

create table if not exists public.site_photos (
  id text primary key,
  job_id text not null references public.jobs (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.memberships enable row level security;
alter table public.settings enable row level security;
alter table public.jobs enable row level security;
alter table public.site_photos enable row level security;

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.company_id = cid and m.user_id = auth.uid());
$$;

create policy "members read their company" on public.companies for select using (public.is_member(id));
create policy "members see memberships" on public.memberships for select using (public.is_member(company_id));
create policy "members use settings" on public.settings for all using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy "members use jobs" on public.jobs for all using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy "members use photos" on public.site_photos for all
  using (exists (select 1 from public.jobs j where j.id = job_id and public.is_member(j.company_id)))
  with check (exists (select 1 from public.jobs j where j.id = job_id and public.is_member(j.company_id)));
