-- Photo-first proposals, published proposal versions, homeowner acceptance
-- and homeowner-to-contractor payments through Stripe Connect.
-- Additive: no existing table, column or row is changed or dropped. The one
-- change to existing rules is at the end: crew lose direct write access to
-- jobs (reading is unchanged), matching what the server already enforces.
-- Every write goes through server routes using the service role after they
-- have checked the session or a share token; members can read their own rows.

-- Private files: original yard photos and concept renders. Never public.
insert into storage.buckets (id, name, public)
values ('job-assets', 'job-assets', false)
on conflict (id) do nothing;

create table if not exists public.job_assets (
  id text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('photo', 'render')),
  tier text check (tier in ('basic', 'standard', 'premium')),
  storage_path text not null unique,
  content_type text not null,
  bytes int not null check (bytes > 0),
  created_at timestamptz not null default now()
);
create index if not exists job_assets_job on public.job_assets (job_id);

-- Durable AI work: drafts, single option rewrites and renders. The row is the
-- source of truth for status, so a closed browser or a retry never loses or
-- double runs a paid call.
create table if not exists public.ai_generations (
  id text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('draft', 'option', 'render')),
  tier text check (tier in ('basic', 'standard', 'premium')),
  -- The client's idempotency key: a repeated click returns the same row.
  request_key text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts int not null default 0,
  model text,
  result jsonb,
  error text,
  usage_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, request_key)
);
create index if not exists ai_generations_company_day on public.ai_generations (company_id, created_at desc);

-- Published proposal versions. The snapshot is exactly what the homeowner
-- sees (no costs). Once written it never changes; a new version is a new row.
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete restrict,
  version int not null check (version > 0),
  status text not null check (status in ('published', 'superseded', 'accepted', 'withdrawn')),
  snapshot jsonb not null,
  snapshot_hash text not null,
  -- The contractor's numbers behind the snapshot, kept for the record. Never served publicly.
  internal jsonb,
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, version)
);
create index if not exists proposals_job on public.proposals (job_id, version desc);

create or replace function public.proposals_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.snapshot is distinct from old.snapshot or new.snapshot_hash is distinct from old.snapshot_hash
     or new.internal is distinct from old.internal or new.job_id is distinct from old.job_id
     or new.version is distinct from old.version or new.company_id is distinct from old.company_id
     or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'A published proposal cannot be changed. Publish a new version instead.';
  end if;
  -- A version only moves forward: published to superseded, accepted or withdrawn. Nothing goes back.
  if new.status is distinct from old.status and not (old.status = 'published' and new.status in ('superseded', 'accepted', 'withdrawn')) then
    raise exception 'A proposal cannot move from % to %.', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists proposals_freeze on public.proposals;
create trigger proposals_freeze before update on public.proposals for each row execute function public.proposals_freeze();

-- Publishing a new version: wait for any acceptance in progress on this job,
-- refuse if one went through, and retire the older published versions.
create or replace function public.proposals_on_publish() returns trigger
language plpgsql set search_path = public as $$
begin
  perform 1 from public.proposals where job_id = new.job_id for update;
  if exists (select 1 from public.acceptances a where a.job_id = new.job_id and a.status = 'active') then
    raise exception 'The homeowner already accepted this proposal.';
  end if;
  update public.proposals set status = 'superseded' where job_id = new.job_id and status = 'published';
  return new;
end $$;
drop trigger if exists proposals_on_publish on public.proposals;
create trigger proposals_on_publish before insert on public.proposals for each row execute function public.proposals_on_publish();

-- Share links. Only a SHA-256 of the token is stored; revoking stops it at once.
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete cascade,
  token_hash text not null unique,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists share_links_job on public.share_links (job_id);

-- A homeowner's signed acceptance of one option of one exact proposal version.
-- Amounts are copied from the snapshot when signed and never change after.
create table if not exists public.acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete restrict,
  proposal_id uuid not null references public.proposals (id) on delete restrict,
  snapshot_hash text not null,
  tier text not null check (tier in ('basic', 'standard', 'premium')),
  option_snapshot jsonb not null,
  signer_name text not null,
  signer_email text,
  total_cents int not null check (total_cents > 0),
  deposit_cents int not null check (deposit_cents >= 0),
  balance_cents int not null check (balance_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'active' check (status in ('active', 'cancelled')),
  balance_requested_at timestamptz,
  user_agent text,
  accepted_at timestamptz not null default now(),
  check (deposit_cents + balance_cents = total_cents)
);
create unique index if not exists acceptances_one_active_per_job on public.acceptances (job_id) where status = 'active';

-- Accepting: lock the version and accept it only if it is still the current,
-- unexpired one with the hash the homeowner saw.
create or replace function public.acceptances_check() returns trigger
language plpgsql set search_path = public as $$
declare p public.proposals;
begin
  select * into p from public.proposals where id = new.proposal_id for update;
  if p.id is null or p.status <> 'published' or p.snapshot_hash <> new.snapshot_hash
     or p.job_id <> new.job_id or p.company_id <> new.company_id
     or exists (select 1 from public.proposals q where q.job_id = p.job_id and q.version > p.version) then
    raise exception 'This proposal version is no longer current.';
  end if;
  if p.expires_at < now() then
    raise exception 'This proposal has expired.';
  end if;
  return new;
end $$;
drop trigger if exists acceptances_check on public.acceptances;
create trigger acceptances_check before insert on public.acceptances for each row execute function public.acceptances_check();

