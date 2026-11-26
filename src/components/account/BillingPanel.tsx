"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, type Me } from "@/client/account";
import { FOUNDING, PLAN_ORDER, PLANS, sellable, TRIAL, usd, type Cadence, type PlanKey } from "@/lib/billing/plans";
import s from "./Account.module.css";

const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

type Preview = { kind: string; when: "now" | "period_end"; summary: string; foundingWarning: string | null; dueNow: number; nextAmount: number | null; effective: number; taxNote: string };

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(j.message ?? "Something went wrong.");
  return j;
}

/** Plan and billing from verified state. Every paid change is previewed before it happens. */
export function BillingPanel({ me }: { me: Me }) {
  const refresh = useAccount((x) => x.refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [target, setTarget] = useState<{ plan: PlanKey; cadence: Cadence } | "cancel" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [waiting, setWaiting] = useState(false);

  const a = me.access!;
  const sub = me.subscription ?? null;
  const live = sub && ["active", "past_due", "trialing"].includes(sub.status);
  const manage = !!me.canManageBilling;

  // Back from Checkout: wait for Stripe's confirmation instead of trusting the redirect.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("checkout") !== "done" || live) return;
    setWaiting(true);
    let n = 0;
    const t = setInterval(async () => {
      const m = await refresh();
      if (m?.subscription && ["active", "trialing"].includes(m.subscription.status)) {
        clearInterval(t);
        setWaiting(false);
        setNote("Payment confirmed. Your plan is active.");
        window.history.replaceState(null, "", "/account");
      } else if (++n > 20) {
        clearInterval(t);
        setWaiting(false);
        setNote("We have not had confirmation from Stripe yet. If you completed payment it will appear shortly; nothing is charged twice if you check back.");
      }
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const status = waiting
    ? "Confirming payment with Stripe"
    : a.mode === "trial"
      ? `Free trial, ends ${day(a.trialEndsAt!)}`
      : sub?.status === "past_due"
        ? "Payment failed. Update your card to keep creating work"
        : sub?.cancelAtPeriodEnd && live
          ? `Cancels on ${day(sub.periodEnd)}`
          : live
            ? "Active"
            : a.mode === "readonly"
              ? "Ended. View and export only"
              : "No plan yet";

  return (
    <div className={s.body}>
      {a.notice && <p className={s.banner}>{a.notice}</p>}
      {note && <p className={s.ok} role="status">{note}</p>}
      <dl className={s.facts}>
        <div><dt>Plan</dt><dd>{live ? `${PLANS[sub!.plan].name}, ${sub!.cadence === "annual" ? "billed annually" : "billed monthly"}` : a.mode === "trial" ? "Pro trial" : "None"}</dd></div>
        <div><dt>Status</dt><dd>{status}</dd></div>
        <div>
          <dt>Next charge</dt>
          <dd>{me.nextCharge ? `${usd(me.nextCharge.amount)} on ${day(me.nextCharge.at)}, plus any sales tax` : a.mode === "trial" ? "None. The trial never charges you" : "None scheduled"}</dd>
        </div>
        <div>
          <dt>{sub?.founding ? "Founding price" : "Trial"}</dt>
          <dd>
            {sub?.founding
              ? sub.founding.left > 0
                ? `${usd(FOUNDING.price)}/month for ${sub.founding.left} more paid ${sub.founding.left === 1 ? "month" : "months"}, then ${usd(FOUNDING.standard)}/month`
                : `Ended. Now ${usd(FOUNDING.standard)}/month`
              : me.company?.trialStartedAt
                ? a.mode === "trial"
                  ? `Ends ${day(a.trialEndsAt!)}`
                  : "Used"
                : `Not started. ${TRIAL.days} days of Pro, no card`}
          </dd>
        </div>
      </dl>

      {!manage && <p className={s.note}>Only the owner or a billing admin can change billing.</p>}
      {!live && !me.checkout && <p className={s.note}>Paid checkout is not open yet, so nothing can be charged.{me.company?.trialStartedAt ? "" : " The free trial works now."}</p>}
      {manage && (
        <div className="row">
          {!live && !me.company?.trialStartedAt && (
            <button className="btn solid" disabled={!!busy} onClick={() => run("trial", async () => { await post("/api/billing/trial"); await refresh(); setNote(`Your ${TRIAL.days} day Pro trial has started. No card needed.`); })}>
              {busy === "trial" ? "Starting" : `Start ${TRIAL.days} day Pro trial`}
            </button>
          )}
          {!live && me.checkout && <Link className={`btn ${me.company?.trialStartedAt ? "solid" : ""}`} href="/pricing">Choose a plan</Link>}
          {!live && !me.checkout && <Link className="btn quiet" href="/pricing">See plans</Link>}
          {live && <button className="btn solid" onClick={() => { setChanging((v) => !v); setTarget(null); setPreview(null); }}>Change plan</button>}
          {me.company && (sub || me.checkout) && (
            <button className="btn" disabled={!!busy} onClick={() => run("portal", async () => { const r = await post<{ url: string }>("/api/billing/portal"); window.location.href = r.url; })}>
              {busy === "portal" ? "Opening" : "Invoices and payment method"}
            </button>
          )}
          {live && !sub!.cancelAtPeriodEnd && <button className="btn quiet" onClick={() => { setChanging(true); setTarget("cancel"); setPreview(null); }}>Cancel plan</button>}
          {live && sub!.cancelAtPeriodEnd && (
            <button className="btn" disabled={!!busy} onClick={() => run("react", async () => { const r = await post<{ message: string }>("/api/billing/change", { step: "confirm", to: "reactivate" }); setNote(r.message); await refresh(); })}>
              {busy === "react" ? "Working" : "Keep my plan"}
            </button>
          )}
        </div>
      )}

      {changing && live && manage && (
        <div className={s.change}>
          {target !== "cancel" && (
            <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
              <span className="label">Change to</span>
              <div className={s.choices}>
                {PLAN_ORDER.filter((k) => sellable(k, true).ok).flatMap((k) =>
                  (["monthly", "annual"] as Cadence[]).map((c) => {
                    const cur = sub!.plan === k && sub!.cadence === c;
                    const on = typeof target === "object" && target?.plan === k && target.cadence === c;
                    return (
                      <button key={`${k}${c}`} className={s.choice} aria-pressed={on} disabled={cur} onClick={() => { setTarget({ plan: k, cadence: c }); setPreview(null); }}>
                        <strong>{PLANS[k].name}</strong> {c === "monthly" ? `${usd(PLANS[k].monthly)}/month` : `${usd(PLANS[k].annual)}/year`}
                        {cur && <span className="small"> · current</span>}
                      </button>
                    );
                  }),
                )}
              </div>
            </div>
          )}
          {target && !preview && (
            <button className="btn solid" disabled={!!busy} onClick={() => run("preview", async () => setPreview(await post<Preview>("/api/billing/change", { step: "preview", to: target })))}>
              {busy === "preview" ? "Checking" : target === "cancel" ? "See what cancelling means" : "Preview this change"}
            </button>
          )}
          {preview && (
            <div className={s.previewBox}>
              <p>{preview.summary}</p>
              {preview.foundingWarning && <p className="warn">{preview.foundingWarning}</p>}
              <dl className={s.previewFacts}>
                <div><dt>Due now</dt><dd className="num">{usd(preview.dueNow, true)}</dd></div>
                <div><dt>Then</dt><dd className="num">{preview.nextAmount == null ? "Nothing after the end date" : `${usd(preview.nextAmount)} ${typeof target === "object" && target?.cadence === "annual" ? "a year" : "a month"}`}</dd></div>
                <div><dt>Takes effect</dt><dd>{preview.when === "now" ? "Right after payment" : day(preview.effective)}</dd></div>
              </dl>
              <p className="small">{preview.taxNote}</p>
              <div className="row">
                <button className="btn solid" disabled={!!busy} onClick={() => run("confirm", async () => { const r = await post<{ ok: boolean; message: string }>("/api/billing/change", { step: "confirm", to: target, nonce: String(Date.now()) }); if (!r.ok) throw new Error(r.message); setNote(r.message); setChanging(false); setPreview(null); await refresh(); })}>
                  {busy === "confirm" ? "Working" : target === "cancel" ? "Cancel at period end" : preview.dueNow > 0 ? `Pay ${usd(preview.dueNow, true)} and switch` : "Confirm change"}
                </button>
                <button className="btn quiet" onClick={() => { setChanging(false); setPreview(null); setTarget(null); }}>Never mind</button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && <p className="warn" role="alert">{err}</p>}
    </div>
  );
}
