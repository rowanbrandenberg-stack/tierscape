"use client";
/** Funnel events: names and plan choices only. */
export function track(name: "pricing_view" | "plan_select" | "trial_start" | "first_estimate" | "checkout_start" | "paid_conversion" | "cancellation", extra: { plan?: string; cadence?: string } = {}) {
  try {
    const body = JSON.stringify({ name, ...extra });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    else void fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  } catch {}
}
