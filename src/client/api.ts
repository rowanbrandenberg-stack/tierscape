"use client";
import type { Site, UtilityType } from "@/lib/types";
import type { LocateRequest } from "@/lib/locate";
import { DETECT_PROMPT, estimatePrompt, LOCATE_PROMPT, normDetect, normEstimates, normLocate, normTrace, parseJsonReply, TRACE_PROMPT } from "@/lib/prompts";
import { askManually } from "./manualAi";

/** `manual` means no API key yet: the feature runs through the contractor's own Claude or ChatGPT. */
export type Feature = { ok: boolean; why?: string; manual?: boolean };
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

let featuresP: Promise<Features> | null = null;

/** Server features, with Claude and renders switched to manual mode when their keys are not set. */
function featuresOnce(): Promise<Features> {
  featuresP ??= call<Features>("/api/config")
    .then((f) => ({
      ...f,
      claude: f.claude.ok ? f.claude : { ok: true, manual: true, why: "Testing mode: runs in your own Claude." },
      render: f.render.ok ? f.render : { ok: true, manual: true, why: "Testing mode: runs in your own ChatGPT." },
    }))
    .catch((e) => {
      featuresP = null;
      throw e;
    });
  return featuresP;
}

const manualClaude = async () => !!(await featuresOnce().catch(() => null))?.claude.manual;
const manualRender = async () => !!(await featuresOnce().catch(() => null))?.render.manual;

/** Run a prompt in the contractor's own Claude and check the pasted reply parses into something usable. */
async function viaClaude<T>(title: string, prompt: string, files: { name: string; blob: Blob }[], norm: (raw: never) => T, usable: (t: T) => boolean): Promise<T> {
  const check = (text: string) => {
    try {
      return usable(norm(parseJsonReply<never>(text))) ? null : "That answer has nothing Tierscape can use. Make sure you pasted the whole reply.";
    } catch {
      return "That does not look like Claude's JSON answer. Copy the whole reply, including the braces.";
    }
  };
  const text = (await askManually({ target: "claude", title, prompt, files, answer: "json", check })) as string;
  return norm(parseJsonReply<never>(text));
}

const ext = (b: Blob) => (b.type.includes("png") ? "png" : b.type.includes("webp") ? "webp" : "jpg");

export const api = {
  features: () => featuresOnce(),
  suggestAddress: (q: string, near: { lat: number; lon: number } | null, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q });
    if (near) {
      p.set("lat", String(near.lat));
      p.set("lon", String(near.lon));
    }
    return call<{ suggestions: string[] }>(`/api/address/suggest?${p}`, { signal });
  },
  site: (address: string) => call<{ site: Site; notes: { parcel: string | null; imagery: string | null } }>("/api/site", post({ address })),
  parcelAt: (p: { lat: number; lon: number; county?: string | null }) =>
    call<{ parcel: { apn: string | null; address: string | null; ring: { lat: number; lon: number }[]; source: string } }>("/api/parcels/at", post(p)),
  publicUtilities: (p: { lat: number; lon: number; radiusM?: number }) =>
    call<{ features: { type: UtilityType; label: string; pts: { lat: number; lon: number }[]; overhead: boolean }[]; credit: string }>("/api/utilities/public", post(p)),
  detectUtilities: async (plan: Blob) => {
    if (await manualClaude()) return viaClaude("Find utility clues on the aerial", DETECT_PROMPT, [{ name: "tierscape-aerial.png", blob: plan }], normDetect, () => true);
    const fd = new FormData();
    fd.set("plan", new File([plan], "plan.png", { type: "image/png" }));
    return call<{ clues: { type: UtilityType; xPct: number; yPct: number; label: string }[]; routes: { type: UtilityType; pts: [number, number][]; label: string }[] }>("/api/utilities/detect", { method: "POST", body: fd });
  },
  traceMarks: async (plan: Blob, photo: Blob) => {
    if (await manualClaude())
      return viaClaude("Trace locator paint", TRACE_PROMPT, [{ name: "1-tierscape-plan.png", blob: plan }, { name: `2-paint-photo.${ext(photo)}`, blob: photo }], normTrace, () => true);
    const fd = new FormData();
    fd.set("plan", new File([plan], "plan.png", { type: "image/png" }));
    fd.set("photo", new File([photo], "photo", { type: photo.type || "image/jpeg" }));
    return call<{ marks: { type: UtilityType; pts: [number, number][]; confidence: string }[]; note: string }>("/api/utilities/trace", { method: "POST", body: fd });
  },
  estimate: async (location: string, plants: { name: string; kind: string }[]) => {
    if (await manualClaude()) return { estimates: await viaClaude("Estimate plant growth", estimatePrompt(location, plants), [], normEstimates, (x) => x.length > 0) };
    return call<{ estimates: { name: string; height_ft: number; spread_ft: number; note: string }[] }>("/api/plants/estimate", post({ location, plants }));
  },
  locatePhoto: async (plan: Blob, photo: Blob) => {
    if (await manualClaude()) {
      const r = await viaClaude("Find where the photo was taken", LOCATE_PROMPT, [{ name: "1-tierscape-plan.png", blob: plan }, { name: `2-site-photo.${ext(photo)}`, blob: photo }], (x: Parameters<typeof normLocate>[0]) => normLocate(x), (x) => !!x);
      return r!;
    }
    const fd = new FormData();
    fd.set("plan", new File([plan], "plan.png", { type: "image/png" }));
    fd.set("photo", new File([photo], "photo", { type: photo.type || "image/jpeg" }));
    return call<{ xPct: number; yPct: number; facingDeg: number; confidence: string; reason: string }>("/api/photos/locate", { method: "POST", body: fd });
  },
  render: async (photo: Blob, prompt: string) => {
    if (await manualRender()) {
      const img = (await askManually({
        target: "chatgpt",
        title: "Render this tier",
        prompt: `Edit the attached photo of this yard. Keep the house, fences, trees and everything else that is not listed below exactly as it is, from the same camera angle, photorealistic.\n\n${prompt}`,
        files: [{ name: `tierscape-yard.${ext(photo)}`, blob: photo }],
        answer: "image",
      })) as Blob;
      const dataUrl = await new Promise<string>((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => no(r.error);
        r.readAsDataURL(img);
      });
      return { dataUrl };
    }
    const fd = new FormData();
    fd.set("photo", new File([photo], "site.png", { type: photo.type || "image/png" }));
    fd.set("prompt", prompt);
    return call<{ dataUrl: string }>("/api/render", { method: "POST", body: fd });
  },
  requestLocate: (req: LocateRequest) =>
    call<{ mode: "submitted"; ticket: string; provider: string } | { mode: "prepared"; center: string; website: string | null; checklist: string[] }>("/api/locate", post(req)),
};
