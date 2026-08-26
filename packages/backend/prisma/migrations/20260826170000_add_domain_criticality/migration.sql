-- Business-criticality tier on a data domain (TIER_1 = council-critical).
-- Nullable; existing domains are unclassified until set. Drives the Council
-- Scorecard's tier-1 coverage measure.
ALTER TABLE "data_domains" ADD COLUMN "criticality" "CriticalityTier";
