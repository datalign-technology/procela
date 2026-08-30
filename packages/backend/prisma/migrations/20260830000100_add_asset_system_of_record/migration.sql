-- System-of-record flag on a data asset: true when this asset is the
-- authoritative golden copy others reconcile to. Existing rows default to
-- false (undeclared / a copy).
ALTER TABLE "data_assets" ADD COLUMN "isSystemOfRecord" BOOLEAN NOT NULL DEFAULT false;
