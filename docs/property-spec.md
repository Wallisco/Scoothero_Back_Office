# ScootHero Back Office — Property Module Build Spec

Version 1.6 · 16 September 2026 (decisions from CEO review applied; Phase 1 starter built) · Owner: Wahlied Cole (CEO) · Accountable: COO

This spec covers the full property workflow, from a PSAL standing at a site to a live, certified, paid-for swap station. It is written for Claude Code building the ScootHero Back Office as its own app: Node 22/Express and Postgres on ScootHero's HostyAfrica VPS (Ubuntu, Nginx, PM2), deployed from GitHub.

---

## 1. Architecture decision

**One platform, one database, one login. Modules, not separate apps.**

The back office is a single system. Property, Bike Sales, Deployments, Driver Management, After Sales, Billing, Finance and Reporting (the modules on your "Backoffice architecture" sheet) are modules inside it.

- **Top level:** a module switcher (Property, Sales, Deployments and so on). A user only sees the modules their role allows.
- **Inside each module:** a left-hand submenu that follows that module's workflow.
- **Shared across modules:** users and roles, landlords and contacts, sites, files, email, audit log, notifications. A site created in Property is the same site Deployments puts bikes on and Billing invoices against.
- **Outside the back office:** external portals for people who never get a back-office login. These are the landlord proposal page and the electrician quote and job pages. They use signed, expiring links, not staff logins.

Why not separate sub-apps with their own databases: the same records flow through every module (site → lease → installation → live station → bikes → revenue). Split databases mean syncing, duplicate landlords, and reports that never reconcile. Separate front-ends on one database is workable later if teams grow, but there is no reason to start there.

---

## 2. Roles and permissions

Roles are enforced on the server. Hiding a button is not enough.

| Role | Can do |
|---|---|
| PSAL (property acquisition lead) | Capture sites, check and send proposals, prepare leases, submit for approval, request quotes |
| Property lead | Everything a PSAL can, across all PSALs; reassign sites |
| CEO / COO / CFO | Everything above, plus approve and sign leases, accept quotes above threshold |
| Installation manager | Ready to install onward: quotes, appointing contractors, jobs, COC review |
| Finance | Approve and pay contractor invoices; read-only on leases and financials |
| Admin | Setup lists, users, templates |

Rules:
- A lease can only be signed by CEO, COO or CFO, and never by the person who submitted it.
- Recommended: signing is the approval. The exec reviews the lease pack in the app, and clicking "Approve and sign" opens the e-signature screen. That removes a separate approval step that adds nothing.
- Every state change writes to `audit_log` (who, what, when, before/after).

---

## 2a. Typography (all modules)

Back-office screens carry a lot of text and numbers, so the system uses a tighter scale than a marketing site. The tokens live in `src/styles/typography.css` and every module uses them. Don't hard-code font sizes.

**Typeface:** Inter, with the fallback stack Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial. Inter is built for small sizes on screens. If it fails to load, each device falls back to its own native sans-serif. No serif fonts anywhere.

| Token | Size / line height | Use |
|---|---|---|
| `--fs-meta` | 12px / 16px (0.75rem) | Field labels, table headers, timestamps, captions, badges, microcopy |
| `--fs-body` | 14px / 20px (0.875rem) | Body text, data grid rows, form fields, buttons, properties |
| `--fs-card` | 16px / 24px (1rem) | Card and widget titles, navigation menu items |
| `--fs-h2` | 18px / 26px on phones, 20px / 28px from 1024px | Section headings on a page |
| `--fs-h1` | 24px / 32px (1.5rem) | Page title (site name, landlord name, lease) |

Weights: 400 body, 600 labels, headings and buttons, 700 page titles only.

**Mobile adjustments (touch screens only):**
- **Form inputs step up to 16px.** iOS Safari zooms the whole page when you tap into a field under 16px. PSALs capture sites on phones, so the New site form would jump on every field. Desktop inputs stay at 14px.
- **Tap targets are 44px tall** (buttons, nav items, inputs). They're 36px on desktop.

