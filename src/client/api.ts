"use client";
import type { Site, UtilityType } from "@/lib/types";
import type { LocateRequest } from "@/lib/locate";

export type Feature = { ok: boolean; why?: string };
export type Features = Record<"imagery" | "claude" | "render" | "onecall" | "regrid", Feature>;

export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init).catch(() => null);
  if (!r) throw new ApiError("Could not reach Tierscape. Check your connection.", "network");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((j as { message?: string }).message ?? "Something went wrong.", (j as { error?: string }).error ?? "error");
  return j as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  features: () => call<Features>("/api/config"),
  suggestAddress: (q: string, near: { lat: number; lon: number } | null, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q });
    if (near) {
      p.set("lat", String(near.lat));
      p.set("lon", String(near.lon));
    }
    return call<{ suggestions: string[] }>(`/api/address/suggest?${p}`, { signal });
  },
  site: (address: string) => call<{ site: Site; notes: { parcel: string | null; imagery: string | null } }>("/api/site", post({ address })),
  parcelAt: (p: { lat: number; lon: number }) =>
    call<{ parcel: { apn: string | null; address: string | null; ring: { lat: number; lon: number }[]; source: string } }>("/api/parcels/at", post(p)),
  publicUtilities: (p: { lat: number; lon: number; radiusM?: number }) =>
    call<{ features: { type: UtilityType; label: string; pts: { lat: number; lon: number }[]; overhead: boolean }[]; credit: string }>("/api/utilities/public", post(p)),
  detectUtilities: (plan: Blob) => {
    const fd = new FormData();
    fd.set("plan", new File([plan], "plan.png", { type: "image/png" }));
    return call<{ clues: { type: UtilityType; xPct: number; yPct: number; label: string }[]; routes: { type: UtilityType; pts: [number, number][]; label: string }[] }>("/api/utilities/detect", { method: "POST", body: fd });
  },
  traceMarks: (plan: Blob, photo: Blob) => {
    const fd = new FormData();
    fd.set("plan", new File([plan], "plan.png", { type: "image/png" }));
    fd.set("photo", new File([photo], "photo", { type: photo.type || "image/jpeg" }));
    return call<{ marks: { type: UtilityType; pts: [number, number][]; confidence: string }[]; note: string }>("/api/utilities/trace", { method: "POST", body: fd });
  },
  estimate: (location: string, plants: { name: string; kind: string }[]) =>
    call<{ estimates: { name: string; height_ft: number; spread_ft: number; note: string }[] }>("/api/plants/estimate", post({ location, plants })),
  locatePhoto: (plan: Blob, photo: Blob) => {
    const fd = new FormData();
    fd.set("plan", new File([plan], "plan.png", { type: "image/png" }));
    fd.set("photo", new File([photo], "photo", { type: photo.type || "image/jpeg" }));
    return call<{ xPct: number; yPct: number; facingDeg: number; confidence: string; reason: string }>("/api/photos/locate", { method: "POST", body: fd });
  },
  render: (photo: Blob, prompt: string) => {
    const fd = new FormData();
    fd.set("photo", new File([photo], "site.png", { type: photo.type || "image/png" }));
    fd.set("prompt", prompt);
    return call<{ dataUrl: string }>("/api/render", { method: "POST", body: fd });
  },
  requestLocate: (req: LocateRequest) =>
    call<{ mode: "submitted"; ticket: string; provider: string } | { mode: "prepared"; center: string; website: string | null; checklist: string[] }>("/api/locate", post(req)),
};
