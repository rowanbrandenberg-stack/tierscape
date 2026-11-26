"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usdCents, type PublicProposal as Snapshot } from "@/lib/proposal";
import type { TierKey } from "@/lib/types";
import s from "./PublicProposal.module.css";

type Line = { status: string; dueCents: number; paidCents: number; refundedCents: number };
interface View {
  proposal: Snapshot & { id: string; version: number; hash: string };
  expired: boolean;
  acceptance: { tier: TierKey; option: Snapshot["options"][number]; signerName: string; acceptedAt: string; totalCents: number; depositCents: number; balanceCents: number; balanceRequested: boolean; version: number } | null;
  ledger: { deposit: Line; balance: Line; paidCents: number; refundedCents: number; outstandingCents: number } | null;
  receipts: { kind: "deposit" | "balance"; amountCents: number; refundedCents: number; status: string; receiptUrl: string | null }[];
  paymentsOnline: boolean;
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init }).catch(() => null);
  if (!r) throw Object.assign(new Error("Could not connect. Check your internet connection and try again."), { code: "network" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j as { message?: string }).message ?? "Something went wrong."), { code: (j as { error?: string }).error ?? "error" });
  return j as T;
}

export function PublicProposal({ token }: { token: string }) {
  const base = `/api/public/p/${encodeURIComponent(token)}`;
  const [v, setV] = useState<View | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tier, setTier] = useState<TierKey | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ msg: string; code: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [change, setChange] = useState("");
  const [changeSent, setChangeSent] = useState(false);

  const load = useCallback(async () => {
    try {
      const x = await call<View>(base);
      setV(x);
      setTier((t) => x.acceptance?.tier ?? t ?? x.proposal.recommended);
      setLoadErr(null);
      return x;
    } catch (e) {
      setLoadErr((e as Error).message);
      return null;
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Checkout: the redirect alone proves nothing, so wait for the server to hear from Stripe.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("payment");
    if (q !== "submitted") return;
    setConfirming(true);
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const x = await load();
      const settled = x?.ledger && [x.ledger.deposit.status, x.ledger.balance.status].some((st) => st === "paid" || st === "processing");
      if (settled || n > 20) {
        clearInterval(t);
        setConfirming(false);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  const p = v?.proposal;
  const opt = useMemo(() => (v?.acceptance ? v.acceptance.option : p?.options.find((o) => o.tier === tier) ?? p?.options[0]), [v, p, tier]);

  if (loadErr) return <main className={s.page}><p className={s.notice}>{loadErr}</p></main>;
  if (!v || !p || !opt) return <main className={s.page}><p className={s.notice}>Opening your proposal…</p></main>;

  const c = p.company;
  const acc = v.acceptance;
  const initials = c.company.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const idx = p.options.findIndex((o) => o.tier === opt.tier);
  const cheaper = idx > 0 ? p.options[idx - 1] : null;

  async function accept() {
    setBusy("accept");
    setErr(null);
    try {
      await call(`${base}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: p!.id, hash: p!.hash, tier: opt!.tier, name, email, agree }) });
      await load();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr({ msg: (e as Error).message, code: (e as { code?: string }).code ?? "" });
    } finally {
      setBusy(null);
    }
  }

  async function pay(kind: "deposit" | "balance") {
    setBusy(kind);
    setErr(null);
    try {
      const r = await call<{ url: string }>(`${base}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      window.location.assign(r.url);
    } catch (e) {
      setErr({ msg: (e as Error).message, code: (e as { code?: string }).code ?? "" });
      setBusy(null);
    }
  }

  async function sendChange() {
    setBusy("change");
    setErr(null);
    try {
      await call(`${base}/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: change, name }) });
      setChangeSent(true);
      setChange("");
    } catch (e) {
      setErr({ msg: (e as Error).message, code: (e as { code?: string }).code ?? "" });
    } finally {
      setBusy(null);
    }
  }

  const payLine = (kind: "deposit" | "balance", l: Line) => {
    const label = kind === "deposit" ? "Deposit" : acc!.depositCents > 0 ? "Balance" : "Payment";
    const canPay = l.status === "due" || l.status === "failed";
    return (
      <div className={s.payLine}>
        <div>
          <strong>{label}</strong> <span className="num">{usdCents(l.dueCents)}</span>
          <div className="small muted">
            {l.status === "paid" ? "Paid. Thank you." : l.status === "processing" ? "Your bank payment is processing. This can take a few days." : l.status === "refunded" ? "Refunded." : l.status === "review" ? `${c.company} is checking this payment.` : l.status === "not_due" ? (kind === "balance" ? "Due when the work is complete." : "") : l.status === "failed" ? "The last attempt did not go through. You can try again." : "Due now."}
          </div>
        </div>
        {canPay && (v.paymentsOnline ? (
          <button className={s.primary} disabled={!!busy} onClick={() => pay(kind)}>{busy === kind ? "Opening secure checkout" : `Pay ${usdCents(l.dueCents)}`}</button>
        ) : (
          <span className="small muted">Pay {c.company} directly. Online payment is not set up yet.</span>
        ))}
      </div>
    );
  };

  return (
    <main className={s.page} style={{ "--brand": c.brandColor, "--accent": c.accentColor } as React.CSSProperties}>
      <header className={s.letterhead}>
        <div className={s.brand}>
          {c.logo ? <img className={s.logo} src={c.logo} alt="" /> : <span className={s.mono}>{initials}</span>}
          <div>
            <div className={s.company}>{c.company}</div>
            <div className={s.meta}>{[c.licenseLine, c.license].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div className={s.contact}>
          {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a>}
          {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
        </div>
      </header>

      {confirming && <p className={s.banner} role="status">Confirming your payment with {c.company}&apos;s bank… This page updates by itself.</p>}

      {acc ? (
        <section className={s.accepted}>
          <p className="label">Accepted {longDate(acc.acceptedAt)}</p>
          <h1 className={s.title}>{opt.name}</h1>
          <p>
            Signed by {acc.signerName} for <strong>{usdCents(acc.totalCents)}</strong>. This is the version you agreed to (version {acc.version}). It stays exactly as signed.
          </p>
          {v.ledger && (
            <div className={s.pay}>
              {acc.depositCents > 0 && payLine("deposit", v.ledger.deposit)}
              {acc.balanceCents > 0 && payLine("balance", v.ledger.balance)}
              <p className="small muted">Paid so far {usdCents(v.ledger.paidCents - v.ledger.refundedCents)} · Remaining {usdCents(v.ledger.outstandingCents)}</p>
              {v.receipts.filter((r) => r.receiptUrl).map((r) => <a key={r.receiptUrl!} className="small" href={r.receiptUrl!} target="_blank" rel="noreferrer">{r.kind === "deposit" ? "Deposit" : "Balance"} receipt ↗</a>)}
              {v.paymentsOnline && <p className="small muted">Payments are processed securely by Stripe and go directly to {c.company}. No extra fee is added to your payment.</p>}
            </div>
          )}
        </section>
      ) : (
        <section className={s.intro}>
          <p className="label">{p.address ? `Proposal for ${p.address}` : "Your proposal"} · {longDate(p.createdAt)}</p>
          {p.request ? <h1 className={s.title}>&ldquo;{p.request}&rdquo;</h1> : <h1 className={s.title}>Your landscape options</h1>}
          <p className={s.lede}>Here are three ways to do it, from the essentials to the best result. Pick the one that fits and accept it right here.</p>
          {v.expired && <p className={s.warn}>These prices were good through {longDate(p.expiresAt)}. Contact {c.company} to confirm them.</p>}
        </section>
      )}

      {p.photo && (
        <figure className={s.today}>
          <img src={`${base}/image/photo`} alt="Your yard today" />
          <figcaption>Your yard today</figcaption>
        </figure>
      )}

      {!acc && (
        <section className={s.options} aria-label="Options">
          {p.options.map((o) => (
            <button key={o.tier} className={s.option} aria-pressed={o.tier === opt.tier} onClick={() => setTier(o.tier)}>
              {o.render ? (
                <span className={s.optImg}>
                  <img src={`${base}/image/${o.tier}`} alt={`Concept image of the ${o.label} option`} loading="lazy" />
                  <span className={s.badge}>Concept image</span>
                </span>
              ) : null}
              <span className={s.optTop}>
                <span className="label">{o.label}</span>
                {o.tier === p.recommended && <span className={s.rec}>Recommended</span>}
              </span>
              <span className={s.optName}>{o.name}</span>
              <span className={s.optPrice}>{usdCents(o.priceCents)}{o.preliminary && <span className={s.prelim}> preliminary</span>}</span>
              {o.days > 0 && <span className="small muted">About {o.days} {o.days === 1 ? "day" : "days"} of work</span>}
            </button>
          ))}
        </section>
      )}

      <section className={s.detail}>
        {acc && opt.render && (
          <figure className={s.today}>
            <img src={`${base}/image/${opt.tier}`} alt="Concept image of the option you chose" />
            <figcaption>Concept image of your option, not an exact result</figcaption>
          </figure>
        )}
        <h2 className={s.h2}>{opt.label}: {opt.name}</h2>
        {opt.summary && <p>{opt.summary}</p>}
        {opt.includes.length > 0 && <><h3 className={s.h3}>Included</h3><ul className={s.yes}>{opt.includes.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {opt.excludes.length > 0 && <><h3 className={s.h3}>Not included</h3><ul className={s.no}>{opt.excludes.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {opt.limitations.length > 0 && <><h3 className={s.h3}>Good to know</h3><ul>{opt.limitations.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {opt.prepNote && <><h3 className={s.h3}>How it is built</h3><p>{opt.prepNote}</p></>}
        {opt.benefits.length > 0 && <><h3 className={s.h3}>What you get</h3><ul>{opt.benefits.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {p.kind === "plan" && opt.scope.length > 0 && (
          <table className={s.scope}><tbody>{opt.scope.map((g) => <tr key={g.title}><td>{g.title}</td><td className="num">{g.size}</td></tr>)}</tbody></table>
        )}
        {cheaper && !acc && <p className="small muted">{usdCents(opt.priceCents - cheaper.priceCents)} more than {cheaper.label}.</p>}

        {opt.breakdown?.length > 0 && (
          <details className={s.breakdown}>
            <summary>What is in this price</summary>
            {opt.explanation && <p>{opt.explanation}</p>}
            <table className={s.scope}>
              <tbody>
                {opt.breakdown.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}{l.parts.length > 0 && <div className="small muted">{l.parts.join(", ")}</div>}</td>
                    <td className="num">{usdCents(l.cents)}</td>
                  </tr>
                ))}
                <tr><td><strong>Total</strong></td><td className="num"><strong>{usdCents(opt.breakdown.reduce((t, l) => t + l.cents, 0))}</strong></td></tr>
              </tbody>
            </table>
            <p className="small muted">Each part is shown at its price to you, with labor, overhead and the contractor&apos;s margin included.</p>
          </details>
        )}

        {!acc && opt.alternatives?.length > 0 && (
          <div className={s.alts}>
            <h3 className={s.h3}>Ways to bring the price down</h3>
            <ul>
              {opt.alternatives.map((alt) => (
                <li key={alt.id}>
                  <span><strong>{alt.label}</strong>: about {usdCents(alt.priceCents)}, saves {usdCents(alt.savesCents)}{alt.later.length > 0 && <span className="small muted"> Later: {alt.later.join(", ")}.</span>}</span>
                  <button className="link small" onClick={() => { setChangeOpen(true); setChangeSent(false); setChange(`I am interested in this change to the ${opt.label} option: ${alt.label} (about ${usdCents(alt.priceCents)}).`); }}>Ask about this</button>
                </li>
              ))}
            </ul>
            <p className="small muted">Worked out from this job&apos;s own estimate. {c.company} confirms any change in an updated proposal before you accept it.</p>
          </div>
        )}

        <div className={s.money}>
          <div><span className="label">Total</span><span className={s.total}>{usdCents(opt.priceCents)}</span></div>
          <dl>
            <dt>{opt.depositCents > 0 ? `Deposit when you accept (${p.terms.depositPct}%)` : "Due when you accept"}</dt><dd className="num">{usdCents(opt.depositCents)}</dd>
            <dt>Due when the work is complete</dt><dd className="num">{usdCents(opt.balanceCents)}</dd>
          </dl>
        </div>
      </section>

      {(p.disclosures.length > 0 || p.assumptions.length > 0) && (
        <section className={s.notes}>
          <h2 className={s.h2}>Please read</h2>
          <ul>{p.disclosures.map((d) => <li key={d}>{d}</li>)}</ul>
          {p.assumptions.length > 0 && <><h3 className={s.h3}>This price assumes</h3><ul>{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></>}
        </section>
      )}

      <section className={s.notes}>
        <h2 className={s.h2}>Terms</h2>
        <ol>{p.terms.lines.map((t) => <li key={t}>{t}</li>)}</ol>
        <h3 className={s.h3}>Warranty</h3>
        <p>{c.warranty}</p>
      </section>

      {!acc && !v.expired && (
        <section className={s.acceptBox} aria-labelledby="accept-h">
          <h2 id="accept-h" className={s.h2}>Accept {opt.label}: {opt.name}</h2>
          <label className={s.field}>
            <span>Your full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
          </label>
          <label className={s.field}>
            <span>Email for your receipt (optional)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
          </label>
          <label className={s.check}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I accept the {opt.label} option for {usdCents(opt.priceCents)} with the scope, terms and warranty above. Typing my name is my signature.</span>
          </label>
          <button className={s.primary} disabled={!agree || name.trim().length < 2 || busy === "accept"} onClick={accept}>{busy === "accept" ? "Accepting" : opt.depositCents > 0 ? "Accept and continue to the deposit" : "Accept"}</button>
          {err?.code === "stale_version" && <button className={s.secondary} onClick={() => { setErr(null); void load(); }}>Show me the updated proposal</button>}
        </section>
      )}

      {err && <p className={s.warn} role="alert">{err.msg}</p>}

      <section className={s.notes}>
        {!changeOpen ? (
          <button className={s.secondary} onClick={() => setChangeOpen(true)}>Ask for a change or a question</button>
        ) : changeSent ? (
          <p>Sent to {c.company}. They will get back to you.</p>
        ) : (
          <div className={s.field}>
            <span>What would you like changed?</span>
            <textarea rows={4} value={change} onChange={(e) => setChange(e.target.value)} maxLength={2000} />
            <button className={s.secondary} disabled={change.trim().length < 3 || busy === "change"} onClick={sendChange}>{busy === "change" ? "Sending" : "Send to " + c.company}</button>
          </div>
        )}
      </section>

      <footer className={s.foot}>
        <button className="link" onClick={() => window.print()}>Print or save</button> · Prepared with Tierscape
      </footer>
    </main>
  );
}
