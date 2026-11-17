"use client";
import { useEffect, useMemo, useState } from "react";
import { AREA_TYPES } from "@/lib/catalog";
import { centroid } from "@/lib/geometry";
import { money } from "@/lib/pricing";
import { tilesForExtent } from "@/lib/projection";
import { scopeDiff, sharedSqft, unpackProposal, type SharedProposal } from "@/lib/share";
import type { TierKey } from "@/lib/types";
import { SampleLot } from "../plan/SampleLot";
import s from "./HomeownerProposal.module.css";

const longDate = (iso: string, addDays = 0) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + addDays);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

export function HomeownerProposal() {
  const [p, setP] = useState<SharedProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<TierKey>("standard");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) return setError("This link is missing the proposal. Ask your contractor to send it again.");
    unpackProposal(token)
      .then((x) => {
        setP(x);
        setTier(x.recommended);
      })
      .catch(() => setError("This proposal link is incomplete. It may have been cut off when it was copied. Ask your contractor to send it again."));
  }, []);

  if (error) return <main className={s.page}><p className={s.notice}>{error}</p></main>;
  if (!p) return <main className={s.page}><p className={s.notice}>Opening your proposal…</p></main>;

  const t = p.tiers.find((x) => x.key === tier) ?? p.tiers[0];
  const idx = p.tiers.indexOf(t);
  const prev = idx > 0 ? p.tiers[idx - 1] : null;
  const half = Math.round(t.price / 2);
  const c = p.company;
  const expires = longDate(p.created, p.validDays);
  const expired = new Date(`${p.created}T12:00:00`).getTime() + p.validDays * 864e5 < Date.now();
  const initials = c.company.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function accept() {
    if (!name.trim() || !agree) return;
    const subject = `Accepting the ${t.name} plan for ${p!.address}`;
    const body = [
      `I accept the ${t.name} plan for ${p!.address} at ${money(t.price)}${p!.terms === "split" ? `, with a ${money(half)} deposit at signing and ${money(t.price - half)} on completion` : ", paid on completion"}.`,
      "",
      `I agree to the terms and warranty in the proposal dated ${longDate(p!.created)}.`,
      "",
      `Signed: ${name.trim()}`,
      `Date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      "",
      `Proposal: ${window.location.href}`,
    ].join("\n");
    window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  }

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
          {c.website && <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a>}
        </div>
      </header>

      <section className={s.intro}>
        <p className="label">Proposal · {longDate(p.created)}</p>
        <h1 className={s.title}>{p.address}</h1>
        <p className={s.lede}>Three ways to do the work, priced and ready to go. Pick the one that fits, read the terms, and accept it right here.</p>
        {expired && <p className="warn">These prices were good through {expires}. Contact {c.company} to confirm them before accepting.</p>}
      </section>

      <SharedPlan p={p} />

      <section className={s.tiers} aria-label="Options">
        {p.tiers.map((x) => (
          <button key={x.key} className={s.tier} aria-pressed={x.key === tier} onClick={() => { setTier(x.key); setSent(false); }}>
            <span className={s.tierTop}>
              <span className="label">{x.name}</span>
              {x.key === p.recommended && <span className={s.badge}>Recommended</span>}
            </span>
            <span className={s.tierPrice}>{money(x.price)}</span>
            <span className="small muted">About {x.days} {x.days === 1 ? "day" : "days"} on site</span>
          </button>
        ))}
      </section>

      <section className={s.detail}>
        <div className="stack">
          <h2 className={s.h2}>What the {t.name} plan includes</h2>
          <table className="table">
            <thead><tr><th>Work</th><th className="r">Size</th></tr></thead>
            <tbody>{t.scope.map((g) => <tr key={g.title}><td>{g.title}</td><td className="r num">{g.size}</td></tr>)}</tbody>
          </table>
          {t.plants.length > 0 && (
            <table className="table">
              <thead><tr><th>Plant</th><th>Size</th><th className="r">Qty</th></tr></thead>
              <tbody>
                {t.plants.map((pl) => (
                  <tr key={pl.name}>
                    <td>{pl.name}{pl.note && <div className="small muted">{pl.note}</div>}</td>
                    <td>{pl.size}</td>
                    <td className="r num">{pl.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {prev && (
            <div className={s.diff}>
              <span className="label">Compared with {prev.name}, {money(t.price - prev.price)} more</span>
              <ul>{scopeDiff(prev, t).map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
        </div>

        <aside className={s.side}>
          <div className={s.total}>
            <span className="label">{p.terms === "bid" ? "Fixed bid" : "Project total"}</span>
            <span className={s.totalPrice}>{money(t.price)}</span>
            <span className="small muted">Materials, labor and cleanup included. Good through {expires}.</span>
          </div>
          <dl className={s.pay}>
            <dt>{p.terms === "split" ? "Deposit at signing" : "Due at signing"}</dt><dd className="num">{p.terms === "split" ? money(half) : "$0"}</dd>
            <dt>Due at completion</dt><dd className="num">{p.terms === "split" ? money(t.price - half) : money(t.price)}</dd>
          </dl>
        </aside>
      </section>

      <section className={s.terms}>
        <h2 className={s.h2}>Terms</h2>
        <ol>
          <li>We locate underground utilities through 811 before any digging. Work starts once every utility has responded.</li>
          <li>Any change to the scope is priced in writing before the work is done.</li>
          <li>{p.terms === "split" ? "The deposit secures your place on the schedule and orders materials. The balance is due when the work is complete." : "Payment is due in full when the work is complete."}</li>
          <li>Property lines come from public parcel maps and are approximate. Work along a boundary needs the corners confirmed first.</li>
        </ol>
        <h3 className="label">Warranty</h3>
        <p>{c.warranty}</p>
      </section>

      <section className={s.accept}>
        <h2 className={s.h2}>Accept the {t.name} plan</h2>
        <label className={s.check}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I have read the scope, terms and warranty and accept them for {money(t.price)}.</span>
        </label>
        <div className={s.signRow}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full name to sign" aria-label="Your full name" />
          <button className={s.acceptBtn} onClick={accept} disabled={!name.trim() || !agree || !c.email}>Accept and send</button>
        </div>
        <p className="small muted">
          {sent
            ? `Your email app opened with your acceptance addressed to ${c.email}. Press send to finish. Nothing is final until ${c.company} confirms.`
            : `Accepting opens an email to ${c.company} with your choice and signature. Questions first? Call ${c.phone || c.email}.`}
        </p>
        <button className="link" onClick={() => window.print()}>Print or save this proposal</button>
      </section>

      <footer className={s.foot}>Prepared with Tierscape</footer>
    </main>
  );
}

/** The plan for the homeowner: aerial, property line, work areas and plants. No measurements beyond area. */
function SharedPlan({ p }: { p: SharedProposal }) {
  const { plan } = p;
  const ext = plan.extent;
  const tiles = useMemo(() => (plan.origin && plan.zoom ? tilesForExtent(plan.origin, ext, plan.zoom) : []), [plan.origin, plan.zoom, ext]);
  const k = ext.w / 900;
  return (
    <figure className={s.plan}>
      <svg viewBox={`${ext.x} ${ext.y} ${ext.w} ${ext.h}`} role="img" aria-label="Plan of the work on the property">
        <rect x={ext.x} y={ext.y} width={ext.w} height={ext.h} fill="#a39d72" />
        {!plan.origin && <SampleLot />}
        {tiles.map((t) => <image key={`${t.z}/${t.x}/${t.y}`} href={`/api/imagery/${t.z}/${t.x}/${t.y}`} x={t.px} y={t.py} width={t.w + 0.05} height={t.h + 0.05} preserveAspectRatio="none" />)}
        {plan.lot && <polygon points={plan.lot.join(" ")} fill="none" stroke="#ffb020" strokeWidth={2.5 * k} strokeDasharray={`${10 * k} ${5 * k}`} />}
        {plan.areas.map((a, i) => {
          const c = centroid(a.pts);
          return (
            <g key={i}>
              <polygon points={a.pts.join(" ")} fill={AREA_TYPES[a.type].color} fillOpacity={0.5} stroke="#fff" strokeWidth={1.5 * k} />
              <text x={c[0]} y={c[1]} textAnchor="middle" fontSize={13 * k} fontWeight={600} fill="#fff" stroke="#111" strokeWidth={3 * k} paintOrder="stroke" fontFamily="Inter Tight, Arial, sans-serif">
                {AREA_TYPES[a.type].label} · {Math.round(sharedSqft(a.pts)).toLocaleString("en-US")} sq ft
              </text>
            </g>
          );
        })}
        {plan.plants.flatMap((pl, i) => pl.spots.map((sp, j) => <circle key={`${i}.${j}`} cx={sp[0]} cy={sp[1]} r={pl.kind === "tree" ? 4 : pl.kind === "shrub" ? 1.8 : 1} fill="#2f6b3f" stroke="#fff" strokeWidth={1 * k} />))}
      </svg>
      <figcaption className="small muted">The same areas are included in every option. The options differ in materials, plant sizes and finish.</figcaption>
    </figure>
  );
}
