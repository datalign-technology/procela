-- Merge the former "SLA Target" field into "Success Measure" on process
-- nodes. Both expressed the same "what does good look like" target; they are
-- now a single "Target / SLA" field stored in "successMeasure".
--
-- The "slaTarget" column is intentionally KEPT (nullable, deprecated) to
-- avoid a destructive schema change — this migration only moves its content
-- into "successMeasure" so nothing is lost, then clears it so the two values
-- can no longer drift apart. New writes never populate it again (the API
-- folds any incoming slaTarget into successMeasure).
--
--   both present, distinct -> "successMeasure" \n\n "slaTarget"
--   only slaTarget present  -> becomes the successMeasure
--   equal / duplicate       -> collapses to the single value

UPDATE "process_nodes"
SET "successMeasure" =
  CASE
    WHEN COALESCE(NULLIF(btrim("successMeasure"), ''), '') <> ''
     AND btrim("successMeasure") <> btrim("slaTarget")
    THEN btrim("successMeasure") || E'\n\n' || btrim("slaTarget")
    ELSE btrim("slaTarget")
  END
WHERE COALESCE(NULLIF(btrim("slaTarget"), ''), '') <> '';

UPDATE "process_nodes"
SET "slaTarget" = NULL
WHERE "slaTarget" IS NOT NULL;