**Numbers:** tables, amounts, dates, counts and coordinates use tabular figures, so columns of rands line up.

**Rows:** 14px text with 20px line height and 8px padding above and below gives 36px table rows. That's dense enough for long lists and still easy to scan.

## 3. The workflow as a state machine

Each site carries one `stage`. Transitions only happen through the actions below, so the menu counts are always true.

| # | Stage | Entered when | Who acts | SLA (from your Property Funnel sheet) |
|---|---|---|---|---|
| 1 | Site captured | PSAL saves the site form | PSAL | Same day |
| 2 | Proposal to check | System generates the proposal | PSAL | Send within 1 day |
| 3 | Proposal sent | PSAL approves and sends | Landlord | Follow-ups at day 4 and 7; goodbye at day 14 |
| 4 | Proposal accepted | Landlord clicks Accept on the proposal page | PSAL | Lease pack within 5 work days |
| 5 | Negotiation | Landlord's amount is outside the site budget, or landlord asks to talk | PSAL | 3 days |
| 5b | Declined (closed) | Landlord clicks Decline | None | Goes to the Revisit list after 90 days |
| 6 | Leases accepted: preparing | PSAL opens the accepted proposal | PSAL | 5 work days |
| 6b | Awaiting exec signature | PSAL submits the lease pack | CEO / COO / CFO | 2 work days |
| 7 | Out for landlord countersignature | Exec signs electronically | Landlord | 7 days, with reminders |
| 7b | Signed lease | E-signature provider reports both signatures complete | Installation manager | Quotes requested within 1 day |
| 8 | Ready to install: quoting | Quote requests sent to contractors | Contractors | Quotes within 5 work days |
| 9 | Contractor appointed | Quote accepted and PO issued | Contractor | Install within 15 work days of lease |
| 10 | Live | Contractor presses Live and uploads a live-screen photo on site. This activates the site. | Contractor | — |
| 11 | COC received | Contractor uploads the COC once their admin and registration are done | Installation manager reviews | Chased daily after 3 work days |
| 12 | Invoice submitted | Contractor uploads the invoice (unlocks once the COC is accepted) | Finance | Pay per terms |
| 13 | Complete | Finance marks paid | — | — |

**Decided:**
- **Live comes before the COC.** Pressing Live activates the site. The COC is paperwork the same installer submits a few days later, once their admin and registration are done. The site shows "Live, COC outstanding" until the COC is accepted, and the contractor can't invoice until then.
- **Accept is in principle only, to be negotiated.** It is not a binding contract. The wording is in step 4.

---

## 4. Left menu for the Property module

```
Property
  Dashboard
  New site
  All sites
Acquisition
  Proposals to check        (stage 2)
  Proposals sent            (stage 3, with day-4/7/14 timers)
  Negotiation               (stage 5)
  Declined                  (stage 5b)
Leases
  Leases accepted           (stage 4 + 6)
  Awaiting signature        (stage 6b; the exec queue)
  Out for countersignature  (stage 7)
  Signed leases             (stage 7b)
Installation
  Ready to install          (stage 7b + 8)
  Quotes                    (stage 8: compare and decide)
  In progress               (stage 9)
  Live                      (stage 10–11)
  Invoices                  (stage 12)
  Completed                 (stage 13)
Setup
  Team and roles · Landlords and contacts · Cities and areas · Contractors
  Quote line items · Proposal template and station render · Cost assumptions · Email templates
```

Each list shows counts in the menu and flags anything past its SLA. The Dashboard shows the funnel, SLA breaches, and progress against the target of 3 leases signed per week per city.

---

## 5. Step-by-step functional detail

