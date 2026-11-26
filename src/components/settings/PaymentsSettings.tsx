"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/client/api";
import { useAccount } from "@/client/account";
import { proposalApi, type PaymentsState } from "@/client/proposalApi";
import s from "./settings.module.css";

/**
 * Homeowner payments go to the contractor's own Stripe account. This is not
 * the Tierscape subscription: that lives in the account center.
 */
export function PaymentsSettings() {
  const me = useAccount((x) => x.me);
  const [st, setSt] = useState<PaymentsState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = !!me?.signedIn && !!me.company;

  useEffect(() => {
    if (!signedIn) return;
    proposalApi.connect().then(setSt).catch((e) => setErr(e instanceof ApiError ? e.message : "Could not check payments."));
  }, [signedIn]);

  async function onboard() {
    setBusy(true);
    setErr(null);
    try {
      window.location.assign((await proposalApi.onboard()).url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not open Stripe.");
      setBusy(false);
    }
  }

  const canStart = st && !st.blockers.some((b) => ["accounts", "stripe_key", "stripe_live"].includes(b.code));

  return (
    <section id="payments" className={s.section} aria-labelledby="pay-h">
      <div className={s.aside}>
        <h2 id="pay-h" className="head">Client payments</h2>
        <p className="small muted">Let clients pay deposits and balances from their proposal link, straight into your own Stripe account. Separate from your Tierscape plan.</p>
      </div>
      <div className={s.content}>
        {!me ? null : !signedIn ? (
          <p className="small">Sign in to connect payments. <Link href="/signin">Sign in</Link></p>
        ) : !st ? (
          <p className="small muted">{err ?? "Checking with Stripe…"}</p>
        ) : st.ready ? (
          <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
            <p><strong>On{st.livemode ? "" : ", sandbox"}.</strong> Clients can pay online. Money goes to your Stripe account and Stripe pays it out to your bank.</p>
            {!st.livemode && <p className="small muted">This is a Stripe sandbox: use test cards only, no real money moves.</p>}
          </div>
        ) : (
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <p><strong>Not ready yet.</strong></p>
            <ul className="small">{st.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
            {canStart && me.canManageBilling && (
              <div className="row">
                <button className="btn sm solid" disabled={busy} onClick={onboard}>{busy ? "Opening Stripe" : st.accountId ? "Continue Stripe setup" : "Connect Stripe"}</button>
              </div>
            )}
            {canStart && !me.canManageBilling && <p className="small muted">Ask the account owner to connect Stripe.</p>}
          </div>
        )}
        <dl className="small" style={{ margin: 0 }}>
          <dt className="label">Tierscape platform fee</dt>
          <dd style={{ margin: "2px 0 8px" }}>{st && st.feeBps > 0 ? `${(st.feeBps / 100).toFixed(2)}% of each client payment, taken from your payout.` : "None. Tierscape takes nothing from client payments."}</dd>
          <dt className="label">Card processing</dt>
          <dd style={{ margin: "2px 0 0" }}>Charged by Stripe to your Stripe account at your Stripe rates. Nothing is added to what your client pays.</dd>
        </dl>
        {err && st && <p className="warn">{err}</p>}
      </div>
    </section>
  );
}
