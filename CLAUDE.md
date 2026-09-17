ScootHero Back Office — instructions for Claude Code
Read this before every task. The full product spec is `docs/property-spec.md`; the step-by-step build prompts are `docs/claude-code-playbook.md`.
What this is
ScootHero's back office: one system, one Postgres database, one login, with modules (Property first; Bike Sales, Deployments, Drivers, After Sales, Billing, Finance, Reporting later). It is its own app, `server.js` at the repo root: Node 22, Express, Postgres, express-session with connect-pg-simple. Hosted on ScootHero's HostyAfrica VPS (Ubuntu) behind Nginx, run by PM2, deployed from GitHub Actions over SSH (`deploy/`).
Non-negotiables
Server-side role checks on every route. Roles: psal, property_lead, ceo, coo, cfo, installation_manager, finance, admin. Hiding a button is not security.
Only CEO, COO or CFO sign leases, and never the person who submitted the lease.
Every write goes through `audit_log` (actor, action, entity, before/after).
Stages change only through defined actions. Never set `sites.stage` directly from a form.
Costs come only from `src/property/financials.js`. Never recalculate margin in SQL, templates or the browser.
Typography comes only from `src/styles/typography.css` tokens. No hard-coded px font sizes.
External links (landlord `/p/:token`, contractor `/q/:token` and `/j/:token`) store only a token hash, expire, are rate-limited, and never expose other sites' data.
Files go through `src/lib/storage` (server disk at STORAGE_DIR, outside the web root). Staff get files through role-checked routes; landlords and contractors through `signedUrl()`. Never write uploads anywhere else.
Personal information (POPIA): no landlord or contractor data in logs, error messages or analytics.
Mobile first for PSAL and contractor screens: 16px inputs and 44px tap targets on touch screens (already in the tokens).
Conventions
Migrations: numbered SQL files in `db/migrations/`, forward-only, each wrapped in a transaction. Never edit a migration that has run in production; add a new one.
Tests: `node --test`. Every new calculation, stage transition and permission rule gets a test. Run `npm test` before saying a task is done.
Money in rand, stored as `numeric`. Dates in South African format on screen (16 Sep 2026), ISO in the database.
Plain language in the UI: sentence case, no jargon, error messages say what to do next.
Secrets only from environment variables. Never commit `.env`.
Workflow for each task
Read the relevant spec section and existing code first.
Propose a short plan (files to touch, migrations, tests) and wait for approval before large changes.
Build on a branch, small commits, tests passing.
Finish with: what changed, how to test it on staging, anything left open.
Environments
Local: Postgres + `npm run migrate` + `npm start`.
CI: every push runs migrations and tests against a fresh Postgres.
Production: push to `main` deploys to the HostyAfrica server. `deploy/deploy.sh` migrates, reloads PM2 and rolls back if `/healthz` fails.
The server has 2 GB+ RAM assumptions for LibreOffice; heavy jobs (PDF conversion) run one at a time through the job queue.
Never run destructive SQL on production by hand; write a migration.
