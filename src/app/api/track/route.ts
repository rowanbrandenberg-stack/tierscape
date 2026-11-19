/**
 * Funnel events. Only the event name and a plan choice are accepted, so no
 * payment details or job contents can be recorded. Logged for now; written
 * to analytics_events once accounts are live.
 */
const NAMES = new Set(["pricing_view", "plan_select", "trial_start", "first_estimate", "checkout_start", "paid_conversion", "cancellation"]);
const PLANS = new Set(["starter", "pro", "team", "founding"]);
const CADENCES = new Set(["monthly", "annual"]);

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; plan?: string; cadence?: string };
  if (!b.name || !NAMES.has(b.name)) return new Response(null, { status: 204 });
  console.log(JSON.stringify({ track: b.name, plan: b.plan && PLANS.has(b.plan) ? b.plan : null, cadence: b.cadence && CADENCES.has(b.cadence) ? b.cadence : null, at: new Date().toISOString() }));
  return new Response(null, { status: 204 });
}
