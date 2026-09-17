#!/usr/bin/env node
'use strict';
/**
 * Import the Property sheet (CSV export) into the Property module.
 *
 *   node scripts/import-property-sheet.js data/property-sheet.csv            # dry run → data/import-preview.csv, data/import-review.csv
 *   DATABASE_URL=postgres://... node scripts/import-property-sheet.js data/property-sheet.csv --commit
 *
 * Safe to re-run: landlords, contacts, cities and staff are matched by name/email,
 * and sites by name + landlord, so a second run updates rather than duplicates.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ---------------- Normalisation rules ----------------

const STAGE_MAP = {
  'proposal sent': 'proposal_sent',
  'not contacted': 'site_captured',
  'live': 'complete',
  'lease in hand - not signed': 'lease_preparing',
  'not accepted': 'declined',
  '': 'site_captured',
};

const CITY_FIX = {
  'belville': 'Bellville',
  'wynburg': 'Wynberg',
  'morningside': 'Morningside',
  '7441': 'Table View',
  'kelvin/morningside': 'Morningside',
};

const PROVINCE_BY_CITY = {
  'Bellville': 'Western Cape', 'Cape Peninsula': 'Western Cape', 'Cape Town': 'Western Cape',
  'Stellenbosch': 'Western Cape', 'Table View': 'Western Cape', 'Durbanville': 'Western Cape',
  'Randburg': 'Gauteng', 'Midrand': 'Gauteng', 'Pretoria': 'Gauteng', 'Sandton': 'Gauteng',
  'Fourways': 'Gauteng', 'Johannesburg': 'Gauteng', 'Wynberg': 'Gauteng', 'Morningside': 'Gauteng',
  'North Riding': 'Gauteng', 'Bryanston': 'Gauteng', 'Namibia': 'Namibia',
};

const LANDLORD_FIX = { 'independant': 'Independent', 'attaq': 'Attacq' };
const LANDLORD_PLACEHOLDERS = new Set(['tbc', 'n/a', 'sale in progress', 'find out', '']);
const LANDLORD_TYPE_WORDS = {
  'independent': 'independent_owner',
  'franchise': 'franchise',
  'multiple (sectional title)': 'sectional_title',
};

// Rows holding several sites whose landlord/city parts don't line up by position.
// Taken from the Sheet2 landlord list.
const SPLIT_OVERRIDES = {
  'jackal creek corner': { landlord: 'Abland', city: 'North Riding' },
  'leaping frog': { landlord: 'Abland', city: 'Fourways' },
  'waterfall ridge': { landlord: 'Abland', city: 'Midrand' },
  'waterfall corner': { landlord: 'Attacq', city: 'Midrand' },
  'bramfisher shoppin': { name: 'Bramfischer Shopping Centre', landlord: null, city: 'Randburg' },
  'sherwood centre': { landlord: 'Netwater Properties', city: 'Randburg' },
  'richmond corner retail': { city: 'Cape Town' },
  'trumali house and forum': { city: 'Stellenbosch' },
  'ultra liquors cresta': { city: 'Randburg' },
  '16 dartfield road krammerville west': { name: '16 Dartfield Road, Kramerville West', city: 'Sandton' },
  'voltex randburg': { city: 'Randburg' },
  'boulders mall': { city: 'Midrand' },
};

// Mistyped emails, corrected (CEO, 16 Sep 2026). The original is kept on the contact's notes.
const EMAIL_FIXES = {
  'aryklief@growthpoint.za': 'aryklief@growthpoint.co.za',
  'annie@olivgrovejunction.co.za': 'annie@olivegrovejunction.co.za',
  'centremanager@mornigsideshops.co.za': 'centremanager@morningsideshops.co.za',
  'centremanegment@polocrossing.co.za': 'centremanagement@polocrossing.co.za',
  'warren@motorcycledforafrica.co.za': 'warren@motorcyclesforafrica.co.za',
  'rory@theutoagent.co.za': 'rory@theautoagent.co.za',
  'e-veter@outlook.com': 'e-venter@outlook.com',
  'theuns@credico.com': 'theuns@credicosa.com', // two of three Credico contacts use credicosa.com
};

// Install cost in the sheet is a fill-down estimate. Only these sites have their own figure.
const INSTALL_QUOTED = { '21 oudekraal noordwyk close, midrand + 97 republic road randburg': 20000 };

// Rows that are the same site. Source row is merged into the target (CEO, 16 Sep 2026).
const MERGE_INTO = { 'boulders mall': 'the boulders shopping centre' };

// Single sites whose name reads like two places.
const SITE_NOTES = { '21 oudekraal noordwyk close, midrand + 97 republic road randburg': 'Corner premise (one site).' };

// Rows where the Site column holds a person, not a business. Suggested names come from the email domain.
const PERSON_AS_SITE = {
  'john jacob': 'Blackboy (Wynberg)',
  'mpendulo ops manager': null,
  'thando': null,
  'calvin masia': null,
  'jean dos santos owner': 'Battery Corp Wynberg',
  'malvin': 'Hilltop Motorsport',
  'chad': 'Randburg Battery Centre',
  'gary': 'CD Auto',
  'rory': 'The Auto Agent',
};

// ---------------- Helpers ----------------

const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());
const key = (v) => clean(v).toLowerCase();
const titleFix = (v) => clean(v).replace(/\bShoppin\b/g, 'Shopping');

function normalisePhone(v) {
  const digits = clean(v).replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (/^0\d{9}$/.test(digits)) return '+27' + digits.slice(1);
  if (/^27\d{9}$/.test(digits)) return '+' + digits;
  if (/^\+27\d{9}$/.test(digits)) return digits;
  return clean(v);
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function parseNumber(v) {
  const s = clean(v).replace(/[R\s,%]/g, '');
  if (!s || /#|DIV|REF/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  const s = clean(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy (South African format)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function splitParts(v, sep) {
  return clean(v).split(sep).map(clean).filter(Boolean);
}

/** Pair contact names with emails ("PC / Theuns / Mark" + "pc@… / Mark@… / theuns@…"). */
function buildContacts(nameCell, emailCell, phoneCell) {
  const phone = normalisePhone(phoneCell);
  const emails = splitParts(emailCell, '/').filter((e) => isEmail(e));
  const fixed = (e) => EMAIL_FIXES[e.toLowerCase()] || e;
  const note = (e) => (EMAIL_FIXES[e.toLowerCase()] ? `Email corrected from ${e}` : null);
  let names = splitParts(nameCell, '/').filter((n) => key(n) !== 'tbc');
  if (!emails.length) {
    if (!names.length && !phone) return [];
    return [{ name: names.join(' / ') || null, email: null, phone }];
  }
  if (names.length <= 1) return emails.map((e, i) => ({ name: i === 0 ? names[0] || null : null, email: fixed(e), phone: i === 0 ? phone : null, notes: note(e) }));
  const used = new Set();
  return emails.map((e, i) => {
    const local = e.split('@')[0].toLowerCase();
    let n = names.find((nm) => !used.has(nm) && local.startsWith(nm.toLowerCase().split(' ')[0]));
    if (!n) n = names.find((nm) => !used.has(nm)) || null;
    if (n) used.add(n);
    return { name: n, email: fixed(e), phone: i === 0 ? phone : null, notes: note(e) };
  });
}

