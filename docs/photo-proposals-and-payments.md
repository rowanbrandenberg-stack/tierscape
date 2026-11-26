# Photo proposals and client payments

Two ways into a job, one proposal at the end:

1. **From a photo.** The contractor adds the client's yard photo and what they asked for. Claude drafts affordable, standard and premium options (scope, inclusions, exclusions, limitations, line items, crew steps, a concept picture brief). The contractor reviews and edits, then publishes.
2. **From an address.** The existing aerial planner, unchanged: measured areas, plants, three tiers.

Both produce the same `PublicProposal` snapshot (`src/lib/proposal.ts`), the same share link, acceptance and payments.

## What decides a price

- `src/lib/estimate.ts` does all arithmetic: quantity = measurement × rate (× waste, for materials only), labor hours × crew cost, then overhead, then markup, rounded to $10.
- The model suggests lines. A line that matches the contractor's rate book (Settings → Estimating rules) takes the contractor's cost, and their quantity rule if set. Anything else stays marked **Suggested, check it** until the contractor confirms it.
- A size estimated from a photo is never a measurement. Unconfirmed sizes or lines make the price **preliminary**; publishing then needs the contractor to tick that they are sending a preliminary price, and the homeowner page says so.
- On publish the server prices the job again from the job and settings stored in the database, never from numbers sent by the browser.

## How a total is explained

- Each option's total is split into work packages at customer prices (site preparation, materials supplied — "and delivered" only when a delivery line exists — installation, haul away and cleanup), built from that job's own lines. Packages with nothing in them are left out. The parts always add up to the total (largest remainder split, whole dollars when the total is whole dollars). Plan jobs split by work area.
- Supplier costs, wages, hours, waste, margin and notes never leave the contractor side. `findPrivateKeys` is tested against every public payload.
- **Ways to save** are scope changes the contractor sets up (smaller area, a different material at its own cost, moving lines to a later phase). Each is repriced with the same arithmetic; only real savings are kept, and only ones the contractor ticks are shown. The homeowner can ask about one; any change is confirmed in a new proposal version.

## AI calls

- Claude (`src/server/anthropic.ts`, official SDK) with structured output validated by zod, adaptive thinking, and the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).
- Concept pictures: OpenAI `POST /v1/images/edits` with the original photo and instructions that keep the viewpoint, house and surroundings. Labelled "Concept image" everywhere.
- Every call is a durable row in `ai_generations` keyed by a client request key: repeat clicks reuse it, failed runs retry up to 3 times, runs that die are marked failed after 6 minutes, and the browser resumes polling after a reload.
- Cost controls: signed in office users with a plan or trial that includes three option proposals; drafts capped per company per day (`AI_DRAFTS_PER_DAY`); concept pictures count against the plan's image allowance (reserved, then confirmed or refunded). The planner's `/api/render` and the older Claude routes now require a signed in company too.
- With keys missing, `/api/ai/status` lists exactly what is missing and the buttons stay off.

## Photos

Original photos and renders live in the private `job-assets` Storage bucket, checked by file signature, and are read only through `/api/jobs/[id]/assets/[assetId]` (company members) or `/api/public/p/[token]/image/...` (only files the published version includes).

## Homeowner side

`/p/[token]`: mobile first, no account. Token is 32 random bytes; only its SHA-256 is stored; making a new link or turning sharing off revokes the old one. The homeowner picks an option, signs the exact version on screen (`proposalId` + snapshot hash; a stale version is refused), and pays. Published versions and acceptances are immutable (database triggers). A job with an accepted proposal cannot be republished.

## Payments (Stripe Connect)

- Contractors connect their own Stripe account: Accounts v2, `dashboard: "full"`, Stripe collects fees and covers losses, onboarding through a v2 Account Link. This is Stripe's documented setup for SaaS platforms using direct charges.
- Deposit and balance are Checkout Sessions created as **direct charges** on the contractor's account (`Stripe-Account` header). Amounts come from the acceptance row; the browser only says "deposit" or "balance". One live session per amount (unique index); repeat clicks reuse it.
- Only signed Connect webhooks change payment status. A redirect back from Checkout only starts polling. Every transition is guarded by status and event time, and the event id is recorded only after the change is saved, so a retry after a crash is applied and a replay is a no-op. A wrong amount, account or payment id, or a second payment for an amount already paid, is flagged for review (and refund), never counted.
- Before an expiring session is replaced, it is expired at Stripe; if Stripe says it was already paid, no new session is made.
- The database enforces the agreement: an acceptance is refused unless its version is the current, unexpired, published one with the same hash (row locked), a job with an accepted version cannot get a new one, and published versions and acceptances cannot be edited or moved backwards.
- The balance opens when the contractor marks the work done.
- Platform fee: **off and zero by default**. No rate has been chosen. It is never taken in live mode without `PLATFORM_FEE_ALLOW_LIVE=1` and never added to what the client pays. Stripe's processing fee is separate and charged to the contractor's account by Stripe.

## Setup before this can run

1. Apply `supabase/migrations/0004_photo_proposals_and_payments.sql` (additive; creates the private `job-assets` bucket).
2. `ANTHROPIC_API_KEY` (Claude Platform API key with billing). Optional `OPENAI_API_KEY` for concept pictures.
3. Stripe sandbox: enable Connect with Accounts v2 on the platform account. Add a webhook endpoint for **events on connected accounts** at `/api/payments/webhook` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`; put its secret in `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. Sandbox keys only until the flow is reviewed.

## Still to verify in the sandbox

- Draft quality on real photos, including the paver example (existing play sand, no base).
- A test contractor completing onboarding; `card_payments` turning active.
- Deposit with card 4242…, a declined card, a delayed bank payment, an expired session, a refund, and replaying each webhook.
- Balance after "the work is done".

## Deferred

- Feedback learning loops (using accepted, edited and lost proposals to improve drafts).
- Accepting a "way to save" directly; today it becomes a change request and a new version.
- v2 thin events for account readiness (readiness is read from Stripe on demand and every 10 minutes).
- Cancelling an accepted agreement, and partial payment schedules beyond deposit and balance.
