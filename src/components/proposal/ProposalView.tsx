"use client";
import { useState } from "react";
import { useEditor } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { yardIllustration } from "@/lib/illustration";
import { groupSize, money, quote } from "@/lib/pricing";
import { TIERS } from "@/lib/types";
import { Readiness } from "./Readiness";
import { ShareReview } from "./ShareReview";
import s from "./ProposalView.module.css";

const today = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function ProposalView({ onBuild }: { onBuild: () => void }) {
  const ed = useEditor();
  const { profile, pricing } = useSettings();
  const job = ed.job!;
  const q = quote(job, pricing, job.tier);
  const tierName = TIERS.find((t) => t.key === job.tier)!.name;
  const half = Math.round(q.price / 2);
  const [name, setName] = useState("");
  const [err, setErr] = useState(false);
  const [sharing, setSharing] = useState(false);
  const photo = job.photos.find((p) => p.id === job.activePhotoId);
  const placed = job.plants.filter((p) => p.spots.length);
  const initials = profile.company.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className={s.wrap}>
      <div className={`${s.controls} no-print`}>
        <span className="label">Payment terms</span>
        <div className="seg" role="group" aria-label="Payment terms">
          <button aria-pressed={job.terms === "split"} onClick={() => ed.commit((j) => void (j.terms = "split"))}>50% deposit, 50% on completion</button>
          <button aria-pressed={job.terms === "bid"} onClick={() => ed.commit((j) => void (j.terms = "bid"))}>Fixed bid, paid on completion</button>
        </div>
        <button className="btn sm quiet" onClick={() => window.print()}>Print or save PDF</button>
        <button className="btn sm solid" onClick={() => setSharing((v) => !v)} aria-expanded={sharing}>Share with homeowner</button>
      </div>
      {!job.sample && !sharing && (
        <div className="no-print">
          <Readiness compact />
        </div>
      )}
      {sharing && <ShareReview onClose={() => setSharing(false)} />}

      <article className={s.doc} style={{ "--brand": profile.brandColor, "--accent": profile.accentColor } as React.CSSProperties}>
        <header className={s.letterhead}>
          <div className={s.brand}>
            {profile.logo ? <img className={s.logo} src={profile.logo} alt="" /> : <span className={s.mono}>{initials}</span>}
            <div>
              <div className={s.company}>{profile.company}</div>
              <div className={s.meta}>{[profile.licenseLine, profile.license].filter(Boolean).join(" · ")}</div>
              <div className={s.meta}>{[profile.phone, profile.email, profile.website].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          <div className={s.dated}>
            <div className="label">Proposal</div>
            <div>{today()}</div>
          </div>
        </header>

        <section className={s.cover}>
          <div>
            <div className="label">Prepared for</div>
            <h2 className={s.address}>{job.site.matchedAddress ?? job.site.address}</h2>
            <span className={s.plan}>{tierName} plan</span>
          </div>
          <div className={s.picture}>
            {photo?.dataUrl ? <img src={photo.dataUrl} alt="The yard today" /> : <span dangerouslySetInnerHTML={{ __html: yardIllustration(job, pricing, job.tier) }} />}
          </div>
        </section>

        <section className={s.section}>
          <h3 className="label">Scope of work</h3>
          <table className="table">
            <thead><tr><th>Work</th><th className="r">Size</th></tr></thead>
            <tbody>
              {q.groups.map((g) => (
                <tr key={g.title}><td>{g.title}</td><td className="r num">{groupSize(g)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {placed.length > 0 && (
          <section className={s.section}>
            <h3 className="label">Plants</h3>
            <table className="table">
              <thead><tr><th>Plant</th><th>Installed size</th><th className="r">Qty</th></tr></thead>
              <tbody>
                {placed.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name || "Unnamed plant"}
                      {p.estimate && <div className="small muted">Expected here after 10 years: about {p.estimate.heightFt} ft tall, {p.estimate.spreadFt} ft wide</div>}
                    </td>
                    <td>{pricing.plantSizes[p.kind][job.tier].size}</td>
                    <td className="r num">{p.spots.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className={s.total}>
          <div>
            <div className="label">{job.terms === "bid" ? "Fixed bid" : "Project total"}</div>
            <div className={s.price}>{money(q.price)}</div>
            <p className="small muted">Includes materials, labor and cleanup. About {q.days} {q.days === 1 ? "day" : "days"} on site. Good for 30 days.</p>
          </div>
          <div className={s.pay}>
            <div><span className="label">{job.terms === "split" ? "Deposit at signing" : "Due at signing"}</span><span className="num">{job.terms === "split" ? money(half) : "$0"}</span></div>
            <div><span className="label">Due at completion</span><span className="num">{job.terms === "split" ? money(q.price - half) : money(q.price)}</span></div>
          </div>
        </section>

        <section className={s.section}>
          <h3 className="label">Agreement</h3>
          <ol className={s.terms}>
            <li>We will locate underground utilities through 811 before any digging. Work starts once every utility has responded.</li>
            <li>Changes to the scope are priced in writing before the work is done.</li>
            <li>{profile.warranty || "Plants are guaranteed for one growing season when watered as instructed. Damage from weather, animals or neglect is not covered."}</li>
            <li>{job.terms === "split" ? "The deposit secures your place on the schedule and orders materials. The balance is due when the work is complete." : "Payment is due in full when the work is complete."}</li>
            <li>Property lines come from public parcel maps and are approximate. Work along a boundary needs the corners confirmed first.</li>
          </ol>
        </section>

        <section className={s.signatures}>
          <div className={s.sig}>
            {job.signature ? (
              <>
                <div className={s.signed}>{job.signature.name}</div>
                <div className={s.sigLine} />
                <div className="small muted">Homeowner · accepted {job.signature.date}</div>
              </>
            ) : (
              <div className="no-print stack" style={{ "--gap": "8px" } as React.CSSProperties}>
                <label className="label" htmlFor="sign-name">Homeowner signature</label>
                <div className="row">
                  <input id="sign-name" className="input" style={{ flex: "1 1 200px", width: "auto" }} value={name} onChange={(e) => { setName(e.target.value); setErr(false); }} placeholder="Type full name to sign" />
                  <button
                    className={s.accept}
                    onClick={() => {
                      if (!name.trim()) return setErr(true);
                      ed.commit((j) => void (j.signature = { name: name.trim(), date: today() }));
                    }}
                  >
                    Accept and sign
                  </button>
                </div>
                {err && <p className="warn">Type the homeowner name to sign.</p>}
              </div>
            )}
          </div>
          <div className={s.sig}>
            <div className={s.signed} aria-hidden="true">&nbsp;</div>
            <div className={s.sigLine} />
            <div className="small muted">{profile.company}</div>
          </div>
        </section>
      </article>

      {job.signature && (
        <div className={`${s.after} no-print`}>
          <p>{job.terms === "split" ? `Signed. The ${money(half)} deposit is due now.` : "Signed. Nothing is due until the work is complete."}</p>
          <div className="row">
            <button className="btn sm on-night" onClick={() => ed.commit((j) => void (j.signature = null))}>Clear signature</button>
            <button className="btn sm on-night" onClick={onBuild}>Open the build pack <span aria-hidden="true">→</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
