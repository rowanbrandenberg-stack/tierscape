# Tierscape

Plan a landscape job from an address. Tierscape finds the lot, draws the property
line, lets you trace the work to scale, prices it three ways, writes a branded
proposal the homeowner signs, hands the crew a build pack, and prepares the 811
locate request from the dig areas you drew.

## Run it

```bash
npm install
cp .env.example .env.local   # optional, every key is optional
npm run dev                  # http://localhost:3000
npm test                     # unit tests for the planning logic
npm run typecheck
```

Node 20 or newer.

## What works with no keys

| Feature | Source | Key |
| --- | --- | --- |
| Address lookup and county | US Census geocoder | none, free |
| Property line in Arizona | AZGeo statewide parcels (State of Arizona) | none, free |
| Aerial imagery | Esri World Imagery | none in development, `ARCGIS_API_KEY` in production |
| Pricing, proposal, build pack, 811 checklist | built in | none |

## Optional services

| Feature | Variables |
| --- | --- |
| Sharper imagery made for contractor measuring | `IMAGERY_PROVIDER=nearmap`, `NEARMAP_API_KEY` |
| Parcel lines outside Arizona | `REGRID_API_TOKEN` |
| Plant growth estimates for the job's climate, and finding where a site photo was taken | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Photoreal tier renders from the homeowner's photo | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` |
| Direct 811 submission | `ONECALL_PROVIDER`, `ONECALL_API_URL`, `ONECALL_API_KEY` |

Settings shows which of these are live.

**Imagery licensing.** Google satellite imagery cannot be used here: Google's
terms forbid tracing or digitizing outlines from it. Confirm that whichever
provider you choose allows tracing and measuring before you go live.

**811.** Arizona needs 2 full working days notice, marks stay valid 15 working
days, and only hand tools are allowed within 24 inches of a marked line
(Arizona Corporation Commission). Arizona 811 runs Exactix and does not publish
a public API, so direct submission needs an integration agreement with the
center. Until then Tierscape prepares the request: address, county, work type
and the dig areas as GeoJSON, which is the electronic white lining. The
landscaper stays the excavator of record and confirms every ticket.

## How it is built

```
src/lib        Planning logic. Pure, typed and unit tested.
  types.ts       Data model. Plan coordinates are feet: x east, y south.
  geometry.ts    Areas, distances, angle snapping, corner snapping.
  projection.ts  Lat/lon to plan feet, and map tiles placed in feet.
  catalog.ts     Default services, pavers, borders, plant sizes, APWA colors.
  pricing.ts     Quotes per tier: materials, labor, markup, installed prices.
  locate.ts      811 rules by state, conflicts, the locate request.
  camera.ts      Where a photo was taken and what it sees; render instructions.
src/server     Providers behind the API routes. Keys never reach the browser.
src/app        Pages and API routes (Next.js App Router).
src/components Interface. One global design system in app/globals.css,
               component styles in CSS modules.
src/client     Browser stores: settings, saved jobs, photos (IndexedDB),
               and the plan editor with undo history.
supabase       Schema for moving jobs and settings to accounts.
```

Jobs and settings are saved in the browser for now. The Supabase schema is the
next step for accounts and sharing between devices.
