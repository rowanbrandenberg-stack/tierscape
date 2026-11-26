"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/client/api";
import { useAccount } from "@/client/account";
import { useEditor } from "@/client/editor";
import { proposalApi, saveLink, savedLink, type ProposalStatus } from "@/client/proposalApi";
import { useSettings } from "@/client/settingsStore";
import { TIER_LABEL } from "@/lib/concept";
import { publishReadiness, usdCents } from "@/lib/proposal";
import s from "./ProposalView.module.css";

const PAY_STATUS: Record<string, string> = { not_due: "Not due yet", due: "Due", processing: "Processing", paid: "Paid", refunded: "Refunded", failed: "Last attempt failed", review: "Needs your review" };

/**
 * Publish a versioned proposal to the homeowner's link, and follow what
 * happens next: views, acceptance, change requests and payments. Every
 * price shown to the homeowner is worked out again on the server.
 */
export function PublishPanel() {
  const job = useEditor((x) => x.job!);
  const { profile, pricing } = useSettings();
  const me = useAccount((x) => x.me);
  const [status, setStatus] = useState<ProposalStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = publishReadiness(job, profile, pricing);
  const signedIn = !!me?.signedIn && !!me.company;

  const refresh = useCallback(() => {
    if (!signedIn) return;
    proposalApi.status(job.id).then(setStatus).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the proposal status."));
  }, [job.id, signedIn]);

  useEffect(() => {
    setToken(savedLink(job.id));
    refresh();
  }, [job.id, refresh]);

  const url = token ? `${window.location.origin}/p/${token}` : null;

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const publish = () =>
    act("publish", async () => {
      await proposalApi.saveJob(useEditor.getState().job!);
      const r = await proposalApi.publish(job.id);
      if (r.token) {
        saveLink(job.id, r.token);
        setToken(r.token);
      }
    });
  const rotate = () => act("rotate", async () => {
    const r = await proposalApi.link(job.id, "rotate");
    saveLink(job.id, r.token);
    setToken(r.token);
  });
  const revoke = () => act("revoke", async () => {
    await proposalApi.link(job.id, "revoke");
    saveLink(job.id, null);
    setToken(null);
  });

  if (!me) return null;
  if (!signedIn)
    return (
      <section className={`${s.share} no-print`}>
        <h2 className="head">Send it online</h2>
        <p className="small muted">An online proposal lets the client pick an option, sign and pay the deposit from one link. It needs your account so the signed version and payments are kept safely.</p>
        <div className="row"><Link className="btn sm solid" href="/signin">Sign in</Link></div>
      </section>
    );

  const acc = status?.acceptance;
  const latest = status?.versions[0];
  const ps = status?.paymentsState;
  const message = url ? `Hi, here is your landscape proposal from ${profile.company}. Compare the options and accept the one you want here: ${url}` : "";

  return (
    <section className={`${s.share} no-print`} aria-labelledby="pub-h">
      <div className="spread">
        <h2 id="pub-h" className="head">Send it online</h2>
        {latest && <span className="small muted">Version {latest.version}, {latest.status}</span>}
      </div>

      {acc ? (
        <div className={s.signedBox}>
          <strong>Accepted by {acc.signer_name}</strong>
          <p className="small">
            {TIER_LABEL[acc.tier]}: {acc.option_snapshot.name} for {usdCents(acc.total_cents)} on {new Date(acc.accepted_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. This signed version is locked: later edits to the job do not change it.
          </p>
          {status?.ledger && (
            <dl className={s.ledger}>
              {acc.deposit_cents > 0 && <><dt>Deposit {usdCents(acc.deposit_cents)}</dt><dd>{PAY_STATUS[status.ledger.deposit.status]}</dd></>}
              <dt>{acc.deposit_cents > 0 ? "Balance" : "Payment"} {usdCents(acc.balance_cents)}</dt><dd>{acc.balance_requested_at ? PAY_STATUS[status.ledger.balance.status] : "Not requested yet"}</dd>
              <dt>Received</dt><dd className="num">{usdCents(status.ledger.paidCents - status.ledger.refundedCents)}</dd>
              <dt>Still owed</dt><dd className="num">{usdCents(status.ledger.outstandingCents)}</dd>
            </dl>
          )}
          {status?.payments.some((p) => p.status === "mismatch") && <p className="warn">A payment did not match the agreed amount and was not counted. Check it in your Stripe dashboard.</p>}
          {acc.balance_cents > 0 && !acc.balance_requested_at && (
            <button className="btn sm" disabled={busy === "balance"} onClick={() => act("balance", async () => void (await proposalApi.requestBalance(job.id)))}>The work is done: ask for the balance</button>
          )}
        </div>
      ) : (
        <>
          {ready.blockers.length > 0 && (
            <div className={s.problems} role="alert">
              <strong>Before you publish</strong>
              <ul>{ready.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              {ready.blockers.some((b) => /company|license|email|phone|warranty/i.test(b)) && <Link className="btn sm" href="/settings">Open Settings</Link>}
            </div>
          )}
          {ready.warnings.length > 0 && <ul className="small muted">{ready.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="row">
            <button className="btn sm solid" disabled={!!ready.blockers.length || busy === "publish"} onClick={publish}>
              {busy === "publish" ? "Publishing" : latest ? "Publish changes as a new version" : "Publish proposal"}
            </button>
            <span className="small muted">Prices are worked out again on the server from your saved job and price book.</span>
          </div>
        </>
      )}

      {latest && (
        <div className={s.linkBox}>
          {url ? (
            <>
              <input className="input num" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Homeowner link" />
              <div className="row">
                <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(url).catch(() => undefined); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
                <a className="btn sm quiet" href={`sms:?&body=${encodeURIComponent(message)}`}>Text it</a>
                <a className="btn sm quiet" href={`mailto:?subject=${encodeURIComponent(`Your landscape proposal from ${profile.company}`)}&body=${encodeURIComponent(message)}`}>Email it</a>
                <a className="btn sm quiet" href={url} target="_blank" rel="noreferrer">Preview ↗</a>
              </div>
            </>
          ) : (
            <p className="small muted">{status?.link ? "A link is live, but it was made on another device. Make a new one to copy it here (the old one stops working)." : "Sharing is off."}</p>
          )}
          <div className="row">
            <button className="link small" disabled={busy === "rotate"} onClick={rotate}>{status?.link ? "Make a new link" : "Turn sharing on"}</button>
            {status?.link && <button className="link small" disabled={busy === "revoke"} onClick={revoke}>Turn the link off</button>}
            {status?.link?.last_viewed_at && <span className="small muted">Last opened {new Date(status.link.last_viewed_at).toLocaleString("en-US")}</span>}
          </div>
          <p className="small muted">You send the link yourself. Tierscape never messages your client.</p>
        </div>
      )}

      {status && status.changes.length > 0 && (
        <div>
          <span className="label">Change requests</span>
          <ul className={s.changes}>{status.changes.map((c) => <li key={c.id}><strong>{c.name || "Client"}</strong>: {c.message} <span className="small muted">{new Date(c.created_at).toLocaleDateString("en-US")}</span></li>)}</ul>
        </div>
      )}

      {ps && (
        <div className="small">
          <span className="label">Online payments</span>
          {ps.ready ? (
            <p className="muted">On. Deposits and balances go straight to your Stripe account{ps.livemode ? "" : " (sandbox)"}. {ps.feeBps > 0 ? `Tierscape keeps a ${(ps.feeBps / 100).toFixed(2)}% platform fee.` : "Tierscape takes no platform fee."} Stripe charges its own processing fee to your account.</p>
          ) : (
            <>
              <ul className="muted">{ps.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
              <p className="muted">Until then the client can still accept online, and you collect payment your usual way. <Link href="/settings#payments">Payment settings</Link></p>
            </>
          )}
        </div>
      )}
      {error && <p className="warn" role="alert">{error}</p>}
    </section>
  );
}
