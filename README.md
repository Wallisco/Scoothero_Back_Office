# ScootHero Back Office · Property module · Phase 1 starter

Drop this into the `portal.scoothero.co.za` repo. It gives you the database, the spreadsheet import and the cost calculations. The screens (menu, New site form, Setup lists) are built on top of this.

Full spec: ScootHero Back Office · Property Module Build Spec (v1.2).

## Building with Claude Code

`CLAUDE.md` (repo root) holds the rules Claude Code follows on every task. `docs/claude-code-playbook.md` has the prompts, one session per step, from fitting this starter into the portal through to the dashboard. `deploy/` sets up the HostyAfrica VPS and deploys from GitHub: `server-setup.sh` (one-time), `deploy.sh` (each release, with health check and rollback), `nginx.conf`, `backup.sh`. `.github/workflows/deploy.yml` tests every push and deploys `main`.

## What's here

| Path | What it does |
|---|---|
| `db/migrations/002_quotes_and_station.sql` | Station model (1.80 × 1.05 × 0.85 m, 9 bays, 50 A single / 25 A three phase), renders, contractors, quote requests, and the 9 standard electrical line items. |
| `src/property/render.js` + `assets/swap-station.png` | Places the station at true size on a site photo from a bay-width or known-height reference. `node scripts/render-demo.js` writes a sample. |
| `db/migrations/001_property_core.sql` | Tables for staff and roles, cities and areas, landlords and contacts, sites, notes, photos, site financials, cost defaults, audit log. Workflow stages as an enum (Live before COC). |
| `src/property/financials.js` | The one place site costs are calculated. Lease + install spread over tenure + hardware + electricity; margin; break-even. |
| `test/financials.test.js` | Checks the formulas against real rows from the sheet (Waterstone, 21 Oudekraal, Pineslopes). |
| `scripts/import-property-sheet.js` | Imports the Property sheet CSV. Splits multi-site rows, fixes spelling, pairs contacts with emails, flags what needs a human. Dry run by default. |
| `scripts/financials-report.js` | Recalculates every site with a lease amount and writes a CSV. |
| `src/styles/typography.css` | Font and size tokens for every screen: Inter, 14px body, 12px meta, 16px cards and nav, 18–20px sections, 24px titles; 16px inputs and 44px tap targets on phones. |
| `src/lib/esign/index.js` | The e-signature interface (SignEasy or QuicklySign behind the same four calls). Implemented in Phase 3. |

## Run it

```bash
npm install pg csv-parse sharp

# 1. Database
psql "$DATABASE_URL" -f db/migrations/001_property_core.sql
psql "$DATABASE_URL" -f db/migrations/002_quotes_and_station.sql

# 2. Tests
node --test test/*.test.js

# 3. Import: dry run first, check data/import-review.csv, then commit
node scripts/import-property-sheet.js data/property-sheet.csv
node scripts/import-property-sheet.js data/property-sheet.csv --commit

# 4. Financials check
node scripts/financials-report.js
```

The import is safe to run again after you fix the spreadsheet. It updates matching sites instead of duplicating them.

Tested against Postgres 16: 95 sites, 56 landlords, 66 contacts, 17 cities, 2 PSALs (Shaka, Aziz). A second run changed nothing.

## Company defaults (Setup → Cost assumptions)

| Setting | Default |
|---|---|
| Lease tenure | 24 months |
| Install cost estimate | R11,200 (until a quote is accepted) |
| Electricity rate | R4.60/kWh (installation team sets the real rate per site) |
| Selling price | R11.50/kWh |
| Hardware | R1,824/month |
| Bikes / km per day | 8 bikes, 120 km |
| Battery / range | 3,240 Wh, 72 km → 0.045 kWh/km |
| Charging efficiency | 100% (confirm from charger spec) |
| Target margin | 30% (drives "most a PSAL can offer") |
| Days per month | 30.44 |

The same formulas are in `ScootHero_CRM_Site_List_corrected.xlsx`, so the spreadsheet and the app agree to the cent.

## Next: Phase 1 screens (prompt for Claude Code)

> Read `docs/property-spec.md` and this README. Using server.js, its sessions and Postgres pool (follow docs/claude-code-playbook.md for the full order):
> 0. Import `src/styles/typography.css` in the main layout and use its tokens for every font size (spec section 2a). No hard-coded px font sizes.
> 1. Add a `staff_roles` check middleware (`requireRole(...roles)`) and link `staff.portal_user_id` to the current user table.
> 2. Add the module switcher and the Property left menu from spec section 4, with live counts per stage.
> 3. Build **All sites** (search, stage filter, needs-review filter) and the **site page** (details, contacts, notes, financials from `calculateSiteFinancials`, "Estimated" and "Default rate" badges).
> 4. Build the mobile **New site** form: auto first-touch timestamp, GPS pin with accuracy, dropdowns with add-new for PSAL, city, area, landlord and contact (contact filtered by landlord), photo upload through src/lib/storage.
> 5. Build **Setup**: team and roles, cities and areas, landlords and contacts, cost assumptions.
> 6. Build a **Needs review** list from `sites.needs_review`, with a "resolved" action that clears an item and writes to `audit_log`.
> Every write goes through `audit_log`. Server-side role checks on every route.
