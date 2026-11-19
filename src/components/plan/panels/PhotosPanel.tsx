"use client";
import { useState } from "react";
import { api, ApiError } from "@/client/api";
import { ManualCancelled } from "@/client/manualAi";
import { useEditor } from "@/client/editor";
import { putPhoto, deletePhoto } from "@/client/photoStore";
import { planImage } from "@/client/planImage";
import { useFeatures } from "@/client/useFeatures";
import { useSettings } from "@/client/settingsStore";
import { bearingToAngle, cameraSummary } from "@/lib/camera";
import { yardIllustration } from "@/lib/illustration";
import { uid } from "@/lib/jobs";
import type { SitePhoto } from "@/lib/types";
import { Panel } from "../../ui/Panel";
import s from "./panels.module.css";

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(f);
  });

/** Ground photos of the yard, each tied to where on the plan it was taken from. */
export function PhotosPanel() {
  const ed = useEditor();
  const features = useFeatures();
  const job = ed.job!;
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function add(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const id = uid("photo");
    await putPhoto(id, f).catch(() => undefined);
    const dataUrl = await readAsDataUrl(f);
    ed.commit((j) => {
      j.photos.push({ id, name: f.name, dataUrl, camera: null, placedBy: null, note: "" });
      j.activePhotoId = id;
    });
  }

  async function locate(p: SitePhoto) {
    if (!p.dataUrl) return;
    setBusy(p.id);
    setErrors((x) => ({ ...x, [p.id]: "" }));
    try {
      const sample = job.sample ? document.querySelector("[data-sample-lot]")?.outerHTML ?? null : null;
      const plan = await planImage(job, sample ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 105">${sample}</svg>` : null);
      const photo = await (await fetch(p.dataUrl)).blob();
      const r = await api.locatePhoto(plan, photo);
      const ext = job.site.extent;
      ed.commit((j) => {
        const ph = j.photos.find((x) => x.id === p.id)!;
        ph.camera = { x: ext.x + (r.xPct / 100) * ext.w, y: ext.y + (r.yPct / 100) * ext.h, angle: bearingToAngle(r.facingDeg) };
        ph.placedBy = "claude";
        ph.note = `${r.confidence} confidence. ${r.reason}`;
        j.activePhotoId = p.id;
      });
    } catch (e) {
      if (e instanceof ManualCancelled) return;
      setErrors((x) => ({ ...x, [p.id]: e instanceof ApiError ? e.message : "Could not place this photo. Mark the spot on the plan instead." }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Site photos" id="photos-h">
      <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
        {job.photos.map((p) => (
          <div key={p.id} className={s.photo} data-active={p.id === job.activePhotoId}>
            <button className={s.thumb} onClick={() => ed.commit((j) => void (j.activePhotoId = p.id))} aria-label={`Use ${p.name}`}>
              {p.dataUrl ? <img src={p.dataUrl} alt="" /> : <SampleThumb />}
            </button>
            <div className="stack" style={{ "--gap": "8px", minWidth: 0, flex: 1 } as React.CSSProperties}>
              <p className="small">{p.camera ? cameraSummary(job, p.camera) : "Not placed on the plan yet."}</p>
              {p.placedBy === "claude" && p.note && <p className="small muted">Matched by Claude: {p.note}</p>}
              {p.placedBy === "sample" && <p className="small muted">Sample photo.</p>}
              {errors[p.id] && <p className="warn">{errors[p.id]}</p>}
              <div className="row" style={{ "--gap": "6px" } as React.CSSProperties}>
                {p.dataUrl && features?.claude.ok && (
                  <button className="btn sm solid" onClick={() => locate(p)} disabled={!!busy}>{busy === p.id ? "Finding" : "Find where it was taken"}</button>
                )}
                <button className="btn sm quiet" onClick={() => { ed.commit((j) => void (j.activePhotoId = p.id)); ed.set({ tool: "camera", draft: [], selection: null, placingPlantId: null }); }}>
                  {p.camera ? "Adjust on plan" : "Mark on plan"}
                </button>
                {p.placedBy !== "sample" && (
                  <button className="btn sm quiet" onClick={() => { deletePhoto(p.id).catch(() => undefined); ed.commit((j) => { j.photos = j.photos.filter((x) => x.id !== p.id); if (j.activePhotoId === p.id) j.activePhotoId = j.photos[0]?.id ?? null; }); }}>Remove</button>
                )}
              </div>
            </div>
          </div>
        ))}
        <div>
          <label className="btn sm" htmlFor="photo-in">Add a photo</label>
          <input id="photo-in" type="file" accept="image/*" hidden onChange={add} />
        </div>
        <p className="small muted">The selected photo is what the tier renders are made from. Its spot and direction tell the image model where each planned area lands in the frame.</p>
      </div>
    </Panel>
  );
}

function SampleThumb() {
  const job = useEditor((x) => x.job!);
  const pricing = useSettings((x) => x.pricing);
  return <span dangerouslySetInnerHTML={{ __html: yardIllustration({ ...job, areas: [] }, pricing, "before") }} style={{ display: "block", width: "100%", height: "100%" }} />;
}
