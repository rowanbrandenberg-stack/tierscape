"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "@/client/account";
import { track } from "@/client/track";
import { annualMonthly, annualSavings, FEATURES, FOUNDING, foundingSavings, PLAN_ORDER, PLANS, sellable, TRIAL, usd, type Cadence, type FeatureKey, type PlanKey } from "@/lib/billing/plans";
import s from "./Pricing.module.css";

type Status = { accounts?: boolean; checkout: boolean; why: string | null; founding: { limit: number; remaining: number | null } };

const LEAKS = [
  { title: "Missed materials", example: "A forgotten $300 delivery charge comes straight out of the job's profit." },
  { title: "Underestimated labor", example: "Two extra crew days on a patio that was priced for three can erase the margin on it." },
  { title: "Extra trips", example: "A second run to the yard for edging nobody counted is fuel, time and a crew standing around." },
  { title: "Changes done without a price", example: "The homeowner asks for the bed to wrap the corner, the crew does it, and nobody bills it." },
];

const COMPARE: { label: string; key?: FeatureKey; values?: Record<PlanKey, string> }[] = [
  { label: "Estimator accounts", values: { starter: "1", pro: "2", team: "5" } },
  { label: FEATURES.unlimited_jobs.label, key: "unlimited_jobs" },
  { label: FEATURES.planning.label, key: "planning" },
  { label: FEATURES.price_book.label, key: "price_book" },
  { label: FEATURES.single_proposal.label, key: "single_proposal" },
  { label: FEATURES.build_pack.label, key: "build_pack" },
  { label: FEATURES.export.label, key: "export" },
  { label: FEATURES.crew_view.label, key: "crew_view" },
  { label: FEATURES.three_tier.label, key: "three_tier" },
  { label: FEATURES.presentation.label, key: "presentation" },
  { label: FEATURES.templates.label, key: "templates" },
  { label: FEATURES.version_history.label, key: "version_history" },
  { label: FEATURES.team_permissions.label, key: "team_permissions" },
  { label: FEATURES.approvals.label, key: "approvals" },
  { label: FEATURES.reporting.label, key: "reporting" },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Which plan suits my company?", a: "Starter fits an owner who prices their own jobs. Pro fits contractors who show homeowners options and want the bigger job. Team is for companies with several estimators and crews, and it opens once team permissions and approvals are finished." },
  { q: "What counts as an estimator?", a: "Anyone who creates or edits estimates, prices or proposals. Each plan includes a set number of estimator accounts for your company." },
  { q: "Do my crews need their own paid seats?", a: "No. Crew viewing access is meant to be included on every plan, so crews can see the build pack without seeing your costs or margins. Crew access is still being built and is marked coming soon until it works." },
  { q: "How does annual billing work?", a: "You pay for the year up front and get two months free compared with paying monthly. The full annual charge is shown before you pay, and it renews yearly unless you cancel." },
  { q: "What happens when the founding price ends?", a: `The founding contractor price is ${usd(FOUNDING.price)} a month for your first ${FOUNDING.periods} paid monthly billing periods on Pro. After that it renews at the standard ${usd(FOUNDING.standard)} a month. Switching to annual billing or another plan ends the founding price, and it cannot be applied again. Trial days never use up founding months.` },
  { q: "How does the free trial work?", a: "Every company can try Pro free for 14 days without a credit card, with one active real job. Nothing is charged when the trial ends. Your work stays viewable and exportable, and starting a plan always takes an explicit checkout." },
  { q: "How do I cancel?", a: "Cancel any time from your account center. Your plan stays active until the end of the period you paid for, and the exact date is shown before you confirm." },
  { q: "What happens to my data if I cancel?", a: "Nothing is deleted. You can still sign in to view and export your jobs, price book and proposals. Creating new work needs an active plan." },
  { q: "Is AI included, and are there limits?", a: "AI renders of the homeowner's yard and AI assistance are still being validated. Image allowances will only be listed here once rendering works reliably and its costs are confirmed. Until then, nothing on this page depends on AI." },
];

