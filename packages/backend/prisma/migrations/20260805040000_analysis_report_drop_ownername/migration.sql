-- Consolidation (GA audit §B): AnalysisReport denormalized the owner's
-- name alongside ownerId, unlike its sibling Report (ownerId only). Drop
-- the denormalized column — the API now derives the display name from
-- ownerId via a people join. No backfill: the name is resolved live.
ALTER TABLE "analysis_reports" DROP COLUMN "ownerName";
