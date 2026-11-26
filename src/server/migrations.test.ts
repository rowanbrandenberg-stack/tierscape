import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs every migration in supabase/migrations on a real Postgres (PGlite, in
 * process, no server and no cost) with small stand ins for what Supabase
 * provides (auth.users, auth.uid(), storage.buckets, the anon and
 * authenticated roles), then checks the rules the database itself enforces.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

const SUPABASE_STANDINS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
`;

const OWNER = "00000000-0000-0000-0000-000000000001";
const CREW = "00000000-0000-0000-0000-000000000002";
const OTHER = "00000000-0000-0000-0000-000000000003";
const CO = "10000000-0000-0000-0000-000000000001";
const CO2 = "10000000-0000-0000-0000-000000000002";

let db: PGlite;

const fails = async (sql: string, re: RegExp) => {
  await expect(db.exec(sql)).rejects.toThrow(re);
};
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];

async function publish(job: string, hash: string, expires = "now() + interval '30 days'") {
  return one<{ id: string; version: number }>(
    `insert into public.proposals (company_id, job_id, version, status, snapshot, snapshot_hash, expires_at)
     values ('${CO}', '${job}', coalesce((select max(version) from public.proposals where job_id = '${job}'), 0) + 1, 'published', '{}'::jsonb, '${hash}', ${expires})
     returning id, version`,
  );
}
const accept = (job: string, proposal: string, hash: string, total = 350000) =>
  db.exec(`insert into public.acceptances (company_id, job_id, proposal_id, snapshot_hash, tier, option_snapshot, signer_name, total_cents, deposit_cents, balance_cents)
           values ('${CO}', '${job}', '${proposal}', '${hash}', 'standard', '{}'::jsonb, 'Jordan Client', ${total}, ${total / 2}, ${total / 2})`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDINS);
  for (const f of files) await db.exec(readFileSync(join(DIR, f), "utf8"));
  // Supabase grants table access to these roles; row level security decides the rest.
  await db.exec(`grant usage on schema public to authenticated, anon; grant all on all tables in schema public to authenticated;`);
  await db.exec(`
    insert into auth.users values ('${OWNER}'), ('${CREW}'), ('${OTHER}');
    insert into public.companies (id, name) values ('${CO}', 'Pine Ridge'), ('${CO2}', 'Other Co');
    insert into public.memberships (company_id, user_id, role) values ('${CO}', '${OWNER}', 'owner'), ('${CO}', '${CREW}', 'crew'), ('${CO2}', '${OTHER}', 'owner');
    insert into public.jobs (id, company_id, name, address, data) values ('job_a', '${CO}', 'A', '', '{}'), ('job_b', '${CO}', 'B', '', '{}'), ('job_c', '${CO}', 'C', '', '{}'), ('job_d', '${CO}', 'D', '', '{}');
  `);
}, 60_000);

describe("migrations", () => {
  it("apply in order on a fresh database, and 0004 can be run again safely", async () => {
    expect(files).toContain("0004_photo_proposals_and_payments.sql");
    await db.exec(readFileSync(join(DIR, "0004_photo_proposals_and_payments.sql"), "utf8"));
    expect((await one<{ public: boolean }>(`select public from storage.buckets where id = 'job-assets'`)).public).toBe(false);
  });
});

describe("published versions and acceptance", () => {
  it("a new version retires the old one, and only the current version can be accepted", async () => {
    const v1 = await publish("job_a", "h1");
    const v2 = await publish("job_a", "h2");
    expect((await one<{ status: string }>(`select status from public.proposals where id = '${v1.id}'`)).status).toBe("superseded");
    await expect(accept("job_a", v1.id, "h1")).rejects.toThrow(/no longer current/);
    await expect(accept("job_a", v2.id, "wrong hash")).rejects.toThrow(/no longer current/);
    await accept("job_a", v2.id, "h2");
    await expect(accept("job_a", v2.id, "h2")).rejects.toThrow(/duplicate key|acceptances_one_active_per_job/);
  });

  it("an accepted job cannot get a new version", async () => {
    await expect(publish("job_a", "h3")).rejects.toThrow(/already accepted/);
  });

  it("an expired version cannot be accepted", async () => {
    const v = await publish("job_b", "hb", "now() - interval '1 day'");
    await expect(accept("job_b", v.id, "hb")).rejects.toThrow(/expired/);
  });

  it("a published version cannot be edited or moved backwards", async () => {
    const p = await one<{ id: string }>(`select id from public.proposals where job_id = 'job_a' and version = 2`);
    await fails(`update public.proposals set snapshot = '{"x":1}' where id = '${p.id}'`, /cannot be changed/);
    await fails(`update public.proposals set internal = '{"assets":{}}' where id = '${p.id}'`, /cannot be changed/);
    await db.exec(`update public.proposals set status = 'accepted' where id = '${p.id}'`);
    await fails(`update public.proposals set status = 'published' where id = '${p.id}'`, /cannot move/);
  });

  it("a signed agreement cannot be changed, and cannot be cancelled once payments exist", async () => {
    const a = await one<{ id: string }>(`select id from public.acceptances where job_id = 'job_a'`);
    await fails(`update public.acceptances set total_cents = 100, deposit_cents = 50, balance_cents = 50 where id = '${a.id}'`, /cannot be changed/);
    await fails(`update public.acceptances set signer_email = 'x@y.test' where id = '${a.id}'`, /cannot be changed/);
    await db.exec(`update public.acceptances set balance_requested_at = now() where id = '${a.id}'`);
    await db.exec(`insert into public.payments (id, company_id, acceptance_id, kind, amount_cents, stripe_account, status) values ('pay_1', '${CO}', '${a.id}', 'deposit', 175000, 'acct_A', 'succeeded')`);
    await fails(`update public.acceptances set status = 'cancelled' where id = '${a.id}'`, /cannot be cancelled/);
  });
});

describe("payments", () => {
  it("one live checkout and one successful payment per amount", async () => {
    const a = await one<{ id: string }>(`select id from public.acceptances where job_id = 'job_a'`);
    await fails(`insert into public.payments (id, company_id, acceptance_id, kind, amount_cents, stripe_account, status) values ('pay_2', '${CO}', '${a.id}', 'deposit', 175000, 'acct_A', 'succeeded')`, /payments_one_paid|duplicate key/);
    await db.exec(`insert into public.payments (id, company_id, acceptance_id, kind, amount_cents, stripe_account, status) values ('pay_3', '${CO}', '${a.id}', 'balance', 175000, 'acct_A', 'open')`);
    await fails(`insert into public.payments (id, company_id, acceptance_id, kind, amount_cents, stripe_account, status) values ('pay_4', '${CO}', '${a.id}', 'balance', 175000, 'acct_A', 'open')`, /payments_one_live|duplicate key/);
    // A second payment that needs a refund is recorded without breaking the rules above.
    await db.exec(`insert into public.payments (id, company_id, acceptance_id, kind, amount_cents, stripe_account, status) values ('pay_5', '${CO}', '${a.id}', 'deposit', 175000, 'acct_A', 'mismatch')`);
  });

  it("deposit and balance must add up to the total", async () => {
    const v = await publish("job_c", "hc");
    await expect(
      db.exec(`insert into public.acceptances (company_id, job_id, proposal_id, snapshot_hash, tier, option_snapshot, signer_name, total_cents, deposit_cents, balance_cents) values ('${CO}', 'job_c', '${v.id}', 'hc', 'basic', '{}', 'X', 1000, 400, 500)`),
    ).rejects.toThrow(/check/);
  });
});

describe("row level security for signed in users", () => {
  const as = async <T>(uid: string, sql: string) => {
    await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
    try {
      return (await db.query<T>(sql)).rows;
    } finally {
      await db.exec(`reset role; select set_config('test.uid', '', false);`);
    }
  };

  it("crew can read jobs but not write them; office can", async () => {
    expect((await as<{ id: string }>(CREW, `select id from public.jobs order by id`)).length).toBe(4);
    await expect(as(CREW, `insert into public.jobs (id, company_id, name, address, data) values ('job_x', '${CO}', 'X', '', '{}')`)).rejects.toThrow(/row-level security/);
    expect(await as(CREW, `update public.jobs set name = 'hacked' where id = 'job_d' returning id`)).toEqual([]);
    await as(OWNER, `insert into public.jobs (id, company_id, name, address, data) values ('job_y', '${CO}', 'Y', '', '{}')`);
  });

  it("another company sees none of this company's jobs, proposals, agreements or payments", async () => {
    for (const t of ["jobs", "proposals", "acceptances", "payments", "job_assets", "ai_generations", "change_requests", "connect_accounts"])
      expect(await as(OTHER, `select * from public.${t}`)).toEqual([]);
  });

  it("crew do not see proposals or payments, and nobody reads share tokens or raw events", async () => {
    expect(await as(CREW, `select * from public.proposals`)).toEqual([]);
    expect(await as(CREW, `select * from public.payments`)).toEqual([]);
    expect(await as(OWNER, `select * from public.share_links`)).toEqual([]);
    expect(await as(OWNER, `select * from public.connect_events`)).toEqual([]);
    expect((await as(OWNER, `select id from public.proposals`)).length).toBeGreaterThan(0);
  });

  it("signed in users cannot write proposals or payments directly", async () => {
    await expect(as(OWNER, `update public.payments set status = 'succeeded' where id = 'pay_3' returning id`)).resolves.toEqual([]);
    await expect(as(OWNER, `insert into public.proposals (company_id, job_id, version, status, snapshot, snapshot_hash, expires_at) values ('${CO}', 'job_d', 1, 'published', '{}', 'h', now())`)).rejects.toThrow(/row-level security/);
  });
});
