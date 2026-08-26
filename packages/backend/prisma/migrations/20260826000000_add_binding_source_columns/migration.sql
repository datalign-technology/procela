-- A DataAssetBinding can now bind to a named SET of columns, not just one.
-- sourceColumns holds the column set (empty array = the whole source asset);
-- the legacy scalar sourceColumn is retained and mirrors sourceColumns[0] so
-- single-column consumers (DQ pushdown, lineage) keep working unchanged.
ALTER TABLE "data_asset_bindings"
  ADD COLUMN "sourceColumns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: existing single-column bindings become one-element sets.
UPDATE "data_asset_bindings"
  SET "sourceColumns" = ARRAY["sourceColumn"]
  WHERE "sourceColumn" IS NOT NULL AND "sourceColumn" <> '';
