"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./AppHeader.module.css";

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="12" width="16" height="4" rx="1" fill="currentColor" />
      <rect x="4" y="7" width="10" height="4" rx="1" fill="currentColor" opacity=".55" />
      <rect x="7" y="2" width="4" height="4" rx="1" fill="currentColor" opacity=".25" />
    </svg>
  );
}

export function AppHeader() {
  const path = usePathname();
  const on = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));
  return (
    <header className={s.wrap}>
      <div className={s.bar}>
        <Link href="/" className={s.brand} aria-label="Tierscape home">
          <Mark />
          <span>Tierscape</span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/" aria-current={on("/") ? "page" : undefined}>Jobs</Link>
          <Link href="/settings" aria-current={on("/settings") ? "page" : undefined}>Settings</Link>
        </nav>
      </div>
    </header>
  );
}