export function PricingPage() {
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [status, setStatus] = useState<Status | null>(null);
  const me = useAccount((x) => x.me);
  const [busy, setBusy] = useState<string | null>(null);
  const [buyErr, setBuyErr] = useState<string | null>(null);
  const hasPlan = !!me?.subscription && ["active", "past_due", "trialing"].includes(me.subscription.status);
  // Accounts can be live before paid checkout is: then sign in and the no card trial work, and only purchase waits.
  const accountsLive = !!(status?.accounts ?? me?.accounts);
  const trialStarted = !!me?.company?.trialStartedAt;

  async function buy(plan: PlanKey, c: Cadence, founding = false) {
    track("plan_select", { plan: founding ? "founding" : plan, cadence: c });
    if (!me?.signedIn) return void (window.location.href = "/signin?next=/pricing");
    setBusy(founding ? "founding" : plan);
    setBuyErr(null);
    try {
      const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, cadence: c, founding }) });
      const j = (await r.json()) as { url?: string; message?: string };
      if (!r.ok || !j.url) throw new Error(j.message ?? "Checkout could not start.");
      window.location.href = j.url;
    } catch (e) {
      setBuyErr(e instanceof Error ? e.message : "Checkout could not start.");
      setBusy(null);
    }
  }
  const [hours, setHours] = useState("4");
  const [rate, setRate] = useState("50");
  const [calcPlan, setCalcPlan] = useState<PlanKey>("pro");

  useEffect(() => {
    track("pricing_view");
    fetch("/api/billing/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ checkout: false, why: null, founding: { limit: FOUNDING.limit, remaining: null } }));
  }, []);

  const h = Math.max(0, Number.parseFloat(hours) || 0);
  const r = Math.max(0, Number.parseFloat(rate) || 0);
  const calcPrice = cadence === "annual" ? annualMonthly(PLANS[calcPlan]) : PLANS[calcPlan].monthly;

  return (
    <main className={s.page}>
      <section className={s.hero}>
        <p className="label">Pricing</p>
        <h1 className={s.headline}>Know your numbers before you name your price.</h1>
        <p className={s.lede}>Turn your job plan into clear pricing, customer options, and a build pack your crew can use.</p>
        <div className={s.toggle} role="group" aria-label="Billing period">
          <button aria-pressed={cadence === "monthly"} onClick={() => setCadence("monthly")}>Monthly</button>
          <button aria-pressed={cadence === "annual"} onClick={() => setCadence("annual")}>
            Annual <span className={s.free}>2 months free</span>
          </button>
        </div>
      </section>

      <section className={s.cards} aria-label="Plans">
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          const featured = k === "pro";
          const sale = sellable(k, !!status?.checkout);
          const comingSoon = !sellable(k, true).ok;
          const extras = p.features.filter((f) => !(k !== "starter" && PLANS[k === "team" ? "pro" : "starter"].features.includes(f)));
          return (
            <article key={k} className={`${s.card} ${featured ? s.featured : ""}`} aria-labelledby={`plan-${k}`}>
              <div className={s.cardTop}>
                <h2 id={`plan-${k}`} className={s.planName}>{p.name}</h2>
                {featured && <span className={s.badge}>Recommended</span>}
                {comingSoon && <span className={s.soon}>Coming soon</span>}
              </div>
              <p className={s.audience}>{p.audience}</p>
              <div className={s.price}>
                {cadence === "monthly" ? (
                  <>
                    <span className={s.amount}>{usd(p.monthly)}</span>
                    <span className={s.per}>per month</span>
                  </>
                ) : (
                  <>
                    <span className={s.amount}>{usd(annualMonthly(p), true)}</span>
                    <span className={s.per}>per month</span>
                  </>
                )}
              </div>
              <p className={s.billing}>
                {cadence === "monthly" ? `Billed monthly. Or ${usd(p.annual)} a year, 2 months free.` : `Billed ${usd(p.annual)} annually. Saves ${usd(annualSavings(p))} a year.`}
              </p>
              <p className={s.outcome}>{p.outcome}</p>
              {comingSoon ? (
                <button className={s.cta} disabled>Coming soon</button>
              ) : sale.ok && hasPlan ? (
                <Link className={`${s.cta} ${featured ? s.ctaMain : ""}`} href="/account">{me?.subscription?.plan === k ? "Your plan" : "Change plan in your account"}</Link>
              ) : sale.ok && status?.checkout ? (
                <>
                  <button className={`${s.cta} ${featured ? s.ctaMain : ""}`} disabled={!!busy || (me?.signedIn && !me.canManageBilling)} onClick={() => buy(k, cadence)}>
                    {busy === k ? "Opening checkout" : me?.signedIn ? `Choose ${p.name}` : `Sign in to choose ${p.name}`}
                  </button>
                  <span className={s.ctaNote}>{me?.signedIn && !me.canManageBilling ? "Ask your company owner to choose a plan." : "Prices in USD. Tax shown at checkout."}</span>
                </>
              ) : !status ? (
                <>
                  <Link className={`${s.cta} ${featured ? s.ctaMain : ""}`} href="/">Try it with the sample job</Link>
                  <span className={s.ctaNote}>Checking what is open…</span>
                </>
              ) : accountsLive ? (
                <>
                  <Link
                    className={`${s.cta} ${featured ? s.ctaMain : ""}`}
                    href={me?.signedIn ? "/account" : "/signin?next=/account"}
                    onClick={() => track("plan_select", { plan: k, cadence })}
                  >
                    {trialStarted ? "See your trial" : me?.signedIn ? `Start the free ${TRIAL.days} day Pro trial` : `Sign in to start the free ${TRIAL.days} day trial`}
                  </Link>
                  <span className={s.ctaNote}>
                    {trialStarted
                      ? "Paid checkout is not open yet. Nothing is charged meanwhile."
                      : `${TRIAL.days} days of Pro, no card. Paid checkout is not open yet, so nothing can be charged.`}{" "}
                    <Link className="link" href="/">Or try the sample job.</Link>
                  </span>
                </>
              ) : (
                <>
                  <Link className={`${s.cta} ${featured ? s.ctaMain : ""}`} href="/" onClick={() => track("plan_select", { plan: k, cadence })}>
                    Try it with the sample job
                  </Link>
                  <span className={s.ctaNote}>Accounts and paid plans are not open yet. Work is saved in this browser.</span>
                </>
              )}
              <ul className={s.features}>
                <li className={s.includes}>{k === "starter" ? `${p.estimators} estimator account` : `${p.estimators} estimator accounts`}</li>
                {k !== "starter" && <li className={s.includes}>Everything in {k === "pro" ? "Starter" : "Pro"}</li>}
                {extras.map((f) => (
                  <li key={f} className={FEATURES[f].ready ? s.includes : s.later}>
                    {FEATURES[f].label}
                    {!FEATURES[f].ready && <span className={s.soonTag}>Coming soon</span>}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      {buyErr && <p className="warn" role="alert" style={{ marginTop: -40 }}>{buyErr}</p>}
      <section className={s.founding} aria-labelledby="founding-h">
        <div>
          <p className={s.foundingLabel} id="founding-h">Founding contractor offer</p>
          <p className={s.foundingHead}>Pro for {usd(FOUNDING.price)}/month for your first {FOUNDING.periods} months</p>
          <p className={s.foundingSub}>Then {usd(FOUNDING.standard)}/month. Monthly billing.</p>
        </div>
        <div className={s.foundingSide}>
          <p>Save {usd(foundingSavings())} over your first {FOUNDING.periods} paid months compared with standard monthly pricing.</p>
          {status?.checkout && !hasPlan && !me?.foundingUsed && status.founding.remaining !== 0 && (
            <button className={s.foundingBtn} disabled={!!busy || (me?.signedIn && !me.canManageBilling)} onClick={() => buy("pro", "monthly", true)}>
              {busy === "founding" ? "Opening checkout" : me?.signedIn ? "Claim the founding price" : "Sign in to claim the founding price"}
            </button>
          )}
          {me?.foundingUsed && <p className="small">Your company has already used the founding offer.</p>}
          {status?.founding.remaining === 0 && <p className="small">All founding places have been taken.</p>}
          <p className="small">
            {status?.founding.remaining != null ? `${status.founding.remaining} of ${status.founding.limit} places left.` : `Limited to the first ${FOUNDING.limit} paying companies.`} One per company, monthly Pro only, and not combined with annual pricing. Starting a trial does not hold a place.
          </p>
        </div>
      </section>

      <section className={s.leaks} aria-labelledby="leaks-h">
        <h2 id="leaks-h" className={s.h2}>Where job profit quietly leaks</h2>
        <div className={s.leakGrid}>
          {LEAKS.map((l) => (
            <div key={l.title} className={s.leak}>
              <h3>{l.title}</h3>
              <p><span className={s.example}>Example</span> {l.example}</p>
            </div>
          ))}
        </div>
        <p className="small muted">TierScape builds the price from measured areas, your own material costs and production rates, so every line is something you can check.</p>
      </section>

      <section className={s.calc} aria-labelledby="calc-h">
        <div>
          <h2 id="calc-h" className={s.h2}>What is your estimating time worth?</h2>
          <p className="small muted">An illustration, not a promise of savings. Change the numbers to match your week.</p>
        </div>
        <div className={s.calcBody}>
          <label className="field">
            <span className="label">Hours of estimating saved a month</span>
            <input className="input num" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Your time, $ per hour</span>
            <input className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Plan</span>
            <select className="select" value={calcPlan} onChange={(e) => setCalcPlan(e.target.value as PlanKey)}>
              {PLAN_ORDER.map((k) => <option key={k} value={k}>{PLANS[k].name}, {cadence}</option>)}
            </select>
          </label>
          <dl className={s.calcOut}>
            <div><dt>Estimated time value</dt><dd className="num">{usd(h * r)} a month</dd></div>
            <div><dt>{PLANS[calcPlan].name} subscription</dt><dd className="num">{usd(calcPrice, cadence === "annual")} a month{cadence === "annual" ? `, billed ${usd(PLANS[calcPlan].annual)} a year` : ""}</dd></div>
          </dl>
        </div>
      </section>

      <section className={s.compare} aria-labelledby="compare-h">
        <h2 id="compare-h" className={s.h2}>Compare plans</h2>
        <div className="scroll-x">
          <table className={s.table}>
            <thead>
              <tr><th scope="col">Feature</th>{PLAN_ORDER.map((k) => <th key={k} scope="col" className={k === "pro" ? s.colPro : ""}>{PLANS[k].name}</th>)}</tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {PLAN_ORDER.map((k) => {
                    const v = row.values ? row.values[k] : row.key && PLANS[k].features.includes(row.key) ? (FEATURES[row.key].ready ? "Included" : "Coming soon") : "Not included";
                    return <td key={k} className={`${k === "pro" ? s.colPro : ""} ${v === "Not included" ? s.no : v === "Coming soon" ? s.later : ""}`}>{v === "Included" ? <span aria-label="Included">✓</span> : v === "Not included" ? <span aria-label="Not included">·</span> : v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Accurate calculations, cost transparency, saving your work and data export are part of every paid plan.</p>
      </section>

      <section className={s.faq} aria-labelledby="faq-h">
        <h2 id="faq-h" className={s.h2}>Questions</h2>
        {FAQ.map((f) => (
          <details key={f.q} className={s.qa}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