create or replace function public.acceptances_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.proposal_id is distinct from old.proposal_id or new.snapshot_hash is distinct from old.snapshot_hash
     or new.tier is distinct from old.tier or new.option_snapshot is distinct from old.option_snapshot
     or new.total_cents is distinct from old.total_cents or new.deposit_cents is distinct from old.deposit_cents
     or new.balance_cents is distinct from old.balance_cents or new.currency is distinct from old.currency
     or new.signer_name is distinct from old.signer_name or new.signer_email is distinct from old.signer_email
     or new.accepted_at is distinct from old.accepted_at or new.company_id is distinct from old.company_id
     or new.job_id is distinct from old.job_id or new.user_agent is distinct from old.user_agent then
    raise exception 'An accepted agreement cannot be changed.';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'active' and new.status = 'cancelled') then
      raise exception 'An agreement cannot move from % to %.', old.status, new.status;
    end if;
    if exists (select 1 from public.payments pm where pm.acceptance_id = old.id and pm.status in ('open', 'processing', 'succeeded', 'partially_refunded', 'disputed', 'mismatch')) then
      raise exception 'An agreement with payments cannot be cancelled. Refund or settle them first.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists acceptances_freeze on public.acceptances;
create trigger acceptances_freeze before update on public.acceptances for each row execute function public.acceptances_freeze();

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id text not null references public.jobs (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  name text,
  message text not null check (length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists change_requests_job on public.change_requests (job_id, created_at desc);

-- The contractor's own Stripe account for homeowner payments (Accounts v2, direct charges).
create table if not exists public.connect_accounts (
  company_id uuid primary key references public.companies (id) on delete cascade,
  stripe_account_id text not null unique,
  livemode boolean not null default false,
  card_payments text not null default 'pending',
  payouts text not null default 'pending',
  requirements_due int not null default 0,
  checked_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  acceptance_id uuid not null references public.acceptances (id) on delete restrict,
  kind text not null check (kind in ('deposit', 'balance')),
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'usd',
  fee_cents int not null default 0 check (fee_cents >= 0),
  stripe_account text not null,
  session_id text unique,
  session_url text,
  session_expires_at timestamptz,
  payment_intent_id text,
  status text not null check (status in ('open', 'processing', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded', 'disputed', 'mismatch')),
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  receipt_url text,
  last_event_at bigint not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live Checkout per amount, and never two successful payments of the same amount.
create unique index if not exists payments_one_live on public.payments (acceptance_id, kind) where status in ('open', 'processing');
create unique index if not exists payments_one_paid on public.payments (acceptance_id, kind) where status in ('succeeded', 'partially_refunded', 'disputed', 'refunded');
create index if not exists payments_intent on public.payments (stripe_account, payment_intent_id);

-- Connect webhook events, each applied once.
create table if not exists public.connect_events (
  id text primary key,
  type text not null,
  account text,
  received_at timestamptz not null default now()
);

alter table public.job_assets enable row level security;
alter table public.ai_generations enable row level security;
alter table public.proposals enable row level security;
alter table public.share_links enable row level security;
alter table public.acceptances enable row level security;
alter table public.change_requests enable row level security;
alter table public.connect_accounts enable row level security;
alter table public.payments enable row level security;
alter table public.connect_events enable row level security;

-- Office members (not crew) read their own company's rows. Nobody but the server writes.
create or replace function public.is_office(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.company_id = cid and m.user_id = auth.uid() and m.role <> 'crew');
$$;
revoke execute on function public.is_office(uuid) from public, anon;
grant execute on function public.is_office(uuid) to authenticated;

drop policy if exists "office reads assets" on public.job_assets;
create policy "office reads assets" on public.job_assets for select using (public.is_office(company_id));
drop policy if exists "office reads generations" on public.ai_generations;
create policy "office reads generations" on public.ai_generations for select using (public.is_office(company_id));
drop policy if exists "office reads proposals" on public.proposals;
create policy "office reads proposals" on public.proposals for select using (public.is_office(company_id));
drop policy if exists "office reads acceptances" on public.acceptances;
create policy "office reads acceptances" on public.acceptances for select using (public.is_office(company_id));
drop policy if exists "office reads change requests" on public.change_requests;
create policy "office reads change requests" on public.change_requests for select using (public.is_office(company_id));
drop policy if exists "office reads connect account" on public.connect_accounts;
create policy "office reads connect account" on public.connect_accounts for select using (public.is_office(company_id));
drop policy if exists "office reads payments" on public.payments;
create policy "office reads payments" on public.payments for select using (public.is_office(company_id));
-- share_links and connect_events have no member policy: token hashes and raw events stay server side.

-- Crew can view jobs but never change them (the server already refuses crew
-- writes; this closes the direct database path too, since published prices
-- are built from jobs.data).
drop policy if exists "members use jobs" on public.jobs;
drop policy if exists "members read jobs" on public.jobs;
drop policy if exists "office writes jobs" on public.jobs;
drop policy if exists "office updates jobs" on public.jobs;
drop policy if exists "office deletes jobs" on public.jobs;
create policy "members read jobs" on public.jobs for select using (public.is_member(company_id));
create policy "office writes jobs" on public.jobs for insert with check (public.is_office(company_id));
create policy "office updates jobs" on public.jobs for update using (public.is_office(company_id)) with check (public.is_office(company_id));
create policy "office deletes jobs" on public.jobs for delete using (public.is_office(company_id));