### Step 1 — New site (PSAL, on a phone)
- First touch timestamp set automatically when the form opens.
- Drop pin at the entrance (GPS with accuracy; re-drop if worse than ±40 m).
- Site name, PSAL (dropdown with add-new), city and area (dropdowns with add-new), landlord (dropdown with add-new), contact under that landlord (name, email, number).
- Photos: site, entrance, electrical DB and supply point, and the proposed bay. Each photo stores its GPS and timestamp.
- **Render step (built: `src/property/render.js`).** The station is 1.80 m tall × 1.05 m wide × 0.85 m deep. The PSAL marks a scale reference on the bay photo, either:
  - the two front corners of a parking bay (standard width 2.5 m, editable), or
  - anything upright of known height near the spot, such as a door (2.1 m) or a bollard.
  
  Then they tap where the station's base should stand. The station image is placed at true size for that spot, with a soft ground shadow, and saved as the render. It's a flat, front-on overlay: accurate in height and width at the marked spot, with no perspective correction. So the scale reference must be marked close to the station position.
- Save runs validation. Required before a proposal can generate: pin, site photo, render, landlord, contact email.

### Step 2 — Proposal generated and sent to the PSAL
- On save, a background job builds the proposal from `ScootHero_SiteAcquisition.pptx`:
  - **New front page:** site name, address and pin, date of visit, PSAL name, landlord and contact, the render as the hero image, and a "prepared for" line. ScootHero navy, teal and orange as in the current deck.
  - Slides 2–9 of the current deck follow unchanged.
- Output: `.pptx` and a `.pdf` (LibreOffice headless converts it). Both stored through `src/lib/storage` on the server.
- Email to the PSAL with both attached, plus a link to "Proposals to check".
- The PSAL checks it in the app and can fix details and regenerate. Then **Send to landlord**.
- Recommended library: `pptx-automizer` (Node, template-based), so the deck design stays in PowerPoint and the code only fills the front page.

### Step 3 — Online proposal link
- Email to the landlord contact comes from the PSAL's mailbox and includes the PDF and a link: `https://portal.scoothero.co.za/p/<token>`.
- The token is random, single-proposal, and expires after 60 days. No login.
- The page is a mobile-first web version of the proposal: front page with render, benefits, requirements, process, team.
- The bottom section asks: **What monthly lease amount would you be happy with?** It has an amount in rand, an optional comment, and optional escalation and tenure preferences.
- Tracking: first viewed, last viewed, view count. These show on the PSAL's list.
- Follow-ups send automatically if there's no decision: day 4, day 7, and a goodbye on day 14. The PSAL can pause them.

### Step 4 — Accept
- Accept requires the monthly amount, the signer's name and email, and ticking the in-principle acceptance wording:

  > "I accept this proposal in principle, on behalf of the property owner. This is not a binding agreement. The location, monthly lease amount, lease terms and installation remain subject to negotiation, a technical site assessment, and a written lease signed by both parties."

  Legal to sign off the final text. The wording version is stored with each acceptance.
- The landlord can upload their lease document (PDF or Word, 20 MB max). It is stored against the proposal and the site.
- If the amount is inside the site's budget range, the stage becomes Proposal accepted. If it's outside, the stage becomes Negotiation and the PSAL is alerted. The landlord still sees the thank-you message.
- Landlord sees and is emailed: "Thank you for signing up with us. Our property team will contact you shortly to finalise."
- Internal alert to the PSAL and property lead.

### Step 5 — Decline / negotiation
- Decline asks for an optional reason (price, space, power, not now, other). The landlord gets a thank-you-for-evaluating-us email. The site goes to Declined and resurfaces in a Revisit list after 90 days.
- In Negotiation, the PSAL can issue a revised proposal (version 2). It gets a new link, and the old link shows "This proposal has been updated".

