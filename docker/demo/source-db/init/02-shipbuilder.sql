-- Demo SOURCE database — Shipbuilder profile (Momentum Industries).
--
-- Operational tables for a defence/shipbuilding yard, read by the edge
-- connector the same way as the utility schema. Deliberate quality issues
-- included so measured DQ is realistic.

CREATE SCHEMA IF NOT EXISTS shipbuilder;
SET search_path TO shipbuilder;

-- ── Hull blocks (major sub-assemblies) ────────────────────────────────────
CREATE TABLE hull_blocks (
  block_id       BIGINT PRIMARY KEY,
  vessel_hull    TEXT NOT NULL,   -- e.g. DDG-142
  block_code     TEXT NOT NULL,
  stage          TEXT,            -- fabrication/assembly/outfitting/erection → IN_SET
  weight_tonnes  NUMERIC(10,2),   -- some NULL / negative → NOT_NULL, RANGE
  planned_start  DATE,
  planned_finish DATE
);
INSERT INTO hull_blocks
SELECT
  g,
  'DDG-' || (100 + (g % 12)),
  'BLK-' || lpad(g::text, 5, '0'),
  CASE WHEN g % 19 = 0 THEN NULL
       ELSE (ARRAY['fabrication','assembly','outfitting','erection'])[1 + (g % 4)] END,
  CASE WHEN g % 33 = 0 THEN NULL
       WHEN g % 200 = 0 THEN -5.0
       ELSE round((random() * 480 + 20)::numeric, 2) END,
  DATE '2024-01-15' + ((g * 5) % 600),
  DATE '2024-01-15' + ((g * 5) % 600) + 45
FROM generate_series(1, 800) AS g;

-- ── Weld inspections (NDT results) ────────────────────────────────────────
CREATE TABLE weld_inspections (
  inspection_id  BIGINT PRIMARY KEY,
  block_id       BIGINT,
  weld_id        TEXT NOT NULL,
  method         TEXT,            -- RT/UT/MT/PT/VT → IN_SET
  result         TEXT NOT NULL,   -- accept/reject/rework → IN_SET
  inspector      TEXT,            -- some NULL → NOT_NULL
  inspected_at   TIMESTAMPTZ NOT NULL
);
INSERT INTO weld_inspections
SELECT
  g,
  ((g % 800) + 1),
  'W-' || lpad(g::text, 7, '0'),
  (ARRAY['RT','UT','MT','PT','VT'])[1 + (g % 5)],
  (ARRAY['accept','accept','accept','rework','reject'])[1 + (g % 5)],
  CASE WHEN g % 27 = 0 THEN NULL ELSE 'Inspector ' || ((g % 30) + 1) END,
  TIMESTAMPTZ '2024-02-01 06:00:00+00' + (g * interval '25 minutes')
FROM generate_series(1, 4200) AS g;

-- ── Work packages (planning) ──────────────────────────────────────────────
CREATE TABLE work_packages (
  wp_id          BIGINT PRIMARY KEY,
  vessel_hull    TEXT NOT NULL,
  trade          TEXT,            -- steel/pipe/electrical/paint/hvac → IN_SET
  status         TEXT NOT NULL,   -- planned/released/in_progress/complete → IN_SET
  pct_complete   INTEGER,         -- 0..100 → NUMERIC_RANGE
  responsible    TEXT
);
INSERT INTO work_packages
SELECT
  g,
  'DDG-' || (100 + (g % 12)),
  (ARRAY['steel','pipe','electrical','paint','hvac'])[1 + (g % 5)],
  (ARRAY['planned','released','in_progress','complete'])[1 + (g % 4)],
  CASE WHEN g % 70 = 0 THEN 140 ELSE (g * 13) % 101 END,   -- rare >100 outlier
  CASE WHEN g % 21 = 0 THEN NULL ELSE 'Lead ' || ((g % 40) + 1) END
FROM generate_series(1, 1100) AS g;

-- ── Material receipts (supply chain) ──────────────────────────────────────
CREATE TABLE material_receipts (
  receipt_id     BIGINT PRIMARY KEY,
  po_number      TEXT NOT NULL,
  part_no        TEXT NOT NULL,
  qty_received   INTEGER,         -- non-negative → NUMERIC_RANGE
  uom            TEXT,            -- EA/M/KG/L → IN_SET
  received_at    TIMESTAMPTZ NOT NULL,
  cert_no        TEXT             -- material cert; some NULL → NOT_NULL
);
INSERT INTO material_receipts
SELECT
  g,
  'PO-' || lpad(((g % 600) + 1)::text, 6, '0'),
  'PN-' || lpad(((g * 37) % 9000)::text, 6, '0'),
  CASE WHEN g % 90 = 0 THEN -3 ELSE (g * 11) % 500 END,
  (ARRAY['EA','M','KG','L'])[1 + (g % 4)],
  TIMESTAMPTZ '2024-01-10 08:00:00+00' + (g * interval '40 minutes'),
  CASE WHEN g % 15 = 0 THEN NULL ELSE 'CERT-' || lpad(g::text, 7, '0') END
FROM generate_series(1, 2000) AS g;

ANALYZE;
