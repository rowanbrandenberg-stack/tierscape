/**
 * Rerolling a render starts with what was wrong with the last one. Each
 * problem the contractor picks becomes a plain correction added to the
 * render instructions, and corrections pile up across rounds so a fixed
 * problem does not come back.
 */
export const FEEDBACK: { key: string; label: string; fix: string }[] = [
  { key: "house", label: "Changed the house or fence", fix: "Do not change the house, roof, windows, doors, fence or driveway. They must match the photo exactly." },
  { key: "placement", label: "Work in the wrong place", fix: "Put each planned area exactly where the instructions say it appears in the photo, at the stated size." },
  { key: "big", label: "Plants too big", fix: "The plants came out too large. Show them at their installed size or the local 10 year size given, whichever the instructions say." },
  { key: "small", label: "Plants too small", fix: "The plants came out too small. Show them at the sizes given in the instructions." },
  { key: "materials", label: "Wrong colors or materials", fix: "Match the materials, colors and patterns named in the instructions exactly." },
  { key: "extras", label: "Added things not in the plan", fix: "Remove anything not listed in the instructions: no extra plants, furniture, lights, decor or features." },
  { key: "missing", label: "Left something out", fix: "Every surface and plant listed in the instructions that is in frame must appear." },
  { key: "fake", label: "Looks fake", fix: "Make it photorealistic, like a real photo taken with a phone: natural textures, real shadows, no painterly or cartoon look." },
  { key: "light", label: "Wrong light or season", fix: "Keep the same time of day, lighting, weather and season as the original photo." },
];

export type RerollStart = "photo" | "render";

export function revisePrompt(base: string, picked: string[], other: string, start: RerollStart, earlier: string[] = []): { prompt: string; notes: string[] } {
  const fixes = FEEDBACK.filter((f) => picked.includes(f.key)).map((f) => f.fix);
  const extra = other.trim() ? [other.trim().replace(/\s+/g, " ")] : [];
  const notes = [...new Set([...earlier, ...fixes, ...extra])];
  const L = [base];
  if (start === "render") L.push("", "The attached image is the previous attempt. Keep everything in it that is right and change only what the corrections below call for.");
  if (notes.length) L.push("", "Corrections from earlier attempts. These override anything above:", ...notes.map((n) => `• ${n}`));
  return { prompt: L.join("\n"), notes };
}