### Step 6 — Leases accepted: lease pack (PSAL)
The PSAL builds the lease pack. It shows side by side:
- Our proposal (PDF) and the landlord's lease document.
- Commercial terms: monthly amount, escalation %, tenure (months), start date, deposit, guarantees, electricity arrangement, bays.
- **Financials** (section 7), using the estimated installation cost until a real quote exists.
- A checklist the PSAL ticks: terms match the landlord's lease, entity name and reg number correct, site plan attached, power availability confirmed.
- **Submit for signature** puts the pack in the exec queue and emails CEO, COO and CFO.
- Placeholder for later: site budget and motivation.

### Step 7 — Exec signs, landlord countersigns (e-signature)
- The exec opens the pack, reviews it, and clicks **Approve and sign**. The exec can also send it back to the PSAL with a comment.
- **Decided: signature page appended automatically.** The system adds a ScootHero signature page to the end of the landlord's lease. It lists parties, site, monthly amount and tenure, and has fixed boxes for the exec and the landlord, plus initials on every page. Nobody places fields by hand.
- The backend sends the combined PDF to the e-signature provider with two signers in order: the exec first, then the landlord contact.
- Provider webhooks update the stage: exec signed → Out for countersignature; landlord signed → Signed lease. The completed signed PDF and audit trail are downloaded and stored.
- **Provider: SignEasy (decided).** ScootHero already works in a SignEasy business workspace. SignEasy prices API plans separately from its web-app plans, so confirm with SignEasy whether the workspace includes API access and webhooks, or needs the API add-on. Build against SignEasy's free API sandbox until then. The code sits behind one `esign` interface (`createRequest`, `getStatus`, `downloadSigned`, `handleWebhook`).
- **Signing identities:** each exec signs as their own SignEasy workspace user, so the audit trail shows the real CEO, COO or CFO.
- Signed leases automatically appear under Installation → Ready to install, and the installation manager is emailed.
- The provider sends its own signing emails and reminders.

### Step 8 — Quote requests to electrical contractors
- The installation manager picks one or more contractors and sends a quote request.
- The contractor gets an email link: `/q/<token>`. Confirm it with a one-time code sent to their email, because they're entering prices.
- The quote page shows the site name, address, pin, photos (DB and supply point), site notes, the render, and the station spec: 1.80 m × 1.05 m × 0.85 m, 9 bays.
- **Installer requirements (ScootHero standard):**
  - **Supply:** either 50 A single phase or 25 A three phase. The contractor picks which the site supports.
  - **Three phase:** a metered point is required on the supply side.
  - **Breaker:** a correctly sized breaker terminating in the DB the supply is taken from.
  - **Cable route:** surface run preferred wherever the site allows.
  - **Civils:** note every civil item and photograph it.
  - **COC:** required for every installation.
- **Standard line items** (`quote_line_templates`, editable in Setup):

  | Code | Item | Unit | When | Photo |
  |---|---|---|---|---|
  | SUPPLY_1PH_50A | Single-phase 50 A supply to the station | Lump sum | Single phase | — |
  | SUPPLY_3PH_25A | Three-phase 25 A supply to the station | Lump sum | Three phase | — |
  | METER_3PH | Metered point on the supply side | Each | Three phase | Required |
  | BREAKER_DB | Breaker sized to the supply, terminating in the source DB | Each | Always | Required (DB open) |
  | CABLE_SURFACE | Cable, surface run, incl. containment and fixings | Metre | Always | — |
  | CABLE_OTHER | Cable where surface run isn't possible (trenched, ducted, overhead) | Metre | Optional | Required, with reason |
  | CIVILS | Civil works (trenching, core drilling, making good, plinth) | Lump sum | Optional | Required per item |
  | LABOUR | Installation labour and connection | Lump sum | Always | — |
  | COC | Certificate of Compliance | Lump sum | Always | — |
- The contractor also records the DB-to-station distance in metres and whether a surface run is possible.
- For each line item, the contractor enters quantity, unit price and a note. They can add extra lines, give the earliest date they can do the job, and state validity days.
- Totals calculate on the page, including VAT if the contractor is VAT-registered. Submit locks the quote.

