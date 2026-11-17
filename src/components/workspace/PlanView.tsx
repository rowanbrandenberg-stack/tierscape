"use client";
import { finishDraft } from "@/client/actions";
import { PlanCanvas } from "../plan/PlanCanvas";
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
        <Toolbar onFinish={finishDraft} />
        <PlanCanvas />
        <p className="small muted">
          Ctrl or Cmd Z undoes, add Shift to redo. Ctrl C and V copy the selected area or plant. Delete removes it, Esc cancels a tool, Enter finishes a line.
          Plus and minus zoom, or hold Ctrl or Cmd and scroll. When zoomed in, drag empty ground or use the arrow keys to move.
        </p>
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
