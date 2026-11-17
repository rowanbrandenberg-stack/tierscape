/**
 * Reads provider settings from the environment. Nothing here is required:
 * each missing key turns one feature into a clear "not configured" state.
 */
const env = (k: string) => (process.env[k] ?? "").trim();
const isProd = process.env.NODE_ENV === "production";

export const config = {
  imagery: {
    provider: (env("IMAGERY_PROVIDER") || "esri") as "esri" | "nearmap",
    arcgisKey: env("ARCGIS_API_KEY"),
    nearmapKey: env("NEARMAP_API_KEY"),
  },
  regridToken: env("REGRID_API_TOKEN"),
  anthropic: { key: env("ANTHROPIC_API_KEY"), model: env("ANTHROPIC_MODEL") },
  render: { provider: env("RENDER_PROVIDER") || "openai", openaiKey: env("OPENAI_API_KEY"), model: env("OPENAI_IMAGE_MODEL") || "gpt-image-1" },
  onecall: { provider: env("ONECALL_PROVIDER"), url: env("ONECALL_API_URL"), key: env("ONECALL_API_KEY") },
};

/**
 * Esri World Imagery answers without a key, but its terms expect an ArcGIS
 * account for real apps. Allow keyless use only while developing.
 */
export function imageryReady(): { ok: boolean; why?: string } {
  const c = config.imagery;
  if (c.provider === "nearmap") return c.nearmapKey ? { ok: true } : { ok: false, why: "Set NEARMAP_API_KEY to load Nearmap imagery." };
  if (c.arcgisKey || !isProd) return { ok: true };
  return { ok: false, why: "Set ARCGIS_API_KEY to load Esri imagery in production." };
}

export function features() {
  return {
    imagery: imageryReady(),
    claude: config.anthropic.key && config.anthropic.model ? { ok: true } : { ok: false, why: "Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL." },
    render: config.render.openaiKey ? { ok: true } : { ok: false, why: "Set OPENAI_API_KEY to generate photo renders." },
    onecall: config.onecall.provider ? { ok: true } : { ok: false, why: "No 811 integration yet. Tickets are prepared for you to submit." },
    regrid: config.regridToken ? { ok: true } : { ok: false, why: "Set REGRID_API_TOKEN for parcel lines outside Arizona." },
  };
}
export type Features = ReturnType<typeof features>;