### Step 9 — Appoint on quote
- The Quotes screen compares submitted quotes line by line, plus total and earliest date.
- **Accept** marks the other quotes declined. The accepted contractor gets a "quote accepted" email with a generated purchase order PDF: PO number, site, line items, total, required completion date, and COC and invoice requirements. The declined contractors get a "quote declined, thank you" email.
- Quotes above a set amount need CEO, COO or CFO approval before they can be accepted.
- The accepted quote total replaces the estimated install cost in the site's financials. The lease pack is marked "Actual".
- **The installation team sets the site's actual electricity rate (R/kWh)** from the site's metering or landlord billing. The default of R4.60 stays in place until they update it.

### Step 10 — Live (contractor, on site, on a phone)
- The contractor opens the job link `/j/<token>` (one-time-code confirmed). It shows the PO, site details and pin.
- The **Live** button is only active when the device GPS is within 200 m of the site pin and a photo has been taken with the camera (not picked from the gallery where the browser allows).
- Stored: the live timestamp, the photo, and the GPS and accuracy at the moment of pressing.
- Internal alert to the installation manager and the COO.

### Step 11 — COC, then invoice
- The contractor uploads the COC (PDF or photo), COC number and date. The installation manager reviews and accepts it or rejects it with a reason.
- The invoice upload unlocks only after the COC is accepted. The contractor enters invoice number, amount and VAT, and uploads the PDF.
- The system checks the invoice amount against the PO amount and flags any difference for Finance.
- Finance approves and marks paid with a payment date and reference. The contractor is emailed a payment confirmation. The job is complete.

---

## 6. Data model (Postgres)

Core tables. All have `id uuid`, `created_at` and `updated_at`.

```
users(name, email, phone, role, active)
cities(name, province) · areas(name, city_id)
landlords(name, reg_no, notes) · landlord_contacts(landlord_id, name, email, phone, position)

sites(name, stage, psal_id, landlord_id, contact_id, city_id, area_id, address,
      lat, lng, pin_accuracy_m, pin_captured_at, first_touch_at,
      budget_min, budget_max, partnership_tag, do_not_deploy, notes)
site_photos(site_id, kind[site|entrance|electrical|bay|other], blob_key, lat, lng, taken_at, uploaded_by)
site_renders(site_id, photo_id, bay_points jsonb, px_per_m, station_model, blob_key, created_by)

proposals(site_id, version, status[draft|to_check|sent|viewed|accepted|declined|superseded|expired],
          pptx_key, pdf_key, token_hash, token_expires_at, sent_at, sent_by,
          first_viewed_at, last_viewed_at, view_count,
          landlord_amount, landlord_escalation_pct, landlord_tenure_months, landlord_comment,
          decision_name, decision_email, decision_ip, decided_at, acceptance_text_version, decline_reason)
proposal_followups(proposal_id, day[4|7|14], scheduled_for, sent_at, cancelled_at)
documents(site_id, proposal_id, lease_id, kind[landlord_lease|signed_lease|coc|invoice|po|quote|other],
          blob_key, filename, mime, size, uploaded_by_type[staff|landlord|contractor], uploaded_by)

leases(site_id, proposal_id, status[preparing|awaiting_signature|returned|landlord_signing|signed|cancelled],
       monthly_amount, escalation_pct, tenure_months, start_date, deposit, guarantees,
       electricity_arrangement, bays, submitted_by, submitted_at, returned_comment,
       exec_signer_id, exec_signed_at, landlord_signed_at,
       signeasy_request_id, signed_document_id, checklist jsonb)
lease_financials(lease_id, install_cost_estimate, install_cost_actual, hardware_cost,
                 hardware_amortisation_months, bikes_projected, swaps_per_bike_day,
                 avg_km_per_bike_day, kwh_per_km, electricity_rate_per_kwh, days_per_month,
                 income_per_site_month, computed jsonb)

contractors(name, reg_no, vat_no, email, phone, electrical_contractor_reg_no, active)
quote_line_templates(code, description, unit, sort)
quote_requests(site_id, lease_id, contractor_id, status[sent|viewed|submitted|accepted|declined|expired],
               token_hash, expires_at, earliest_date, validity_days, subtotal, vat, total, submitted_at)
quote_lines(quote_request_id, template_code, description, qty, unit, unit_price, line_total, note)
purchase_orders(number, site_id, contractor_id, quote_request_id, amount, required_by, pdf_document_id, issued_by, issued_at)
install_jobs(site_id, po_id, contractor_id, status[appointed|live|coc_review|coc_accepted|invoiced|paid],
             live_at, live_photo_key, live_lat, live_lng, live_accuracy_m,
             coc_number, coc_date, coc_document_id, coc_reviewed_by, coc_reviewed_at, coc_reject_reason,
             invoice_number, invoice_amount, invoice_vat, invoice_document_id, invoice_flag,
             approved_by, paid_at, payment_ref)

email_log(template, to, cc, subject, related_type, related_id, provider_id, status, sent_at)
audit_log(actor_type, actor_id, action, entity, entity_id, before jsonb, after jsonb, at, ip)
```

