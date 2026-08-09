-- Merge the former "Business Outcome" field into "Purpose" on process
-- nodes. Purpose and Business Outcome were two overlapping "why does this
-- exist" fields; they are now a single Purpose field.
--
-- The "businessOutcome" column is intentionally KEPT (nullable, deprecated)
-- to avoid a destructive schema change — this migration only moves its
-- content into "purpose" so nothing is lost, then clears it so the two
-- values can no longer drift apart. New writes never populate it again
-- (the API folds any incoming businessOutcome into purpose).
--
--   both present, distinct -> "purpose" \n\n "businessOutcome"
--   only outcome present    -> becomes the purpose
--   equal / duplicate       -> collapses to the single value

UPDATE "process_nodes"
SET "purpose" =
  CASE
    WHEN COALESCE(NULLIF(btrim("purpose"), ''), '') <> ''
     AND btrim("purpose") <> btrim("businessOutcome")
    THEN btrim("purpose") || E'\n\n' || btrim("businessOutcome")
    ELSE btrim("businessOutcome")
  END
WHERE COALESCE(NULLIF(btrim("businessOutcome"), ''), '') <> '';

UPDATE "process_nodes"
SET "businessOutcome" = NULL
WHERE "businessOutcome" IS NOT NULL;
