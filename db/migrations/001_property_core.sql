-- ScootHero Back Office · Property module · Phase 1 core schema
-- Postgres 14+. Run once: psql "$DATABASE_URL" -f db/migrations/001_property_core.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Enums ----------
CREATE TYPE app_role AS ENUM (
  'psal', 'property_lead', 'ceo', 'coo', 'cfo',
  'installation_manager', 'finance', 'admin'
);

-- Full workflow. Live comes before COC: Live activates the site, the COC follows,
-- and the contractor can only invoice once the COC is accepted.
CREATE TYPE property_stage AS ENUM (
  'site_captured',
  'proposal_to_check',
  'proposal_sent',
  'negotiation',
  'declined',
  'proposal_accepted',
  'lease_preparing',
  'awaiting_signature',
  'landlord_signing',
  'lease_signed',
  'quoting',
  'contractor_appointed',
  'live',
  'coc_accepted',
  'invoiced',
  'complete'
);

CREATE TYPE landlord_type AS ENUM ('company', 'independent_owner', 'franchise', 'sectional_title');

CREATE TYPE photo_kind AS ENUM ('site', 'entrance', 'electrical', 'bay', 'render', 'other');

-- ---------- People ----------
-- Staff links to the portal's existing login via portal_user_id.
CREATE TABLE staff (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text UNIQUE,
  phone           text,
  portal_user_id  text UNIQUE,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_roles (
  staff_id  uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role      app_role NOT NULL,
  PRIMARY KEY (staff_id, role)
);

-- ---------- Locations ----------
CREATE TABLE cities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  province    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cities_name_uq ON cities (lower(name));

CREATE TABLE areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX areas_city_name_uq ON areas (city_id, lower(name));

-- ---------- Landlords ----------
CREATE TABLE landlords (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        landlord_type NOT NULL DEFAULT 'company',
  reg_no      text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX landlords_name_uq ON landlords (lower(name));

CREATE TABLE landlord_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id  uuid NOT NULL REFERENCES landlords(id) ON DELETE CASCADE,
  name         text,
  email        text,
  phone        text,
  position     text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (name IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX contacts_landlord_email_uq ON landlord_contacts (landlord_id, lower(email)) WHERE email IS NOT NULL;

-- ---------- Sites ----------
CREATE TABLE sites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  stage            property_stage NOT NULL DEFAULT 'site_captured',
  psal_id          uuid REFERENCES staff(id),
  landlord_id      uuid REFERENCES landlords(id),
  contact_id       uuid REFERENCES landlord_contacts(id),
  city_id          uuid REFERENCES cities(id),
  area_id          uuid REFERENCES areas(id),
  address          text,
  lat              double precision CHECK (lat BETWEEN -90 AND 90),
  lng              double precision CHECK (lng BETWEEN -180 AND 180),
  pin_accuracy_m   real,
  pin_captured_at  timestamptz,
  first_touch_at   timestamptz,
  do_not_deploy    boolean NOT NULL DEFAULT false,
  partnership_tag  text,
  legacy_status    text,        -- AutoStatus as it was in the spreadsheet
  source           text NOT NULL DEFAULT 'app',  -- 'app' | 'import:property_sheet'
  needs_review     text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_stage_idx ON sites (stage);
CREATE INDEX sites_psal_idx ON sites (psal_id);
CREATE UNIQUE INDEX sites_name_landlord_uq ON sites (lower(name), coalesce(landlord_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- A contact on a site must belong to the site's landlord.
CREATE FUNCTION sites_contact_matches_landlord() RETURNS trigger AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM landlord_contacts c WHERE c.id = NEW.contact_id AND c.landlord_id = NEW.landlord_id
  ) THEN
    RAISE EXCEPTION 'Contact % does not belong to landlord %', NEW.contact_id, NEW.landlord_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sites_contact_landlord_chk BEFORE INSERT OR UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION sites_contact_matches_landlord();

CREATE TABLE site_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  body        text NOT NULL,
  source      text NOT NULL DEFAULT 'staff',  -- 'staff' | 'landlord_comment' | 'import'
  author_id   uuid REFERENCES staff(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind          photo_kind NOT NULL,
  blob_key      text NOT NULL,
  lat           double precision,
  lng           double precision,
  accuracy_m    real,
  taken_at      timestamptz,
  uploaded_by   uuid REFERENCES staff(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Financials ----------
-- Company-wide defaults. Every site starts from these; nulls on a site fall back to them.
CREATE TABLE cost_assumptions (
  key         text PRIMARY KEY,
  value       numeric NOT NULL,
  label       text NOT NULL,
  unit        text NOT NULL,
  updated_by  uuid REFERENCES staff(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cost_assumptions (key, value, label, unit) VALUES
  ('electricity_rate',       4.60,  'Electricity rate (installation team sets the real rate per site)', 'R/kWh'),
  ('selling_price_per_kwh', 11.50,  'Selling price of electricity', 'R/kWh'),
  ('install_cost_estimate', 11200,  'Install cost per site (estimate until a quote is accepted)', 'R'),
  ('tenure_months',            24,  'Default lease tenure', 'months'),
  ('hardware_cost_month',    1824,  'Hardware cost per site per month', 'R/month'),
  ('bikes_projected',           8,  'Bikes per site', 'bikes'),
  ('avg_km_per_bike_day',     120,  'Average km per bike per day', 'km'),
  ('battery_wh',             3240,  'Battery capacity', 'Wh'),
  ('km_per_battery',           72,  'Average km per battery', 'km'),
  ('charging_efficiency',       1,  'Share of grid kWh that reaches the battery (confirm with charger spec)', 'fraction'),
  ('days_per_month',        30.44,  'Days per month', 'days'),
  ('escalation_pct',            5,  'Default annual escalation', '%'),
  ('target_margin_pct',        30,  'Target margin used for the most a PSAL can offer', '%');

-- Per-site inputs. A null means "use the company default".
CREATE TABLE site_financials (
  site_id                  uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  lease_monthly            numeric CHECK (lease_monthly >= 0),
  tenure_months            integer CHECK (tenure_months > 0),
  lease_signed_date        date,
  lease_received_date      date,        -- landlord's lease in hand, not yet signed
  escalation_pct           numeric,
  deposit_required         boolean,
  guarantees_required      boolean,
  install_cost             numeric CHECK (install_cost >= 0),
  install_cost_is_estimate boolean NOT NULL DEFAULT true,
  hardware_cost_month      numeric,
  bikes_projected          numeric,
  avg_km_per_bike_day      numeric,
  kwh_per_month            numeric,     -- measured use; null = estimate from bikes × km × battery maths
  electricity_rate         numeric,
  electricity_rate_set_by  uuid REFERENCES staff(id),  -- installation team member who confirmed the site rate
  selling_price_per_kwh    numeric,
  updated_by               uuid REFERENCES staff(id),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ---------- Audit ----------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_type  text NOT NULL,          -- 'staff' | 'landlord' | 'contractor' | 'system' | 'import'
  actor_id    text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);

COMMIT;
