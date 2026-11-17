"use client";
import { useEditor } from "@/client/editor";
import { Panel } from "../../ui/Panel";
import s from "./panels.module.css";

export function SitePanel() {
  const ed = useEditor();
  const job = ed.job!;
  const site = job.site;
  return (
    <Panel title="Site" id="site-h">
      <dl className={s.facts}>
        <dt>Address</dt>
        <dd>{site.matchedAddress ?? site.address}</dd>
        {site.county && (
          <>
            <dt>County</dt>
            <dd>{site.county} County, {site.state}</dd>
          </>
        )}
        {site.parcel?.apn && (
          <>
            <dt>Parcel</dt>
            <dd className="num">{site.parcel.apn}</dd>
          </>
        )}
        <dt>Aerial</dt>
        <dd>{job.sample ? "Sample drawing" : site.imagery ? site.imagery.provider : "Not configured. Trace from your own measurements."}</dd>
      </dl>
      <label className="row small" style={{ "--gap": "8px" } as React.CSSProperties}>
        <input type="checkbox" checked={ed.colorAerial} onChange={(e) => ed.set({ colorAerial: e.target.checked })} />
        Show the aerial in color
      </label>
    </Panel>
  );
}
