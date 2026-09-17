'use strict';

/**
 * Site financials — single source of truth for the lease pack, site page and reports.
 * Matches the formulas in ScootHero_CRM_Site_List_corrected.xlsx.
 *
 * Inputs: per-site values (site_financials row) layered over company defaults
 * (cost_assumptions). A null/undefined site value falls back to the default.
 *
 * Decisions (CEO, 16 Sep 2026):
 *  - Electricity rate R4.60/kWh default; installation team sets the real site rate.
 *  - Selling price R11.50/kWh.
 *  - Defaults: 24-month lease, R11,200 install (estimate until a quote is accepted).
 *  - Battery 3,240 Wh, 72 km per battery → 0.045 kWh per km.
 *  - Cost of site = lease + install ÷ tenure + hardware + electricity.
 */

const DEFAULTS = Object.freeze({
  electricity_rate: 4.6,
  selling_price_per_kwh: 11.5,
  install_cost_estimate: 11200,
  tenure_months: 24,
  hardware_cost_month: 1824,
  bikes_projected: 8,
  avg_km_per_bike_day: 120,
  battery_wh: 3240,
  km_per_battery: 72,
  charging_efficiency: 1.0,
  days_per_month: 30.44,
  escalation_pct: 5,
  target_margin_pct: 30,
});

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pick = (site, key, d, defaultKey = key) => { const v = num(site[key]); return v !== null ? v : num(d[defaultKey]); };
const round2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

function calculateSiteFinancials(site = {}, defaults = DEFAULTS) {
  const d = { ...DEFAULTS, ...Object.fromEntries(Object.entries(defaults).filter(([, v]) => num(v) !== null)) };

  const i = {
    lease_monthly: num(site.lease_monthly) ?? 0,
    tenure_months: pick(site, 'tenure_months', d),
    install_cost: pick(site, 'install_cost', d, 'install_cost_estimate'),
    install_cost_is_estimate: site.install_cost_is_estimate !== false,
    hardware_cost_month: pick(site, 'hardware_cost_month', d),
    bikes_projected: pick(site, 'bikes_projected', d),
    avg_km_per_bike_day: pick(site, 'avg_km_per_bike_day', d),
    kwh_per_km: num(d.battery_wh) / 1000 / num(d.km_per_battery),
    charging_efficiency: num(d.charging_efficiency) || 1,
    electricity_rate: pick(site, 'electricity_rate', d),
    electricity_rate_is_default: num(site.electricity_rate) === null || !site.electricity_rate_set_by,
    selling_price_per_kwh: pick(site, 'selling_price_per_kwh', d),
    days_per_month: num(d.days_per_month),
    target_margin_pct: num(d.target_margin_pct),
  };

  // Energy: measured kWh (if the installation team enters it) beats the estimate.
  const kwh_delivered_month = num(site.kwh_per_month) !== null
    ? num(site.kwh_per_month) * i.charging_efficiency
    : i.bikes_projected * i.avg_km_per_bike_day * i.kwh_per_km * i.days_per_month;
  const kwh_grid_month = kwh_delivered_month / i.charging_efficiency;
  const swaps_per_bike_day = i.avg_km_per_bike_day / num(d.km_per_battery);

  const tenure = i.tenure_months > 0 ? i.tenure_months : null;
  const install_per_month = tenure ? i.install_cost / tenure : null;
  const amortised_cost_month = tenure ? i.lease_monthly + install_per_month : null;
  const fixed_cost_day = amortised_cost_month !== null ? amortised_cost_month / i.days_per_month : null;
  const electricity_cost_month = kwh_grid_month * i.electricity_rate;
  const cost_incl_hardware_month = amortised_cost_month !== null ? amortised_cost_month + i.hardware_cost_month + electricity_cost_month : null;
  const income_month = kwh_delivered_month * i.selling_price_per_kwh;
  const margin_pct = cost_incl_hardware_month !== null && income_month > 0 ? ((income_month - cost_incl_hardware_month) / income_month) * 100 : null;

  const margin_per_kwh_sold = i.selling_price_per_kwh - i.electricity_rate / i.charging_efficiency;
  const breakeven_kwh_excl_hardware = amortised_cost_month !== null && margin_per_kwh_sold > 0 ? amortised_cost_month / margin_per_kwh_sold : null;
  const breakeven_kwh_incl_hardware = amortised_cost_month !== null && margin_per_kwh_sold > 0 ? (amortised_cost_month + i.hardware_cost_month) / margin_per_kwh_sold : null;
  const kwh_per_bike_month = i.bikes_projected > 0 ? kwh_delivered_month / i.bikes_projected : null;
  const breakeven_bikes = breakeven_kwh_incl_hardware !== null && kwh_per_bike_month ? breakeven_kwh_incl_hardware / kwh_per_bike_month : null;

  // Negotiation guide: the most a PSAL can offer before the margin drops below target / zero.
  const cost_before_lease = tenure ? install_per_month + i.hardware_cost_month + electricity_cost_month : null;
  const max_lease_at_target = cost_before_lease !== null ? income_month * (1 - i.target_margin_pct / 100) - cost_before_lease : null;
  const max_lease_break_even = cost_before_lease !== null ? income_month - cost_before_lease : null;

  const flags = [];
  if (!tenure) flags.push('no_tenure');
  if (i.install_cost_is_estimate) flags.push('install_cost_estimated');
  if (i.electricity_rate_is_default) flags.push('electricity_rate_default');
  if (margin_per_kwh_sold <= 0) flags.push('selling_price_not_above_cost');
  if (margin_pct !== null && margin_pct < 0) flags.push('loss_making');
  if (margin_pct !== null && margin_pct < i.target_margin_pct) flags.push('below_target_margin');

  return {
    inputs: { ...i, swaps_per_bike_day: round2(swaps_per_bike_day) },
    outputs: {
      kwh_delivered_month: round2(kwh_delivered_month),
      kwh_grid_month: round2(kwh_grid_month),
      lease_cost_over_tenure: tenure ? round2(i.lease_monthly * tenure) : null,
      install_per_month: round2(install_per_month),
      amortised_cost_month: round2(amortised_cost_month),
      fixed_cost_day: round2(fixed_cost_day),
      electricity_cost_month: round2(electricity_cost_month),
      hardware_cost_month: round2(i.hardware_cost_month),
      cost_incl_hardware_month: round2(cost_incl_hardware_month),
      income_month: round2(income_month),
      margin_pct: round2(margin_pct),
      breakeven_kwh_excl_hardware: round2(breakeven_kwh_excl_hardware),
      breakeven_kwh_incl_hardware: round2(breakeven_kwh_incl_hardware),
      breakeven_bikes: round2(breakeven_bikes),
      max_lease_at_target_margin: round2(max_lease_at_target),
      max_lease_break_even: round2(max_lease_break_even),
    },
    flags,
  };
}

module.exports = { calculateSiteFinancials, DEFAULTS };