Tokens: store only a hash of each external link token. Rate-limit the `/p`, `/q` and `/j` routes.

---

## 7. Lease financials

The same formulas run in `src/property/financials.js` and in `ScootHero_CRM_Site_List_corrected.xlsx` (Assumptions tab). Change a default in one place (Setup → Cost assumptions) and every site recalculates.

**Defaults (CEO, 16 Sep 2026):**

| Setting | Default | Who changes it |
|---|---|---|
| Lease tenure | 24 months | PSAL, per site, once agreed |
| Install cost | R11,200 (estimate until a quote is accepted) | Replaced by the accepted quote |
| Electricity rate | R4.60/kWh | Installation team, per site |
| Selling price | R11.50/kWh | Finance |
| Hardware | R1,824/month | Finance |
| Bikes per site | 8 | PSAL, per site |
| Km per bike per day | 120 | Operations |
| Battery | 3,240 Wh | Operations |
| Km per battery | 72 km | Operations |
| Charging efficiency | 100% (assumption; confirm from charger spec) | Operations |
| Target margin | 30% (assumption; CEO to set) | CEO |
| Days per month | 30.44 | — |

**Formulas:**

| Output | Formula |
|---|---|
| Energy per km | battery Wh ÷ 1,000 ÷ km per battery = 0.045 kWh/km |
| Swaps per bike per day | km per day ÷ km per battery = 1.67 |
| kWh into batteries per month | bikes × km per day × kWh per km × days per month = 1,315 kWh |
| kWh from the grid per month | kWh into batteries ÷ charging efficiency |
| Electricity cost | grid kWh × electricity rate |
| Amortised cost per month | lease + install ÷ tenure |
| Fixed cost per day | amortised cost ÷ days per month |
| **Cost of site incl. hardware** | **amortised cost + hardware + electricity cost** |
| Income | kWh into batteries × selling price |
| **Margin** | **(income − cost of site) ÷ income** |
| Break-even kWh (excl. hardware) | amortised cost ÷ (selling price − electricity rate ÷ efficiency) |
| Break-even bikes | (amortised cost + hardware) ÷ margin per kWh ÷ kWh per bike |
| Most lease at target margin | income × (1 − target margin) − (install ÷ tenure + hardware + electricity) |

If the installation team records real kWh for a live site, it replaces the estimate.

**At the defaults, a site with no lease yet:** income R15,123, costs before lease R8,340. A PSAL can offer up to **R2,246/month** and keep a 30% margin. At R6,783/month the margin hits zero. The app shows this number on every proposal and negotiation screen.

**Current leases on the corrected model:**