// ---------------- Transform ----------------

function transform(csvText) {
  const rows = parse(csvText, { relax_column_count: true, bom: true });
  const headerIdx = rows.findIndex((r) => clean(r[0]) === 'Site');
  if (headerIdx < 0) throw new Error('Could not find the header row (first cell "Site").');
  const header = rows[headerIdx].map(clean);
  const col = (name) => header.indexOf(name);
  const get = (r, name) => (col(name) >= 0 ? clean(r[col(name)]) : '');

  const out = [];
  const standaloneNames = new Set(
    rows.slice(headerIdx + 1).map((r) => key(r[0])).filter((n) => n && !n.includes(';'))
  );

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const rawSite = get(r, 'Site');
    if (!rawSite) return;
    const sheetRow = headerIdx + i + 2; // 1-based row number as seen in Excel

    const siteParts = splitParts(rawSite, ';');
    const landlordParts = splitParts(get(r, 'Landlord / Owner'), ';');
    const cityParts = splitParts(get(r, 'City / Area'), ';');

    siteParts.forEach((part, pi) => {
      const review = [];
      const k = key(part);

      // A split part that also has its own row: keep the standalone row, skip this copy.
      if (siteParts.length > 1 && standaloneNames.has(k)) return;

      const ov = SPLIT_OVERRIDES[k] || {};
      let name = titleFix(ov.name || part);

      let landlordRaw = 'landlord' in ov ? ov.landlord : (landlordParts.length === siteParts.length ? landlordParts[pi] : landlordParts[0]);
      let cityRaw = ov.city || (cityParts.length === siteParts.length ? cityParts[pi] : cityParts[0]);
      if (siteParts.length > 1 && !SPLIT_OVERRIDES[k] && (landlordParts.length > 1 || cityParts.length > 1) &&
          (landlordParts.length !== siteParts.length || cityParts.length !== siteParts.length)) {
        review.push('Split from a multi-site row; check landlord and city');
      }

      // Landlord
      let landlord = null;
      let landlordType = 'company';
      const lk = key(landlordRaw);
      if (LANDLORD_PLACEHOLDERS.has(lk)) {
        if (lk && lk !== '') review.push(`Landlord was "${clean(landlordRaw)}"`);
      } else if (LANDLORD_TYPE_WORDS[LANDLORD_FIX[lk] ? key(LANDLORD_FIX[lk]) : lk]) {
        landlordType = LANDLORD_TYPE_WORDS[LANDLORD_FIX[lk] ? key(LANDLORD_FIX[lk]) : lk];
        // "Independent" is a type, not a company. Give each owner their own landlord record.
        landlord = landlordType === 'sectional_title' ? `${name} (sectional title)` : `${name} (${landlordType === 'franchise' ? 'franchisee' : 'owner'})`;
      } else {
        landlord = LANDLORD_FIX[lk] || clean(landlordRaw).replace(/\s*\(Trading Name\)\s*/i, '');
      }

      // City / province
      const cityKey = key(cityRaw);
      let city = CITY_FIX[cityKey] || (cityRaw ? clean(cityRaw).replace(/\b\w/g, (c) => c.toUpperCase()) : null);
      if (city === 'Cape Town - Stellenbosch') city = 'Stellenbosch';
      const province = get(r, 'Province') || (city ? PROVINCE_BY_CITY[city] || null : null);
      if (!city) {
        const fromName = Object.keys(PROVINCE_BY_CITY).concat(['Durbanville']).find((c) => new RegExp(`\\b${c}\\b`, 'i').test(name));
        if (fromName) { city = fromName; review.push(`City taken from the site name (${fromName})`); }
        else review.push('No city');
      }
      const provinceFinal = province || (city ? PROVINCE_BY_CITY[city] || null : null);

      // Person in the Site column
      const personKey = key(part);
      let suggestedName = null;
      if (personKey in PERSON_AS_SITE) {
        suggestedName = PERSON_AS_SITE[personKey];
        review.push(`Site name is a person${suggestedName ? `; suggested business name "${suggestedName}"` : '; rename to the business'}`);
        if (!landlord) { landlord = `${name.replace(/\s+owner$/i, '')} (owner)`; landlordType = 'independent_owner'; }
      }

      // Contacts
      const contacts = siteParts.length > 1 && pi > 0 && !landlord ? [] :
        buildContacts(get(r, 'Contact Name'), get(r, 'Email Address'), get(r, 'Contact Number'));
      if (key(get(r, 'Email Address')) === 'tbc') review.push('Email is TBC');
      if (contacts.length && !landlord) {
        // Keep the centre manager usable in the contact dropdown until the real landlord is known.
        landlord = `${name} (landlord to confirm)`;
        review.push('Landlord unknown; contact placed under a "landlord to confirm" record');
      }

      if (/\s\+\s/.test(part) && !SITE_NOTES[k]) review.push('Two addresses in one site name; confirm it is one site');

      // Stage
      const statusRaw = get(r, 'AutoStatus');
      const stage = STAGE_MAP[key(statusRaw)];
      if (!stage) review.push(`Unknown status "${statusRaw}"`);
      if (!statusRaw) review.push('Status was blank; set to Site captured');

      // Financials (only the lease-specific inputs; blanks fall back to company defaults)
      const lease = parseNumber(get(r, 'Lease_amount_agreed'));
      const signedDate = parseDate(get(r, 'Lease_signed_date'));
      if (get(r, 'Lease_signed_date') && !signedDate) review.push(`Lease signed date "${get(r, 'Lease_signed_date')}" is not a date`);
      // "Lease in hand - not signed": the date is when the lease arrived, not when it was signed.
      const receivedDate = stage === 'lease_preparing' ? signedDate : null;
      const install = INSTALL_QUOTED[k] ?? null;
      const yn = (v) => (key(v) === 'y' || key(v) === 'yes' ? true : key(v) === 'n' || key(v) === 'no' ? false : null);

      const notes = [];
      const comment = get(r, 'Comment from landlord');
      if (SITE_NOTES[k]) notes.push({ source: 'import', body: SITE_NOTES[k] });
      if (comment) notes.push({ source: 'landlord_comment', body: comment });

      out.push({
        sheet_row: sheetRow,
        name,
        suggested_name: suggestedName,
        stage: stage || 'site_captured',
        legacy_status: statusRaw || null,
        psal: get(r, 'PSAL') || null,
        landlord,
        landlord_type: landlordType,
        contacts: landlord ? contacts : [],
        city,
        province: provinceFinal,
        area: get(r, 'Area') || null,
        notes,
        financials: {
          // Only site-specific figures. Everything else comes from cost_assumptions.
          lease_monthly: lease,
          tenure_months: parseNumber(get(r, 'Tenure (months)')),
          lease_signed_date: receivedDate ? null : signedDate,
          lease_received_date: receivedDate,
          install_cost: install,
          install_cost_is_estimate: true,
          deposit_required: yn(get(r, 'Deposit required')),
          guarantees_required: yn(get(r, 'Guarantees')),
        },
        needs_review: [...new Set(review)],
      });
    });
  });

  // Merge rows that are the same site: keep the target's landlord and contact, the further stage,
  // and fill any blank lease figures from the source.
  const STAGE_ORDER = ['declined', 'site_captured', 'proposal_to_check', 'proposal_sent', 'negotiation', 'proposal_accepted',
    'lease_preparing', 'awaiting_signature', 'landlord_signing', 'lease_signed', 'quoting', 'contractor_appointed', 'live',
    'coc_accepted', 'invoiced', 'complete'];
  for (const [src, dst] of Object.entries(MERGE_INTO)) {
    const a = out.find((s) => key(s.name) === src);
    const b = out.find((s) => key(s.name) === dst);
    if (!a || !b) continue;
    if (STAGE_ORDER.indexOf(a.stage) > STAGE_ORDER.indexOf(b.stage)) { b.stage = a.stage; b.legacy_status = a.legacy_status; }
    if (a.psal) b.psal = a.psal;
    for (const [fk, fv] of Object.entries(a.financials)) if (fv !== null && fv !== undefined && (b.financials[fk] === null || b.financials[fk] === undefined)) b.financials[fk] = fv;
    b.notes.push({ source: 'import', body: `Merged with spreadsheet row ${a.sheet_row} "${a.name}" (same site).` });
    out.splice(out.indexOf(a), 1);
  }

  // Same name + same landlord twice → keep the first, flag it.
  const seen = new Map();
  const result = [];
  for (const s of out) {
    const k = `${key(s.name)}|${key(s.landlord)}`;
    if (seen.has(k)) { seen.get(k).needs_review.push(`Duplicate of sheet row ${s.sheet_row}; that row was skipped`); continue; }
    seen.set(k, s);
    result.push(s);
  }
  const core = (n) => key(n).replace(/\b(the|shopping|centre|center|mall|retail|park)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const a of result) {
    for (const b of result) {
      if (a === b || !core(a.name) || core(a.name).length < 5) continue;
      if (core(a.name) === core(b.name) && key(a.name) !== key(b.name) && key(a.city) === key(b.city)) {
        a.needs_review.push(`Possibly the same site as "${b.name}" (sheet row ${b.sheet_row}); confirm before signing`);
      }
    }
  }
  return result;
}

