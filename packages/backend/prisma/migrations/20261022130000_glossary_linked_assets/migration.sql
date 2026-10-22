-- Glossary term → data asset links. A soft-reference array of DataAsset ids the
-- term defines or applies to; dangling ids are tolerated and filtered on read.
-- NOT NULL with an empty-array default so existing rows migrate without a backfill.
ALTER TABLE "glossary_terms" ADD COLUMN "linkedAssetIds" TEXT[] NOT NULL DEFAULT '{}';