| Site | Lease | Tenure | Margin |
|---|---|---|---|
| Waterstone Durbanville | R1,000 | 12 | 35.2% |
| The Boulders Shopping Centre | R1,500 | 24 | 34.9% |
| Midas Midrand | R1,500 | 24 | 34.9% |
| Morning Glen | R2,000 | 12 | 28.5% |
| Pineslopes | R2,500 | 24 | 28.3% |
| 21 Oudekraal (R20,000 quoted install) | R2,000 | 12 | 23.7% |
| Lameka Bike Garage | R3,500 | 24 | 21.7% |

## 8. Emails

| Code | Trigger | To | From |
|---|---|---|---|
| E1 | Proposal generated | PSAL | System |
| E2 | PSAL sends proposal | Landlord contact | PSAL mailbox |
| E3 | Day 4 / day 7 follow-up, day 14 goodbye | Landlord contact | PSAL mailbox |
| E4 | Landlord declines | Landlord contact | PSAL mailbox |
| E5 | Landlord accepts | Landlord contact | PSAL mailbox |
| E6 | Accept or decline alert | PSAL, property lead | System |
| E7 | Lease pack submitted | CEO, COO, CFO | System |
| E8 | Lease returned by exec | PSAL | System |
| E9 | Lease fully signed | Installation manager, PSAL | System |
| E10 | Quote request | Contractor | Installation manager |
| E11 | Quote accepted (PO attached) / declined | Contractor | Installation manager |
| E12 | Site live | Installation manager, COO | System |
| E13 | COC rejected | Contractor | System |
| E14 | Invoice submitted | Finance | System |
| E15 | Payment made | Contractor | System |

Sending: Microsoft Graph if proposals should come from each PSAL's own scoothero.co.za mailbox (landlord replies go straight to them), otherwise SendGrid or another transactional mail service. Log every send in `email_log`.

---

## 9. Integrations

- **E-signature (SignEasy):** signature request with ordered signers, webhooks for signer events and completion, download of the signed document and audit trail. Behind one `esign` interface; see step 7.
- **File storage (`src/lib/storage`):** all photos, renders, proposals, leases, COCs, invoices and POs on the server disk, outside the web root. Staff get files through role-checked routes; external pages through signed, expiring links. Nightly backups of files and database, copied off the server.
- **HubSpot:** push landlord companies and contacts, and mirror the site stage onto a Property deal pipeline, so sales reporting stays in one place. The back office is the source of truth.
- **Maps:** Leaflet with your existing mapping work for the All sites map view.

---

## 10. Import from the current spreadsheet

Source: the cleaned Property sheet (86 rows). After splitting and merging: **95 sites, 56 landlords, 66 contacts, 17 cities.**

| AutoStatus | Stage |
|---|---|
| Proposal sent | Proposal sent |
| Not contacted, or blank | Site captured |
| Live | Complete (historic) |
| Lease in hand - not signed | Leases accepted: preparing |
| Not accepted | Declined |

**Applied automatically:**
- **Multi-site rows split** into one site each, with landlord and city from Sheet2 where the cell parts don't line up.
- **Spelling fixed:** Bellville, Wynberg, Independent, Attacq, Bramfischer, Kramerville; "7441" → Table View.
- **Eight emails corrected**, with the original kept on the contact's notes: growthpoint.co.za, olivegrovejunction, morningsideshops, centremanagement, motorcyclesforafrica, theautoagent, e-venter, and theuns@credicosa.com.
- **Boulders Mall merged into The Boulders Shopping Centre** (Redefine): Aziz as PSAL, lease in hand at R1,500.
- **21 Oudekraal / 97 Republic Road** is one corner premise, with a R20,000 quoted install.
- **"Lease in hand" dates** are stored as the date the lease was received, not signed (Midway Mews: received 7 Sep 2026).
- **Install, tenure, bikes, km, rate and hardware** are not copied per site, because those columns were filled down. Sites use the company defaults unless they have their own figure.
- **Independent owners** each get their own landlord record, not one shared "Independent".

