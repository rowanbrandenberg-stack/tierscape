# Billing launch checklist

Billing stays in the Stripe sandbox until every item here is done and the flow has been reviewed.

## Built and tested (no keys needed)
- One plan catalog (`src/lib/billing/plans.ts`) feeds the pricing page, account center, checkout and access checks.
- Math is tested: annual equivalents $65.83, $124.17, $249.17; savings $158, $298, $598; founding saving $600; annual is exactly ten months.
- Billing rules (`src/lib/billing/core.ts`), tested against an in memory store:
  - Founding places: never over 10, even with checkouts racing; a repeat click reuses the hold; holds expire after 45 minutes or when Checkout expires; one redemption per company; confirmed only by a paid invoice; $0 invoices do not count as paid periods.
  - Webhooks: each event id applied once; older events that arrive late are ignored; unknown customers and unapproved prices are ignored; disputes and fraud warnings pause creation but keep viewing and export.
  - Trial: 14 days of Pro, no card, one per company, one active job, then read only with no charge.
  - Access follows verified subscription status: active, a grace period while past due, read only once unpaid or canceled.
  - Image allowance: reserve, then confirm on success or refund on failure; retries count once; parallel requests cannot pass the limit; annual plans reset monthly.
  - Plan changes: upgrades now with proration, downgrades and cancellation at period end, a warning before ending the founding price.
- Webhook signatures are verified (HMAC SHA256, five minute tolerance), tested.
- Database migration `supabase/migrations/0002_billing.sql`: roles (owner, billing admin, estimator, crew), subscriptions, processed events, founding places and usage with atomic SQL functions, analytics events. Crew cannot read prices.

## Needed before checkout can open
1. Supabase project. Run both migrations, then wire sign in, company creation and moving jobs from the browser into the database.
2. A Supabase version of the billing `Store` (the in memory one is the reference) using `hold_founding_place` and `reserve_usage`.
3. Stripe sandbox: Products Starter, Pro and Team, each with a monthly and an annual Price ($79/$790, $149/$1,490, $299/$2,990).
4. Founding coupon: $50 off, duration repeating, 12 months, limited to the Pro monthly Price. TierScape's own trial never creates a Stripe trial, so every discounted month is a paid month.
5. Webhook endpoint `/api/billing/webhook` with events: customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed, checkout.session.expired, charge.refunded, charge.dispute.created, charge.dispute.closed, radar.early_fraud_warning.created.
6. Customer Portal: allow payment method updates, invoice history, and cancellation at period end. Turn off plan switching in the portal so changes go through TierScape's preview first.
7. Put the keys in Vercel (see `.env.example`). Sandbox keys only.

## Tax
- Turn on Stripe Tax and add your origin address and product tax codes. Checkout already asks Stripe to calculate tax and shows it before payment.
- Register in each state where you have a tax obligation, then add those registrations in Stripe. Enabling Stripe Tax alone does not register you anywhere.
- Arizona: check whether SaaS is taxable for you under TPT before launch.

## Still to verify in the sandbox
- Monthly and annual amounts match on the page, in Checkout and in the account center.
- A trial ends with no charge.
- The founding discount lasts 12 paid periods and then renews at $149.
- The eleventh founding checkout is refused.
- Upgrade, downgrade, cancel and reactivate.
- A failed card shows a failed state, never success.
- Replaying a webhook does not double access or usage.
- One company cannot see another company's data, and crew cannot see costs.
