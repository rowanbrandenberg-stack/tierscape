"use client";
import Link from "next/link";
import { useSettings } from "@/client/settingsStore";
import { proposalReadiness, readinessOpen, reviewValue, type ReadyItem } from "@/lib/readiness";
import s from "./Readiness.module.css";

/**
 * A short list of the starting details that would otherwise reach a homeowner:
 * placeholder company and license, the default crew cost and overhead, and
 * the starting warranty. Placeholders link to Settings; defaults that may be
 * right can be kept with one click, and that choice is remembered.
 */
export function Readiness({ compact = false }: { compact?: boolean }) {
  const { profile, pricing, setProfile } = useSettings();
  const items = proposalReadiness(profile, pricing);
  const open = readinessOpen(items);
  if (!open.length) return compact ? null : <p className={s.done} role="status">Company details, prices and warranty are your own. Ready to share.</p>;

  const keep = (i: ReadyItem) => setProfile({ reviewed: { ...(profile.reviewed ?? {}), [i.key]: reviewValue(i.key, profile, pricing) } });
  const fixes = open.filter((i) => i.state === "fix").length;

  return (
    <section className={s.box} aria-labelledby="ready-h">
      <div>
        <h3 id="ready-h" className={s.title}>Before you send a real proposal</h3>
        <p className="small">
          {fixes ? `${fixes} placeholder${fixes === 1 ? "" : "s"} to replace` : "Nothing to replace"}
          {open.length - fixes ? `, ${open.length - fixes} starting value${open.length - fixes === 1 ? "" : "s"} to check` : ""}. Printed and shared proposals show these to the homeowner.
        </p>
      </div>
      <ul className={s.list}>
        {open.map((i) => (
          <li key={i.key} data-state={i.state}>
            <span className={s.mark} aria-hidden="true">{i.state === "fix" ? "!" : "?"}</span>
            <span className={s.text}>
              <strong>{i.label}</strong>
              <span>{i.detail}</span>
            </span>
            <span className={s.actions}>
              <Link className="btn sm quiet" href={`/settings#${i.where}`}>{i.state === "fix" ? "Set it" : "Change"}</Link>
              {i.state === "review" && (
                <button className="btn sm" onClick={() => keep(i)}>{i.key === "claim" || i.key === "warranty" ? "It is true, keep it" : "Keep it"}</button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
