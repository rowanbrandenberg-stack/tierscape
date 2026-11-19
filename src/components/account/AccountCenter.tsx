"use client";
import Link from "next/link";
import { useAccount } from "@/client/account";
import { useJobs } from "@/client/jobsStore";
import { browserDb } from "@/client/supabase";
import { BillingPanel } from "./BillingPanel";
import { useSettings } from "@/client/settingsStore";
import { useMounted } from "@/client/useMounted";
import { FOUNDING, IMAGES_ADVERTISED, PLANS, TRIAL, usd } from "@/lib/billing/plans";
import s from "./Account.module.css";

const ROLES = [
  { role: "Owner", can: "Everything, including billing and cancelling." },
  { role: "Billing admin", can: "Billing, invoices and payment method. Prices jobs if also an estimator." },
  { role: "Estimator", can: "Creates and prices jobs and proposals. Counts toward estimator accounts." },
  { role: "Crew", can: "Views build packs and plans. Never sees costs or margins. Does not count as an estimator." },
];

/**
 * The account center. Everything here shows real state: until accounts and
 * billing are live it says so, rather than showing dates or amounts that do
 * not exist yet.
 */
export function AccountCenter() {
  const mounted = useMounted();
  const jobs = useJobs((x) => x.jobs);
  const { profile, pricing } = useSettings();
  const me = useAccount((x) => x.me);
  const syncNote = useAccount((x) => x.syncNote);

  const list = Object.values(jobs).filter((j) => !j.sample);

  function exportAll() {
    const data = {
      exportedAt: new Date().toISOString(),
      format: "tierscape-export-v1",
      company: { profile: { ...profile, logo: profile.logo ? "(logo image included below)" : null }, logo: profile.logo, pricing },
      jobs: list.map((j) => ({ ...j, photos: j.photos.map((p) => ({ ...p, dataUrl: null })) })),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `tierscape-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportCsv() {
    const rows = [["Job", "Address", "County", "State", "Created", "Updated", "Areas", "Plants", "Tier", "Terms", "Signed by"]];
    for (const j of list)
      rows.push([j.name, j.site.matchedAddress ?? j.site.address, j.site.county ?? "", j.site.state ?? "", j.createdAt, j.updatedAt, String(j.areas.length), String(j.plants.reduce((n, p) => n + p.spots.length, 0)), j.tier, j.terms, j.signature?.name ?? ""]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `tierscape-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const signed = !!me?.signedIn && !!me.company && !!me.access;
  const initials = profile.company.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className={s.page}>
      <header className={s.head}>
        <p className="label">Account</p>
        <h1 className={s.title}>{mounted ? (me?.company?.name ?? profile.company) : "Your company"}</h1>
        {me?.signedIn && (
          <p className={s.note}>
            Signed in as {me.email}
            {me.role ? `, ${me.role.replace("_", " ")}` : ""}.{" "}
            <button className="link" onClick={async () => { await browserDb()?.auth.signOut(); await useAccount.getState().refresh(); }}>Sign out</button>
          </p>
        )}
        {me && !me.accounts && <p className={s.banner} role="status">Accounts are not connected yet. Your work is saved in this browser, and nothing is being charged.</p>}
        {me?.accounts && !me.signedIn && (
          <p className={s.banner} role="status">
            You are not signed in, so your work is saved in this browser only. <Link className="link" href="/signin?next=/account">Sign in</Link> to keep it in your account and use it on other devices.
          </p>
        )}
        {me?.signedIn && !me.company && <p className={s.banner} role="status">Setting up your company…</p>}
        {syncNote && <p className={s.banner} role="status">{syncNote}</p>}
      </header>

      <section className={s.section} aria-labelledby="sub-h">
        <div className={s.aside}>
          <h2 id="sub-h" className={s.h2}>Plan and billing</h2>
          <p className={s.note}>Only owners and billing admins can change billing.</p>
        </div>
        <div className={s.body}>
          {signed ? (
            <BillingPanel me={me!} />
          ) : (
            <>
              <dl className={s.facts}>
                <div><dt>Current plan</dt><dd>None</dd></div>
                <div><dt>Next charge</dt><dd>None scheduled</dd></div>
                <div><dt>Trial</dt><dd>{TRIAL.days} days of Pro, no card, once per company. Sign in to start it.</dd></div>
              </dl>
              <div className="row">
                <Link className="btn solid" href={me?.accounts ? "/signin?next=/account" : "/pricing"}>{me?.accounts ? "Sign in" : "See plans"}</Link>
              </div>
            </>
          )}
          <div className={s.explain}>
            <h3>How changes work</h3>
            <ul>
              <li><strong>Upgrades</strong> start right after the prorated payment goes through. You see the amount due now and your next recurring amount before confirming.</li>
              <li><strong>Downgrades</strong> take effect at the end of the period you paid for. Nothing is deleted; anything over the new limits becomes view only.</li>
              <li><strong>Monthly to annual</strong> starts today, with credit for the unused part of the month. <strong>Annual to monthly</strong> switches when the year ends.</li>
              <li><strong>Founding price:</strong> {usd(FOUNDING.price)}/month on Pro for {FOUNDING.periods} paid months, then {usd(FOUNDING.standard)}. Changing plan or switching to annual ends it for good, and you are warned before confirming.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={s.section} aria-labelledby="cancel-h">
        <div className={s.aside}>
          <h2 id="cancel-h" className={s.h2}>Cancel or reactivate</h2>
        </div>
        <div className={s.body}>
          <p>Cancelling keeps your plan active until the end of the period you paid for, and the exact date is shown before you confirm. Afterwards you can still sign in to view and export everything. Reactivate any time before that date and nothing changes.</p>
          <p className="small">{me?.subscription ? "Use Cancel plan in Plan and billing above." : "Available once you have a plan."}</p>
        </div>
      </section>

      <section className={s.section} aria-labelledby="usage-h">
        <div className={s.aside}>
          <h2 id="usage-h" className={s.h2}>Usage</h2>
        </div>
        <div className={s.body}>
          <dl className={s.facts}>
            <div><dt>Jobs</dt><dd className="num">{mounted ? list.length : "…"} saved</dd></div>
            <div><dt>Estimator accounts</dt><dd>Starter includes {PLANS.starter.estimators}, Pro {PLANS.pro.estimators}, Team {PLANS.team.estimators}. Crew do not count.</dd></div>
            <div>
              <dt>AI images</dt>
              <dd>
                {IMAGES_ADVERTISED && me?.usage && me.usage.images.allowance > 0
                  ? `${me.usage.images.used} of ${me.usage.images.allowance} used${me.usage.images.resetsAt ? `, resets ${new Date(me.usage.images.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}`
                  : "Not offered yet. Allowances appear here with their reset dates once rendering is validated."}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={s.section} aria-labelledby="profile-h">
        <div className={s.aside}>
          <h2 id="profile-h" className={s.h2}>Company and branding</h2>
        </div>
        <div className={s.body}>
          <div className={s.brand} style={{ "--brand": profile.brandColor, "--accent": profile.accentColor } as React.CSSProperties}>
            {profile.logo ? <img src={profile.logo} alt="" /> : <span className={s.mono}>{mounted ? initials : ""}</span>}
            <div>
              <strong>{mounted ? profile.company : ""}</strong>
              <div className={s.note}>{mounted ? [profile.licenseLine, profile.license].filter(Boolean).join(" · ") : ""}</div>
              <div className={s.note}>{mounted ? [profile.phone, profile.email].filter(Boolean).join(" · ") : ""}</div>
            </div>
          </div>
          <Link className="btn" href="/settings">Edit profile, branding and prices</Link>
        </div>
      </section>

      <section className={s.section} aria-labelledby="team-h">
        <div className={s.aside}>
          <h2 id="team-h" className={s.h2}>Team and roles</h2>
          <p className={s.note}>Inviting teammates is coming next.</p>
        </div>
        <div className={s.body}>
          <table className={s.roles}>
            <thead><tr><th>Role</th><th>Can</th></tr></thead>
            <tbody>{ROLES.map((r) => <tr key={r.role}><td>{r.role}</td><td>{r.can}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className={s.section} aria-labelledby="export-h">
        <div className={s.aside}>
          <h2 id="export-h" className={s.h2}>Export your data</h2>
          <p className={s.note}>Always available, on every plan and after cancelling.</p>
        </div>
        <div className={s.body}>
          <p>Download every job, your price book and your company profile. Site photos stay on this device.</p>
          <div className="row">
            <button className="btn solid" onClick={exportAll} disabled={!mounted}>Download everything (JSON)</button>
            <button className="btn" onClick={exportCsv} disabled={!mounted || !list.length}>Job list (CSV)</button>
          </div>
        </div>
      </section>
    </main>
  );
}
