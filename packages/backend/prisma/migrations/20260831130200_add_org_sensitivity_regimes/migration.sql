-- Active regulatory / export-control classification regimes per tenant.
-- Defaults to all three active (back-compat with the built-in set); the
-- ADD COLUMN DEFAULT backfills existing rows to the full set too.
ALTER TABLE "organizations" ADD COLUMN "activeSensitivityRegimes" TEXT[] NOT NULL DEFAULT ARRAY['CUI','ITAR','EXPORT_CONTROLLED']::TEXT[];
