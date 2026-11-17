import s from "./Panel.module.css";

export function Panel({ title, aside, children, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string }) {
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
