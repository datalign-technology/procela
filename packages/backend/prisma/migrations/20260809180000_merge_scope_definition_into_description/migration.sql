-- Merge the former "Scope Definition" field into "Description" on data
-- domains. They overlapped — both describe what the domain is — and are now
-- a single Description field.
--
-- The "scopeDefinition" column is intentionally KEPT (nullable, deprecated)
-- to avoid a destructive schema change — this migration only moves its
-- content into "description" so nothing is lost, then clears it so the two
-- values can no longer drift apart. New writes never populate it again (the
-- API folds any incoming scopeDefinition into description).
--
--   both present, distinct -> "description" \n\n "scopeDefinition"
--   only scope present      -> becomes the description
--   equal / duplicate       -> collapses to the single value

UPDATE "data_domains"
SET "description" =
  CASE
    WHEN COALESCE(NULLIF(btrim("description"), ''), '') <> ''
     AND btrim("description") <> btrim("scopeDefinition")
    THEN btrim("description") || E'\n\n' || btrim("scopeDefinition")
    ELSE btrim("scopeDefinition")
  END
WHERE COALESCE(NULLIF(btrim("scopeDefinition"), ''), '') <> '';

UPDATE "data_domains"
SET "scopeDefinition" = NULL
WHERE "scopeDefinition" IS NOT NULL;
