-- Billing, roles, trials, founding places and metered usage.
-- Stripe is the source of truth for payment; these tables mirror verified
-- webhook state so access checks never trust the browser.

-- Roles: owner and billing admin manage billing; estimators price jobs; crew view build packs only.
alter table public.memberships drop constraint if exists memberships_role_check;
update public.memberships set role = 'estimator' where role = 'member';
alter table public.memberships alter column role set default 'estimator';
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'billing_admin', 'estimator', 'crew'));

alter table public.companies
  add column if not exists stripe_customer_id text unique,
  add column if not exists trial_started_at timestamptz,
  add column if not exists billing_hold text;

create table if not exists public.subscriptions (
  company_id uuid primary key references public.companies (id) on delete cascade,
  stripe_subscription_id text not null unique,
  plan text not null check (plan in ('starter', 'pro', 'team')),
  cadence text not null check (cadence in ('monthly', 'annual')),
  status text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  founding_paid_periods int,
  as_of timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Each Stripe event id is processed once, however many times Stripe retries it.
create table if not exists public.billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- One row per company that has ever held or used a founding place.
create table if not exists public.founding_places (
  company_id uuid primary key references public.companies (id) on delete cascade,
  state text not null check (state in ('held', 'confirmed', 'released')),
  held_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Image allowance ledger. Pending reserves count against the limit until confirmed or refunded.
create table if not exists public.usage_ledger (
  key text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  window_key text not null,
  units int not null check (units > 0),
  state text not null check (state in ('pending', 'used', 'refunded')),
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_window on public.usage_ledger (company_id, window_key);

-- Funnel events. Names and plan choices only: never payment details or job contents.
create table if not exists public.analytics_events (
  id bigserial primary key,
  company_id uuid references public.companies (id) on delete set null,
  name text not null check (name in ('pricing_view', 'plan_select', 'trial_start', 'first_estimate', 'checkout_start', 'paid_conversion', 'cancellation')),
  plan text,
  cadence text,
  at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.founding_places enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.analytics_events enable row level security;

-- Members may read their own company's billing state; only the server (service role) writes it.
create policy "members read subscription" on public.subscriptions for select using (public.is_member(company_id));
create policy "members read usage" on public.usage_ledger for select using (public.is_member(company_id));

create or replace function public.can_manage_billing(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.company_id = cid and m.user_id = auth.uid() and m.role in ('owner', 'billing_admin'));
$$;

-- Crew never reads prices or settings; estimators and owners do.
drop policy if exists "members use settings" on public.settings;
create policy "office uses settings" on public.settings for all
  using (exists (select 1 from public.memberships m where m.company_id = settings.company_id and m.user_id = auth.uid() and m.role <> 'crew'))
  with check (exists (select 1 from public.memberships m where m.company_id = settings.company_id and m.user_id = auth.uid() and m.role <> 'crew'));

-- Hold a founding place atomically: one per company, never past the limit counting live holds.
create or replace function public.hold_founding_place(cid uuid, place_limit int, hold_minutes int)
returns table (ok boolean, until timestamptz, reason text)
language plpgsql security definer set search_path = public as $$
declare
  cur public.founding_places;
  taken int;
begin
  perform pg_advisory_xact_lock(hashtext('tierscape_founding'));
  select * into cur from public.founding_places where company_id = cid;
  if cur.state = 'confirmed' then
    return query select false, null::timestamptz, 'This company has already used the founding contractor offer.'; return;
  end if;
  if cur.state = 'held' and cur.held_until > now() then
    return query select true, cur.held_until, null::text; return;
  end if;
  select count(*) into taken from public.founding_places where state = 'confirmed' or (state = 'held' and held_until > now());
  if taken >= place_limit then
    return query select false, null::timestamptz, 'All founding contractor places are taken.'; return;
  end if;
  insert into public.founding_places (company_id, state, held_until, updated_at)
  values (cid, 'held', now() + make_interval(mins => hold_minutes), now())
  on conflict (company_id) do update set state = 'held', held_until = excluded.held_until, updated_at = now();
  return query select true, now() + make_interval(mins => hold_minutes), null::text;
end $$;

-- Reserve image units atomically so parallel requests cannot pass the limit.
create or replace function public.reserve_usage(k text, cid uuid, win text, n int, lim int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare used int;
begin
  perform pg_advisory_xact_lock(hashtext(cid::text || win));
  if exists (select 1 from public.usage_ledger where key = k) then return true; end if;
  select coalesce(sum(units), 0) into used from public.usage_ledger where company_id = cid and window_key = win and state <> 'refunded';
  if used + n > lim then return false; end if;
  insert into public.usage_ledger (key, company_id, window_key, units, state) values (k, cid, win, n, 'pending');
  return true;
end $$;

revoke execute on function public.hold_founding_place(uuid, int, int) from public, anon, authenticated;
revoke execute on function public.reserve_usage(text, uuid, text, int, int) from public, anon, authenticated;
