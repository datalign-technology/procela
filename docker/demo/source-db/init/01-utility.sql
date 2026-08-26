-- Demo SOURCE database — Utility profile (Tidewater Utilities).
--
-- This is NOT Procela's own store. It stands in for a customer's operational
-- database that the on-prem edge connector reads: the connector discovers these
-- tables/columns and runs data-quality rules against them, pushing back only
-- aggregate counts (never row values).
--
-- A few columns carry DELIBERATE quality issues (nulls, out-of-range, bad
-- format, duplicates) so measured DQ shows realistic, non-100% results.

CREATE SCHEMA IF NOT EXISTS utility;
SET search_path TO utility;

-- ── Billing accounts ──────────────────────────────────────────────────────
CREATE TABLE billing_accounts (
  account_id     BIGINT PRIMARY KEY,
  customer_name  TEXT NOT NULL,
  email          TEXT,            -- some NULL / malformed → NOT_NULL, REGEX
  service_class  TEXT,            -- residential/commercial/industrial → IN_SET
  balance_cents  BIGINT,          -- occasional negative outliers → NUMERIC_RANGE
  opened_on      DATE
);
INSERT INTO billing_accounts
SELECT
  g,
  'Customer ' || g,
  CASE
    WHEN g % 17 = 0 THEN NULL                       -- ~6% null emails
    WHEN g % 23 = 0 THEN 'not-an-email'             -- ~4% malformed
    ELSE 'cust' || g || '@example.com'
  END,
  (ARRAY['residential','commercial','industrial'])[1 + (g % 3)],
  CASE WHEN g % 50 = 0 THEN -500 ELSE (g * 137) % 250000 END,  -- ~2% negative
  DATE '2018-01-01' + ((g * 7) % 2500)
FROM generate_series(1, 1200) AS g;

-- ── AMI meter reads ───────────────────────────────────────────────────────
CREATE TABLE meter_reads (
  read_id       BIGINT PRIMARY KEY,
  meter_id      TEXT NOT NULL,
  account_id    BIGINT,
  read_kwh      NUMERIC(10,2),   -- some NULL / negative → NOT_NULL, RANGE
  read_at       TIMESTAMPTZ NOT NULL,
  quality_flag  TEXT             -- estimated/actual/missing → IN_SET
);
INSERT INTO meter_reads
SELECT
  g,
  'MTR-' || lpad(((g % 1200) + 1)::text, 6, '0'),
  ((g % 1200) + 1),
  CASE WHEN g % 40 = 0 THEN NULL
       WHEN g % 111 = 0 THEN -12.5           -- rare negative reading
       ELSE round((random() * 90 + 2)::numeric, 2) END,
  TIMESTAMPTZ '2024-01-01 00:00:00+00' + (g * interval '15 minutes'),
  (ARRAY['actual','actual','actual','estimated','missing'])[1 + (g % 5)]
FROM generate_series(1, 5000) AS g;

-- ── Outage / SCADA events ─────────────────────────────────────────────────
CREATE TABLE outage_events (
  event_id       BIGINT PRIMARY KEY,
  feeder_id      TEXT NOT NULL,
  cause_code     TEXT,           -- weather/equipment/vegetation/unknown → IN_SET
  customers_out  INTEGER,        -- non-negative → NUMERIC_RANGE
  started_at     TIMESTAMPTZ NOT NULL,
  restored_at    TIMESTAMPTZ
);
INSERT INTO outage_events
SELECT
  g,
  'FDR-' || lpad(((g % 80) + 1)::text, 4, '0'),
  CASE WHEN g % 13 = 0 THEN NULL
       ELSE (ARRAY['weather','equipment','vegetation','unknown'])[1 + (g % 4)] END,
  (g * 7) % 4000,
  TIMESTAMPTZ '2024-02-01 00:00:00+00' + (g * interval '3 hours'),
  CASE WHEN g % 9 = 0 THEN NULL   -- still-open outages
       ELSE TIMESTAMPTZ '2024-02-01 00:00:00+00' + (g * interval '3 hours') + interval '90 minutes' END
FROM generate_series(1, 900) AS g;

-- ── Field work orders ─────────────────────────────────────────────────────
CREATE TABLE work_orders (
  wo_id         BIGINT PRIMARY KEY,
  crew_id       TEXT NOT NULL,
  wo_type       TEXT,            -- inspection/repair/install/disconnect → IN_SET
  status        TEXT NOT NULL,   -- open/in_progress/closed → IN_SET
  priority      INTEGER,         -- 1..5 → NUMERIC_RANGE
  created_on    DATE NOT NULL
);
INSERT INTO work_orders
SELECT
  g,
  'CREW-' || lpad(((g % 24) + 1)::text, 3, '0'),
  (ARRAY['inspection','repair','install','disconnect'])[1 + (g % 4)],
  (ARRAY['open','in_progress','closed','closed'])[1 + (g % 4)],
  CASE WHEN g % 60 = 0 THEN 9 ELSE 1 + (g % 5) END,   -- rare out-of-range priority
  DATE '2024-01-05' + ((g * 3) % 400)
FROM generate_series(1, 1500) AS g;

ANALYZE;
