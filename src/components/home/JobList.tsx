"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJobs } from "@/client/jobsStore";
import { useMounted } from "@/client/useMounted";
import { useSettings } from "@/client/settingsStore";
import { sampleJob } from "@/lib/jobs";
import { money } from "@/lib/pricing";
import { isPhotoJob, jobOptions } from "@/lib/proposal";
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
            const photo = isPhotoJob(j);
            const std = jobOptions(j, pricing).find((o) => o.tier === "standard");
            const measured = photo ? (j.concept?.options.length ?? 0) > 0 : j.areas.length > 0;
            return (
              <li key={j.id} className={s.card}>
                <Link href={`/jobs/${j.id}`} className={s.cardLink}>
                  <span className="label">{j.sample ? "Sample" : photo ? "From a photo" : j.site.county ? `${j.site.county} County, ${j.site.state}` : j.site.state ?? "Job"}</span>
                  <span className={s.cardTitle}>{j.name}</span>
                  <span className={s.cardMeta}>
                    <span>{photo ? (j.concept?.request ?? "").slice(0, 40) : `${j.areas.length} ${j.areas.length === 1 ? "area" : "areas"}`}</span>
                    <span className="num">{measured && std ? `${money(std.price)} standard` : photo ? "Not drafted" : "Not measured"}</span>
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
