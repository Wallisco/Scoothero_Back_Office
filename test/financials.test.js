'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSiteFinancials } = require('../src/property/financials');

// Expected values match ScootHero_CRM_Site_List_corrected.xlsx after recalculation.

test('Energy: 8 bikes × 120 km × (3.24 kWh ÷ 72 km) × 30.44 days', () => {
  const r = calculateSiteFinancials({});
  assert.ok(Math.abs(r.inputs.kwh_per_km - 0.045) < 1e-12);
  assert.equal(r.inputs.swaps_per_bike_day, 1.67);
  assert.equal(r.outputs.kwh_grid_month, 1315.01);
  assert.equal(r.outputs.electricity_cost_month, 6049.04);
  assert.equal(r.outputs.income_month, 15122.59);
});

test('Waterstone Durbanville: R1,000 lease, 12 months, R11,200 install', () => {
  const r = calculateSiteFinancials({ lease_monthly: 1000, tenure_months: 12, install_cost: 11200 });
  assert.equal(r.outputs.amortised_cost_month, 1933.33);
  assert.equal(r.outputs.cost_incl_hardware_month, 9806.37);
  assert.equal(r.outputs.margin_pct, 35.15);
  assert.equal(r.outputs.breakeven_kwh_excl_hardware, 280.19);
});

test('21 Oudekraal: R2,000 lease, 12 months, R20,000 quoted install', () => {
  const r = calculateSiteFinancials({ lease_monthly: 2000, tenure_months: 12, install_cost: 20000 });
  assert.equal(r.outputs.cost_incl_hardware_month, 11539.7);
  assert.equal(r.outputs.margin_pct, 23.69);
  assert.ok(r.flags.includes('below_target_margin'));
});

test('Lameka Bike Garage: R3,500 lease on default 24 months and R11,200', () => {
  const r = calculateSiteFinancials({ lease_monthly: 3500 });
  assert.equal(r.outputs.amortised_cost_month, 3966.67);
  assert.equal(r.outputs.margin_pct, 21.71);
});

test('Negotiation guide at defaults: most a PSAL can offer', () => {
  const r = calculateSiteFinancials({});
  assert.equal(r.outputs.max_lease_break_even, 6782.89);
  assert.equal(r.outputs.max_lease_at_target_margin, 2246.11);
});

test('Installation team rate replaces the default', () => {
  const r = calculateSiteFinancials({ electricity_rate: 3.2, electricity_rate_set_by: 'staff-1' });
  assert.equal(r.outputs.electricity_cost_month, 4208.03);
  assert.ok(!r.flags.includes('electricity_rate_default'));
});

test('Measured kWh overrides the estimate', () => {
  const r = calculateSiteFinancials({ kwh_per_month: 2000 });
  assert.equal(r.outputs.electricity_cost_month, 9200);
  assert.equal(r.outputs.income_month, 23000);
});

test('Accepted quote clears the estimate flag', () => {
  const r = calculateSiteFinancials({ install_cost: 18500, install_cost_is_estimate: false });
  assert.ok(!r.flags.includes('install_cost_estimated'));
  assert.equal(r.outputs.install_per_month, 770.83);
});
