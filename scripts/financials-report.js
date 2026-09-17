#!/usr/bin/env node
'use strict';
// Recalculate every site's financials from the database and write data/financials-report.csv.
const fs = require('fs');
const { Pool } = require('pg');
const { calculateSiteFinancials } = require('../src/property/financials');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const defaults = Object.fromEntries((await pool.query('SELECT key, value FROM cost_assumptions')).rows.map((r) => [r.key, Number(r.value)]));
  const { rows } = await pool.query(
    `SELECT s.name, s.stage, f.* FROM sites s JOIN site_financials f ON f.site_id = s.id
     WHERE f.lease_monthly IS NOT NULL ORDER BY s.stage, s.name`);
  const head = ['Site', 'Stage', 'Lease R/month', 'Tenure', 'Install R', 'Install estimated', 'Amortised R/month',
    'Electricity R/month', 'Hardware R/month', 'Cost of site R/month', 'Income R/month', 'Margin %', 'Break-even kWh/month (excl hardware)', 'Break-even bikes', 'Most lease at target margin R', 'Flags'];
  const lines = [head.join(',')];
  for (const r of rows) {
    const { inputs: i, outputs: o, flags } = calculateSiteFinancials(r, defaults);
    lines.push([JSON.stringify(r.name), r.stage, i.lease_monthly, i.tenure_months, i.install_cost, i.install_cost_is_estimate ? 'yes' : 'no',
      o.amortised_cost_month, o.electricity_cost_month, o.hardware_cost_month, o.cost_incl_hardware_month, o.income_month,
      o.margin_pct, o.breakeven_kwh_excl_hardware, o.breakeven_bikes, o.max_lease_at_target_margin, flags.join(' ')].join(','));
  }
  fs.writeFileSync('data/financials-report.csv', lines.join('\n') + '\n');
  console.log(`Wrote ${rows.length} sites to data/financials-report.csv`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
