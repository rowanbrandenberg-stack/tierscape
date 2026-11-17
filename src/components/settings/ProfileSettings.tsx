"use client";
import { useSettings } from "@/client/settingsStore";
import type { Profile } from "@/lib/settings";
import s from "./settings.module.css";

const FIELDS: { key: keyof Profile; label: string; mono?: boolean }[] = [
  { key: "company", label: "Company name" },
  { key: "license", label: "Contractor license number" },
  { key: "licenseLine", label: "License line" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
];

export function ProfileSettings() {
  const { profile, setProfile } = useSettings();
  const initials = profile.company.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function logo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setProfile({ logo: String(r.result) });
    r.readAsDataURL(f);
  }

  return (
    <section className={s.section} aria-labelledby="profile-h">
      <div className={s.aside}>
        <h2 id="profile-h" className="head">Profile</h2>
        <p className="small muted">Your name, license, logo and colors go on every proposal.</p>
      </div>
      <div className={s.content}>
        <div className={s.grid}>
          {FIELDS.map((f) => (
            <div key={f.key} className="field">
              <label className="label" htmlFor={`p-${f.key}`}>{f.label}</label>
              <input id={`p-${f.key}`} className="input" value={String(profile[f.key] ?? "")} onChange={(e) => setProfile({ [f.key]: e.target.value } as Partial<Profile>)} />
            </div>
          ))}
          <div className="field">
            <label className="label" htmlFor="p-brand">Brand color</label>
            <div className="row"><input id="p-brand" type="color" className={s.color} value={profile.brandColor} onChange={(e) => setProfile({ brandColor: e.target.value })} /><span className="num small">{profile.brandColor}</span></div>
          </div>
          <div className="field">
            <label className="label" htmlFor="p-accent">Accent color</label>
            <div className="row"><input id="p-accent" type="color" className={s.color} value={profile.accentColor} onChange={(e) => setProfile({ accentColor: e.target.value })} /><span className="num small">{profile.accentColor}</span></div>
          </div>
          <div className="field">
            <span className="label">Logo</span>
            <div className="row">
              <label className="btn sm quiet" htmlFor="p-logo">Upload logo</label>
              <input id="p-logo" type="file" accept="image/*" hidden onChange={logo} />
              {profile.logo && <button className="link" onClick={() => setProfile({ logo: null })}>Remove</button>}
            </div>
          </div>
        </div>
        <div className={s.preview} style={{ borderColor: profile.brandColor }}>
          {profile.logo ? <img src={profile.logo} alt="" /> : <span className={s.mono} style={{ background: profile.brandColor }}>{initials}</span>}
          <div style={{ minWidth: 0 }}>
            <div className={s.company}>{profile.company}</div>
            <div className="small muted">{[profile.licenseLine, profile.license].filter(Boolean).join(" · ")}</div>
          </div>
          <span className={s.pill} style={{ background: profile.accentColor }}>Standard plan</span>
        </div>
      </div>
    </section>
  );
}
