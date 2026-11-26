"use client";
import { useMounted } from "@/client/useMounted";
import { ProfileSettings } from "./ProfileSettings";
import { PriceBook } from "./PriceBook";
import { Connections } from "./Connections";
import { EstimatingRules } from "./EstimatingRules";
import { PaymentsSettings } from "./PaymentsSettings";
import { Readiness } from "../proposal/Readiness";
import s from "./settings.module.css";

export function SettingsView() {
  const mounted = useMounted();
  return (
    <main className="page">
      <header className={s.top}>
        <p className="label">Settings</p>
        <h1 className="title">Your company, your prices.</h1>
      </header>
      {mounted && (
        <div className={s.sections}>
          <Readiness />
          <ProfileSettings />
          <PriceBook />
          <EstimatingRules />
          <PaymentsSettings />
          <Connections />
        </div>
      )}
    </main>
  );
}
