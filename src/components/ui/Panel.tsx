import s from "./Panel.module.css";

/**
 * An inspector section. `collapsible` panels start folded unless `defaultOpen`,
 * so optional details stay one tap away without crowding the plan.
 */
export function Panel({ title, aside, children, id, collapsible = false, defaultOpen = true, hint }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string; collapsible?: boolean; defaultOpen?: boolean; hint?: string }) {
  if (collapsible)
    return (
      <details className={`${s.panel} ${s.fold}`} open={defaultOpen} aria-labelledby={id}>
        <summary className={s.head}>
          <span className={s.summary}>
            <span id={id} className={s.title}>{title}</span>
            {hint && <span className={s.hint}>{hint}</span>}
          </span>
          {aside}
        </summary>
        {children}
      </details>
    );
  return (
    <section className={s.panel} aria-labelledby={id}>
      <header className={s.head}>
        <h3 id={id} className={s.title}>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}
