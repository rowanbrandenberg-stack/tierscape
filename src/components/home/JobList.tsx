"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJobs } from "@/client/jobsStore";
import { useMounted } from "@/client/useMounted";
import { useSettings } from "@/client/settingsStore";
import { sampleJob } from "@/lib/jobs";
import { money, quote } from "@/lib/pricing";
import s from "./home.module.css";

export function JobList() {
  const mounted = useMounted();
  const router = useRouter();
  const { jobs, save, remove } = useJobs();
  const pricing = useSettings((x) => x.pricing);
  const list = Object.values(jobs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  function openSample() {
    const j = sampleJob();
    save(j);
    router.push(`/jobs/${j.id}`);
  }

  return (
    <section className={s.jobs} aria-labelledby="jobs-h">
      <div className="spread">
        <h2 id="jobs-h" className="title">Jobs</h2>
        <button className="link" onClick={openSample}>Open a sample job →</button>
      </div>
      {!mounted ? null : list.length === 0 ? (
        <div className={s.empty}>
          <p className="head">No jobs yet.</p>
          <p className="muted">Enter an address above to start one, or open the sample job to look around first.</p>
        </div>
      ) : (
        <ul className={s.grid}>
          {list.map((j) => {
            const q = quote(j, pricing, "standard");
            return (
              <li key={j.id} className={s.card}>
                <Link href={`/jobs/${j.id}`} className={s.cardLink}>
                  <span className="label">{j.sample ? "Sample" : j.site.county ? `${j.site.county} County, ${j.site.state}` : j.site.state ?? "Job"}</span>
                  <span className={s.cardTitle}>{j.name}</span>
                  <span className={s.cardMeta}>
                    <span>{j.areas.length} {j.areas.length === 1 ? "area" : "areas"}</span>
                    <span className="num">{j.areas.length ? `${money(q.price)} standard` : "Not measured"}</span>
                  </span>
                </Link>
                <button className={s.del} onClick={() => remove(j.id)} aria-label={`Delete ${j.name}`}>Delete</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
