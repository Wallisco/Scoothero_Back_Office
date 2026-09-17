-- ScootHero Back Office · Property module · station spec and electrical quote templates
-- Run after 001_property_core.sql

BEGIN;

-- ---------- Swap station models ----------
CREATE TABLE station_models (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  height_m     numeric NOT NULL,
  width_m      numeric NOT NULL,
  depth_m      numeric NOT NULL,
  bays         integer NOT NULL,           -- battery compartments
  supply_1ph_a integer,                    -- single-phase supply required (amps)
  supply_3ph_a integer,                    -- three-phase supply required (amps per phase)
  render_png   text NOT NULL,              -- blob key / asset path, transparent background
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO station_models (name, height_m, width_m, depth_m, bays, supply_1ph_a, supply_3ph_a, render_png)
VALUES ('ScootHero 9-bay swap station', 1.80, 1.05, 0.85, 9, 50, 25, 'assets/swap-station.png');

ALTER TABLE sites ADD COLUMN station_model_id uuid REFERENCES station_models(id);

-- ---------- Renders ----------
CREATE TABLE site_renders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  photo_id         uuid NOT NULL REFERENCES site_photos(id),
  station_model_id uuid NOT NULL REFERENCES station_models(id),
  scale            jsonb NOT NULL,          -- { type: 'bay'|'height', points, metres }
  base             jsonb NOT NULL,          -- { x, y }
  px_per_metre     numeric NOT NULL,
  blob_key         text NOT NULL,
  is_current       boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES staff(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_renders_current_uq ON site_renders (site_id) WHERE is_current;

-- ---------- Contractors and quotes ----------
CREATE TYPE supply_type AS ENUM ('single_phase_50a', 'three_phase_25a');
CREATE TYPE quote_status AS ENUM ('sent', 'viewed', 'submitted', 'accepted', 'declined', 'expired');
CREATE TYPE line_unit AS ENUM ('each', 'metre', 'lump_sum');

CREATE TABLE contractors (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  reg_no               text,
  vat_no               text,
  electrical_reg_no    text,              -- registration needed to issue a COC
  email                text NOT NULL,
  phone                text,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Standard scope every contractor prices. Wording shown on the quote page.
CREATE TABLE quote_line_templates (
  code          text PRIMARY KEY,
  sort          integer NOT NULL,
  description   text NOT NULL,
  unit          line_unit NOT NULL,
  applies_to    supply_type,              -- null = both supply types
  required      boolean NOT NULL DEFAULT true,
  photo_required boolean NOT NULL DEFAULT false,
  guidance      text
);

INSERT INTO quote_line_templates (code, sort, description, unit, applies_to, required, photo_required, guidance) VALUES
 ('SUPPLY_1PH_50A', 10, 'Single-phase 50 A supply to the swap station', 'lump_sum', 'single_phase_50a', true, false,
   'Price this if the site supplies single phase. Choose single or three phase at the top of the quote.'),
 ('SUPPLY_3PH_25A', 10, 'Three-phase 25 A supply to the swap station', 'lump_sum', 'three_phase_25a', true, false,
   'Price this if the site supplies three phase.'),
 ('METER_3PH',      20, 'Metered point on the supply side (three phase)', 'each', 'three_phase_25a', true, true,
   'Required for every three-phase installation. Photograph the proposed meter position.'),
 ('BREAKER_DB',     30, 'Breaker sized to the supply, terminating in the DB the supply is taken from', 'each', NULL, true, true,
   'Photograph the DB with the door open and the breaker space you will use.'),
 ('CABLE_SURFACE',  40, 'Cable, surface run (preferred), including containment and fixings', 'metre', NULL, true, false,
   'Enter the metres from the DB to the station position. Surface run is preferred wherever the site allows.'),
 ('CABLE_OTHER',    50, 'Cable where a surface run is not possible (trenched, ducted or overhead)', 'metre', NULL, false, true,
   'Only if a surface run cannot be done. Explain why in the note and photograph the route.'),
 ('CIVILS',         60, 'Civil works (trenching, core drilling, making good, plinth)', 'lump_sum', NULL, false, true,
   'Describe every civil item in the note and photograph each one.'),
 ('LABOUR',         70, 'Installation labour and connection of the station', 'lump_sum', NULL, true, false, NULL),
 ('COC',            80, 'Certificate of Compliance for the installation', 'lump_sum', NULL, true, false,
   'A COC is required for every installation. It may be issued a few days after the site goes live.');

CREATE TABLE quote_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  contractor_id   uuid NOT NULL REFERENCES contractors(id),
  status          quote_status NOT NULL DEFAULT 'sent',
  token_hash      text NOT NULL,
  expires_at      timestamptz NOT NULL,
  supply          supply_type,                 -- chosen by the contractor on site
  db_to_station_m numeric,
  surface_run_possible boolean,
  civils_note     text,
  earliest_date   date,
  validity_days   integer,
  vat_registered  boolean,
  subtotal        numeric,
  vat             numeric,
  total           numeric,
  submitted_at    timestamptz,
  decided_at      timestamptz,
  decided_by      uuid REFERENCES staff(id),
  created_by      uuid REFERENCES staff(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_requests_site_idx ON quote_requests (site_id);

CREATE TABLE quote_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id  uuid NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  template_code     text REFERENCES quote_line_templates(code),   -- null = contractor-added line
  description       text NOT NULL,
  unit              line_unit NOT NULL,
  qty               numeric NOT NULL CHECK (qty >= 0),
  unit_price        numeric NOT NULL CHECK (unit_price >= 0),
  line_total        numeric GENERATED ALWAYS AS (qty * unit_price) STORED,
  note              text
);

CREATE TABLE quote_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id  uuid NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  template_code     text REFERENCES quote_line_templates(code),
  blob_key          text NOT NULL,
  caption           text,
  lat               double precision,
  lng               double precision,
  taken_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMIT;
