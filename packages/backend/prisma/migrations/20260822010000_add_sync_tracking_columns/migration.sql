-- Data-sync tracking columns (soft reference to a SyncConnection, no FK) so a
-- sync run can update its own prior rows and mark those missing from the
-- latest source. Nullable; existing rows default to NULL (never synced).
ALTER TABLE "organizations" ADD COLUMN "syncConnectionId" TEXT, ADD COLUMN "syncStatus" TEXT;
ALTER TABLE "people"        ADD COLUMN "syncConnectionId" TEXT, ADD COLUMN "syncStatus" TEXT;
ALTER TABLE "systems"       ADD COLUMN "syncConnectionId" TEXT, ADD COLUMN "syncStatus" TEXT;
ALTER TABLE "glossary_terms" ADD COLUMN "syncConnectionId" TEXT, ADD COLUMN "syncStatus" TEXT;
