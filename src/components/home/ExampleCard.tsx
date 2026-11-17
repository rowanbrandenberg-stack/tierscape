"use client";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useJobs } from "@/client/jobsStore";
import { useSettings } from "@/client/settingsStore";
import { useMounted } from "@/client/useMounted";
import { AREA_TYPES } from "@/lib/catalog";
import { sampleJob } from "@/lib/jobs";
import { money, quote } from "@/lib/pricing";
import { TIERS } from "@/lib/types";
import { SampleLot } from "../plan/SampleLot";
import s from "./home.module.css";

/** A finished job beside the address box, so a first visit shows what comes out the other end. */
export function ExampleCard() {
  const router = useRouter();
  const save = useJobs((x) => x.save);
  const pricing = useSettings((x) => x.pricing);
  const mounted = useMounted();
  const job = useMemo(() => sampleJob(), []);
  const quotes = TIERS.map((t) => ({ ...t, q: quote(job, pricing, t.key) }));
  const plants = job.plants.reduce((n, p) => n + p.spots.length, 0);

  function open() {
    const j = sampleJob();
    save(j);
    router.push(`/jobs/${j.id}`);
  }

  return (
    <figure className={s.example} aria-label="Example finished job">
      <svg viewBox="0 0 160 105" className={s.exampleMap} role="img" aria-label="Sample backyard plan with a patio, lawn and planting bed">
        <SampleLot />
        {job.areas.map((a) => (
          <polygon key={a.id} points={a.pts.join(" ")} fill={AREA_TYPES[a.type].color} fillOpacity={0.45} stroke="#fff" strokeWidth={0.6} strokeDasharray="2 1" />
        ))}
        {job.plants.flatMap((p) => p.spots.map((sp, i) => <circle key={`${p.id}${i}`} cx={sp[0]} cy={sp[1]} r={p.kind === "tree" ? 3 : 1.4} fill="#2f6b3f" stroke="#fff" strokeWidth={0.4} />))}
      </svg>
      <figcaption className={s.exampleBody}>
        <div className="spread">
          <span className="label">Example output</span>
          <span className="small muted">{job.areas.length} areas · {plants} plants</span>
        </div>
        <div className={s.exampleTiers}>
          {quotes.map((t) => (
            <div key={t.key}>
              <span className="small muted">{t.name}</span>
              <strong className="num">{mounted ? money(t.q.price) : "…"}</strong>
              <span className="small muted">{mounted ? `${t.q.days} ${t.q.days === 1 ? "day" : "days"}` : ""}</span>
            </div>
          ))}
        </div>
        <p className="small muted">Measured plan, three priced options, a signable proposal, material list and crew build pack, all from one address.</p>
        <button type="button" className="link" onClick={open}>Open this example →</button>
      </figcaption>
    </figure>
  );
}
