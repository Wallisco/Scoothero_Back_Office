# Claude Code playbook — Property module

One session per step. Start each in plan mode, check the plan, then let it build. Don't start the next step until the previous one works on staging.

Before step 0: create a new GitHub repo (e.g. `scoothero/backoffice`), unzip this starter into it, keep `CLAUDE.md` at the root, and push to `main`. Actions will run the tests; the deploy step only succeeds once the server is set up (step 1).

---

## Step 0 — Make it a running app
> Read CLAUDE.md, docs/property-spec.md and README.md. The repo already has server.js (health check, sessions), scripts/migrate.js, src/lib/storage, and the Property database, import and calculations. Then:
> 1. Add login: email + password (bcrypt) with staff accounts, password reset by emailed link, and lockout after repeated failures. Sessions already live in Postgres.
> 2. Add `requireRole(...roles)` middleware and tests for it.
> 3. Add a script to create the first admin (`npm run create-admin -- email name`).
> 4. Add a server-rendered layout (EJS) that loads `src/styles/typography.css`, with the module switcher and an empty Property menu.
> 5. Keep `npm test` green.
> Show me the plan first.

**Check:** locally you can log in as admin and see the empty Property menu.

## Step 1 — Server and pipeline (you do the server part)
Server: a dedicated ScootHero VPS at HostyAfrica (2 CPU, 4 GB RAM, 60 GB+ disk, Ubuntu 24.04). Not the Habibi dispatch server.

First, secure the login. From your laptop:
```bash
ssh-keygen -t ed25519 -C "wahlied-laptop"          # if you don't already have a key
ssh-copy-id root@<server-ip>                        # uses the root password one last time
ssh root@<server-ip>                                # confirm this works without a password
```
Then on the server: `bash deploy/harden-ssh.sh` (after cloning below), and test a new key login before closing your session.

On the server, as root:
```bash
git clone <repo> /tmp/bo && cd /tmp/bo/deploy
DOMAIN=backoffice.scoothero.co.za EMAIL=wahlied@scoothero.co.za bash server-setup.sh
```
It installs Node 22, Postgres, Nginx, LibreOffice, PM2, SSL, firewall and nightly backups, creates the database and `.env`, and prints a deploy key.
1. Add the printed key to the GitHub repo → Settings → Deploy keys (read-only).
2. Create an SSH key pair for GitHub Actions; put the public half in `/home/deploy/.ssh/authorized_keys` on the server.
3. In GitHub → Settings → Secrets: `SSH_HOST`, `SSH_PORT`, `SSH_USER` = deploy, `SSH_PRIVATE_KEY`. Variable: `REPO_URL` = the repo's SSH clone URL.
4. Point `backoffice.scoothero.co.za` at the server's IP.
5. Push to `main`.

Then in Claude Code:
> Check the last GitHub Actions run and fix anything that failed. Then, over SSH on the server, run `npm run create-admin` for me.

**Check:** https://backoffice.scoothero.co.za shows the login page and `/healthz` reports 2 migrations.

## Step 2 — Import
> Over SSH on the server, run the Property sheet import (dry run first, show me the summary, then commit). Then run the financials report and compare it with ScootHero_CRM_Site_List_corrected.xlsx for the seven sites with leases.

**Check:** 95 sites; margins match the spreadsheet.

## Step 3 — Shell, menu, All sites, site page
> Build spec sections 1, 2, 2a and 4: module switcher, Property left menu with live stage counts, All sites (search, stage filter, needs-review filter, cards on phones), and the site page (details, landlord and contact, notes, photos, financials with "Estimated" and "Default rate" badges, audit history). Role checks on every route.

## Step 4 — New site form (phone)
> Build spec step 1 without the render: first-touch timestamp set when the form opens, GPS pin with accuracy (warn over ±40 m, paste-coordinates fallback), dropdowns with add-new for PSAL, city, area, landlord and contact (contacts filtered by landlord), photo upload straight from the phone camera through src/lib/storage with GPS and time. Save creates the site at "Site captured" and writes the audit log.

**Check:** Shaka captures a real site on his phone.

## Step 5 — Setup and Needs review
> Build Setup (team and roles, cities and areas, landlords and contacts, cost assumptions, contractors, quote line items) and the Needs review list from `sites.needs_review`, with a Resolve action that edits the record and writes the audit log. Only admin and property_lead can edit cost assumptions.

**Go live with Phase 1 here.**

---

## Step 6 — Render marking screen
> Build the render step on the site page using src/property/render.js: the PSAL picks the bay photo, marks either two bay corners (2.5 m default) or a known-height object, taps the base position, previews, and saves to `site_renders`. Must work with a finger on a phone.

## Step 7 — Proposal generation
> Generate the proposal from ScootHero_SiteAcquisition.pptx with pptx-automizer: a new front page (site, address, pin, visit date, PSAL, landlord, contact, render as hero) followed by the existing slides 2–9. Convert to PDF with LibreOffice in a background job (pg-boss). Store both through src/lib/storage and email the PSAL (E1).

## Step 8 — Check, send, landlord page
> Build spec steps 2–5: Proposals to check, Send to landlord (E2 from the PSAL's mailbox), the public proposal page at /p/:token with view tracking, the monthly amount question, in-principle Accept (exact wording in the spec) with lease upload, Decline with reason, follow-ups on day 4, 7 and 14 (E3), and E4–E6. Show the "most a PSAL can offer" figure on the PSAL's screens only, never on the landlord page.

**Go live with Phase 2 here.**

## Step 9 — Lease pack and SignEasy
> Build spec steps 6–7: lease pack, exec queue, "Approve and sign", auto-appended signature page, SignEasy request (exec first, landlord second) behind src/lib/esign, webhook with signature verification, signed PDF and audit trail stored, Signed leases list, E7–E9. Use the SignEasy sandbox until live keys are set.

**Go live with Phase 3 here.**

## Step 10 — Quotes, POs, installation
> Build spec steps 8–11 using migration 002: quote requests to contractors (/q/:token with one-time code), line items from quote_line_templates, required photos, compare and accept/decline (E10–E11), PO PDF, the contractor job page (/j/:token) with the Live button (within 200 m of the pin, camera photo), COC upload and review, invoice upload after COC acceptance, finance approval and paid (E12–E15). The accepted quote replaces the estimated install cost.

**Go live with Phase 4 here.**

## Step 11 — Dashboard
> Build the Property dashboard: funnel counts, overdue items by SLA, leases signed per week per city against the target of 3, and sites below target margin.
