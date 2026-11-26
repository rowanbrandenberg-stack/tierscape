/**
 * Reads provider settings from the environment. Nothing here is required:
 * each missing key turns one feature into a clear "not configured" state.
 */
const env = (k: string) => (process.env[k] ?? "").trim();
const isProd = process.env.NODE_ENV === "production";
const retiredImageModel = (m: string) => m === "gpt-image-1" || m === "dall-e-2" || m === "dall-e-3";

export const config = {
  imagery: {
    provider: (env("IMAGERY_PROVIDER") || "esri") as "esri" | "nearmap",
    arcgisKey: env("ARCGIS_API_KEY"),
    nearmapKey: env("NEARMAP_API_KEY"),
  },
  regridToken: env("REGRID_API_TOKEN"),
  // A Claude.ai subscription does not include API access: this needs a Claude Platform API key with billing.
  anthropic: { key: env("ANTHROPIC_API_KEY"), model: env("ANTHROPIC_MODEL") || "claude-opus-5-5" },
  // gpt-image-1 was shut down by OpenAI on 2026-10-23, so it is no longer a usable default.
  render: { provider: env("RENDER_PROVIDER") || "openai", openaiKey: env("OPENAI_API_KEY"), model: retiredImageModel(env("OPENAI_IMAGE_MODEL")) ? "gpt-image-2.6-sunburst" : env("OPENAI_IMAGE_MODEL") || "gpt-image-2.6-sunburst" },
  onecall: { provider: env("ONECALL_PROVIDER"), url: env("ONECALL_API_URL"), key: env("ONECALL_API_KEY") },
};

/**
 * Esri World Imagery answers without a key, but its terms expect an ArcGIS
 * account for real apps. Allow keyless use only while developing.
 */
export function imageryReady(): { ok: boolean; why?: string } {
  const c = config.imagery;
  if (c.provider === "nearmap") return c.nearmapKey ? { ok: true } : { ok: false, why: "Aerial imagery is not turned on yet." };
  if (c.arcgisKey || !isProd) return { ok: true };
  return { ok: false, why: "Aerial imagery is not turned on yet." };
}

export function features() {
  return {
    imagery: imageryReady(),
    claude: config.anthropic.key ? { ok: true } : { ok: false, why: "Not set up yet: needs an Anthropic API key (ANTHROPIC_API_KEY). A Claude subscription is not API access." },
    render: config.render.openaiKey ? { ok: true } : { ok: false, why: "Not set up yet: needs an OpenAI API key (OPENAI_API_KEY). Options show without pictures." },
    onecall: config.onecall.provider ? { ok: true } : { ok: false, why: "No 811 integration yet. Tickets are prepared for you to submit." },
    regrid: config.regridToken ? { ok: true } : { ok: false, why: "Coming soon. Outside Arizona, draw the property line by hand." },
  };
}
export type Features = ReturnType<typeof features>;
