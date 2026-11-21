"use client";
import { useState } from "react";
import { useEditor } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { money, quote } from "@/lib/pricing";
import { proposalReadiness, readyToShare } from "@/lib/readiness";
import { buildSharedProposal, packProposal } from "@/lib/share";
import { TIERS } from "@/lib/types";
import { Readiness } from "./Readiness";
import s from "./ProposalView.module.css";

/**
 * Nothing goes to a homeowner until the contractor has checked who they are,
 * what they guarantee and what they are charging. The link that comes out
 * holds prices and scope only.
 */
export function ShareReview({ onClose }: { onClose: () => void }) {
  const job = useEditor((x) => x.job!);
  const { profile, pricing, setProfile } = useSettings();
  const settled = readyToShare(proposalReadiness(profile, pricing));
  const [checks, setChecks] = useState({ identity: false, warranty: false, prices: false });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = settled && checks.identity && checks.warranty && checks.prices && !job.sample;
  const tierName = TIERS.find((t) => t.key === job.tier)!.name;
  const address = job.site.matchedAddress ?? job.site.address;

  async function create() {
    setBusy(true);
    try {
      const token = await packProposal(buildSharedProposal(job, profile, pricing));
      const url = `${window.location.origin}/p#${token}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const tick = (k: keyof typeof checks, label: React.ReactNode) => (
    <label className={s.tick}>
      <input type="checkbox" checked={checks[k]} onChange={(e) => { setChecks((c) => ({ ...c, [k]: e.target.checked })); setLink(null); }} />
      <span>{label}</span>
    </label>
  );

  const message = link ? `Hi, here is your landscape proposal for ${address} from ${profile.company}. You can compare the three options and accept the one you want here: ${link}` : "";

  return (
    <section className={`${s.share} no-print`} aria-labelledby="share-h">
      <div className="spread">
        <h2 id="share-h" className="head">Share with the homeowner</h2>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      <p className="small muted">The homeowner sees your brand, the three options, scope, plants, terms and warranty. Never your costs, hours, margin or the build pack.</p>

      {job.sample && <p className="warn">The sample job cannot be shared. Start a job from a real address.</p>}
      {!job.sample && <Readiness compact />}

      <div className={s.review}>
        <div>
          <span className="label">Who it comes from</span>
          <p>
            <strong>{profile.company}</strong>
            <br />
            {[profile.licenseLine, profile.license].filter(Boolean).join(" · ")}
            <br />
            {[profile.phone, profile.email].filter(Boolean).join(" · ")}
          </p>
          {tick("identity", "Company name, license and contact details are correct, and the license claim is true.")}
        </div>
        <div>
          <label className="label" htmlFor="warranty">Warranty</label>
          <textarea id="warranty" className="input" rows={4} value={profile.warranty} onChange={(e) => { setProfile({ warranty: e.target.value }); setLink(null); }} />
          {tick("warranty", "This is the warranty I offer.")}
        </div>
        <div>
          <span className="label">Options</span>
          <ul className={s.optionList}>
            {TIERS.map((t) => (
              <li key={t.key}>
                <span>{t.name}{t.key === job.tier ? " · recommended" : ""}</span>
                <span className="num">{money(quote(job, pricing, t.key).price)}</span>
              </li>
            ))}
          </ul>
          {tick("prices", "I reviewed the scope and price of all three options.")}
        </div>
      </div>

      <div className="row">
        <button className="btn sm solid" onClick={create} disabled={!ready || busy}>{busy ? "Creating" : link ? "Make a new link" : "Create homeowner link"}</button>
        <span className="small muted">Recommends {tierName}. Change it on the Tiers step.</span>
      </div>

      {link && (
        <div className={s.linkBox}>
          <input className="input num" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Homeowner link" />
          <div className="row">
            <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => undefined); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
            <a className="btn sm quiet" href={`sms:?&body=${encodeURIComponent(message)}`}>Text it</a>
            <a className="btn sm quiet" href={`mailto:?subject=${encodeURIComponent(`Your landscape proposal for ${address}`)}&body=${encodeURIComponent(message)}`}>Email it</a>
            <a className="btn sm quiet" href={link} target="_blank" rel="noreferrer">Preview ↗</a>
          </div>
          <p className="small muted">The link holds a snapshot of today&apos;s proposal. If you change the job, make a new link. Acceptances come to {profile.email} by email.</p>
        </div>
      )}
    </section>
  );
}
