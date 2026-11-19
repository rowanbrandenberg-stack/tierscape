"use client";
import { PlanCanvas, PlanHint } from "../plan/PlanCanvas";
import { Toolbar } from "../plan/Toolbar";
import { SitePanel } from "../plan/panels/SitePanel";
import { LotPanel } from "../plan/panels/LotPanel";
import { LocatePanel } from "../plan/panels/LocatePanel";
import { AreasPanel } from "../plan/panels/AreasPanel";
import { PlantsPanel } from "../plan/panels/PlantsPanel";
import { PhotosPanel } from "../plan/panels/PhotosPanel";
import s from "./PlanView.module.css";

export function PlanView({ onNext }: { onNext: () => void }) {
  return (
    <div className={s.layout}>
      <div className={s.stage}>
        <Toolbar />
        <PlanHint />
        <PlanCanvas />
      </div>
      <aside className={s.inspector} aria-label="Plan details">
        <AreasPanel />
        <PlantsPanel />
        <PhotosPanel />
        <LotPanel />
        <LocatePanel />
        <SitePanel />
        <button className="btn solid" style={{ alignSelf: "flex-start" }} onClick={onNext}>
          Build the three tiers <span aria-hidden="true">→</span>
        </button>
      </aside>
    </div>
  );
}