// ---------------- Output ----------------

function toCsv(rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

function writePreview(sites, dir) {
  const head = ['Sheet row', 'Site', 'Suggested name', 'Stage', 'Was (AutoStatus)', 'PSAL', 'Landlord', 'Landlord type',
    'Contacts', 'City', 'Province', 'Lease R/month', 'Tenure', 'Lease signed', 'Lease received', 'Install R (site-specific)', 'Needs review'];
  const rows = sites.map((s) => [s.sheet_row, s.name, s.suggested_name, s.stage, s.legacy_status, s.psal, s.landlord, s.landlord_type,
    s.contacts.map((c) => [c.name, c.email, c.phone].filter(Boolean).join(' · ')).join(' | '),
    s.city, s.province, s.financials.lease_monthly, s.financials.tenure_months, s.financials.lease_signed_date,
    s.financials.lease_received_date, s.financials.install_cost, s.needs_review.join(' | ')]);
  fs.writeFileSync(path.join(dir, 'import-preview.csv'), toCsv([head, ...rows]));
  fs.writeFileSync(path.join(dir, 'import-review.csv'), toCsv([head, ...rows.filter((r) => r[16])]));
}

// ---------------- Database ----------------

async function commit(sites) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  const cache = new Map();
  const once = async (k, fn) => { if (!cache.has(k)) cache.set(k, await fn()); return cache.get(k); };

  try {
    await db.query('BEGIN');

    for (const s of sites) {
      const psalId = s.psal ? await once(`staff:${key(s.psal)}`, async () => {
        const f = await db.query('SELECT id FROM staff WHERE lower(name) = lower($1)', [s.psal]);
        if (f.rows[0]) return f.rows[0].id;
        const ins = await db.query('INSERT INTO staff (name) VALUES ($1) RETURNING id', [s.psal]);
        await db.query("INSERT INTO staff_roles (staff_id, role) VALUES ($1, 'psal') ON CONFLICT DO NOTHING", [ins.rows[0].id]);
        return ins.rows[0].id;
      }) : null;

      const cityId = s.city ? await once(`city:${key(s.city)}`, async () => (await db.query(
        `INSERT INTO cities (name, province) VALUES ($1, $2)
         ON CONFLICT ((lower(name))) DO UPDATE SET province = COALESCE(cities.province, EXCLUDED.province)
         RETURNING id`, [s.city, s.province])).rows[0].id) : null;

      const areaId = s.area && cityId ? await once(`area:${cityId}:${key(s.area)}`, async () => (await db.query(
        `INSERT INTO areas (city_id, name) VALUES ($1, $2)
         ON CONFLICT (city_id, (lower(name))) DO UPDATE SET name = areas.name RETURNING id`, [cityId, s.area])).rows[0].id) : null;

      const landlordId = s.landlord ? await once(`landlord:${key(s.landlord)}`, async () => (await db.query(
        `INSERT INTO landlords (name, type) VALUES ($1, $2)
         ON CONFLICT ((lower(name))) DO UPDATE SET updated_at = now() RETURNING id`, [s.landlord, s.landlord_type])).rows[0].id) : null;

      let contactId = null;
      for (const c of s.contacts) {
        const id = await once(`contact:${landlordId}:${key(c.email) || key(c.name) || c.phone}`, async () => {
          if (c.email) {
            return (await db.query(
              `INSERT INTO landlord_contacts (landlord_id, name, email, phone, notes) VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (landlord_id, (lower(email))) WHERE email IS NOT NULL
               DO UPDATE SET name = COALESCE(landlord_contacts.name, EXCLUDED.name),
                             phone = COALESCE(landlord_contacts.phone, EXCLUDED.phone),
                             notes = COALESCE(landlord_contacts.notes, EXCLUDED.notes), updated_at = now()
               RETURNING id`, [landlordId, c.name, c.email, c.phone, c.notes || null])).rows[0].id;
          }
          const f = await db.query('SELECT id FROM landlord_contacts WHERE landlord_id = $1 AND email IS NULL AND (lower(name) = lower($2) OR phone = $3) LIMIT 1', [landlordId, c.name, c.phone]);
          if (f.rows[0]) return f.rows[0].id;
          return (await db.query('INSERT INTO landlord_contacts (landlord_id, name, phone) VALUES ($1, $2, $3) RETURNING id', [landlordId, c.name, c.phone])).rows[0].id;
        });
        if (!contactId) contactId = id;
      }

      const site = await db.query(
        `INSERT INTO sites (name, stage, psal_id, landlord_id, contact_id, city_id, area_id, legacy_status, source, needs_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'import:property_sheet', $9)
         ON CONFLICT ((lower(name)), (coalesce(landlord_id, '00000000-0000-0000-0000-000000000000'::uuid)))
         DO UPDATE SET stage = EXCLUDED.stage, psal_id = EXCLUDED.psal_id, contact_id = EXCLUDED.contact_id,
                       city_id = EXCLUDED.city_id, area_id = EXCLUDED.area_id, legacy_status = EXCLUDED.legacy_status,
                       needs_review = EXCLUDED.needs_review, updated_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [s.name, s.stage, psalId, landlordId, contactId, cityId, areaId, s.legacy_status, s.needs_review]);
      const siteId = site.rows[0].id;

      if (site.rows[0].inserted) {
        for (const n of s.notes) await db.query('INSERT INTO site_notes (site_id, body, source) VALUES ($1, $2, $3)', [siteId, n.body, n.source]);
      }

      const f = s.financials;
      await db.query(
        `INSERT INTO site_financials (site_id, lease_monthly, tenure_months, lease_signed_date, lease_received_date,
           deposit_required, guarantees_required, install_cost, install_cost_is_estimate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         ON CONFLICT (site_id) DO UPDATE SET lease_monthly = EXCLUDED.lease_monthly, tenure_months = EXCLUDED.tenure_months,
           lease_signed_date = EXCLUDED.lease_signed_date, lease_received_date = EXCLUDED.lease_received_date,
           install_cost = EXCLUDED.install_cost, updated_at = now()`,
        [siteId, f.lease_monthly, f.tenure_months, f.lease_signed_date, f.lease_received_date,
         f.deposit_required, f.guarantees_required, f.install_cost]);

      await db.query(
        "INSERT INTO audit_log (actor_type, action, entity, entity_id, after) VALUES ('import', 'import_site', 'site', $1, $2)",
        [siteId, JSON.stringify({ sheet_row: s.sheet_row, name: s.name, stage: s.stage })]);
    }

    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

// ---------------- CLI ----------------

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/import-property-sheet.js <csv> [--commit]'); process.exit(1); }
  const sites = transform(fs.readFileSync(file, 'utf8'));
  writePreview(sites, path.dirname(file));

  const byStage = sites.reduce((a, s) => ((a[s.stage] = (a[s.stage] || 0) + 1), a), {});
  console.log(`Sites after splitting and de-duplicating: ${sites.length}`);
  console.log('By stage:', byStage);
  console.log(`Landlords: ${new Set(sites.map((s) => key(s.landlord)).filter(Boolean)).size} · Cities: ${new Set(sites.map((s) => key(s.city)).filter(Boolean)).size}`);
  console.log(`Needing review: ${sites.filter((s) => s.needs_review.length).length} (see import-review.csv)`);

  if (process.argv.includes('--commit')) {
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to commit.');
    await commit(sites);
    console.log('Committed to database.');
  } else {
    console.log('Dry run only. Add --commit to write to the database.');
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { transform, normalisePhone, buildContacts };