**Left for the PSALs on the Needs review list (21 sites):**
- 9 sites named after a person, with suggested business names.
- 4 sites with a contact under a "landlord to confirm" record, and 2 with no landlord.
- 3 Capstone sites with a blank status.
- 4 sites with a TBC email.
- 2 cities taken from the site name.

## 11. Build order

Each phase ships something usable.

1. **Platform shell.** Typography tokens, roles on the existing portal login, module switcher and Property left menu, schema, blob storage, audit log, Setup lists, spreadsheet import, the mobile New site form with pin and photos.
2. **Proposals.** Render tool, PPTX and PDF generation, PSAL check and send, landlord proposal page, accept/decline, lease upload, follow-up scheduler, emails E1–E6.
3. **Leases.** Lease pack, financials, exec queue, e-signature request and webhooks, signed leases, emails E7–E9.
4. **Installation.** Contractor setup, quote line templates, quote portal, compare and accept, PO PDF, job page with the Live button, COC review, invoices and payment, emails E10–E15.
5. **Management.** Dashboard, SLA alerts, HubSpot sync, site budgets and motivations.

---

## 12. Decisions

**Decided:**
- **Live before COC:** Live activates the site; the COC follows, and the invoice waits for it.
- **Signature page:** appended automatically to the landlord's lease.
- **E-signature:** SignEasy, using the business workspace.
- **Defaults:** 24-month lease, R11,200 install, R4.60/kWh electricity, R11.50/kWh selling price.
- **Energy:** 3,240 Wh battery, 72 km per battery.
- **Landlord Accept:** in principle only, to be negotiated.
- **Data:** emails corrected; Boulders merged; corner premise confirmed; person-named sites fixed by PSALs from the review list.
- **Typography:** section 2a.
- **Station:** 1.80 m × 1.05 m × 0.85 m, 9 bays; render PNG supplied.
- **Electrical scope:** 50 A single phase or 25 A three phase, metered point on three phase, breaker in source DB, surface run preferred, civils photographed, COC required.

**Still needed:**
1. **Station width check:** the photo's proportions are 13% wider than 1.05 × 1.80 m. Measure the widest point with a tape; the render uses the stated dimensions.
2. **SignEasy API access:** confirm the workspace includes API and webhooks, or add the API plan.
3. **Target margin:** confirm or replace the 30% assumption.
4. **Charging efficiency:** from the charger spec (currently 100%).
5. **Approval:** is signing the approval (recommended)? Is there a monthly amount above which two execs must approve?
6. **Quote threshold:** the amount above which a quote needs exec approval.
7. **Email:** do proposals go from each PSAL's own mailbox (Microsoft Graph)?
9. **Finance system:** where contractor invoices get paid (Xero, Sage, other).
10. **Accept wording:** legal sign-off on the text in step 4.

---

## 13. Hosting and deployment

- **Where:** ScootHero's HostyAfrica VPS (Ubuntu), at `backoffice.scoothero.co.za`. Data stays in South Africa (POPIA).
- **Stack on the server:** Node 22 under PM2 (2 instances, zero-downtime reloads), Nginx with Let's Encrypt SSL and rate limits on landlord and contractor links, Postgres 16, LibreOffice for proposal PDFs, UFW firewall, fail2ban.
- **Releases:** push to `main` → GitHub Actions runs migrations and tests on a fresh database → SSH to the server → `deploy/deploy.sh` clones the release, installs, migrates, reloads PM2, checks `/healthz`, and rolls back automatically if it fails. The last 5 releases are kept.
- **Backups:** nightly database dump and file archive at 02:00, kept 14 days on the server, and copied off the server to a second location.
- **Login:** the back office has its own staff login (email and password, reset by email, lockout), sessions in Postgres. It is separate from the Azure portal.
