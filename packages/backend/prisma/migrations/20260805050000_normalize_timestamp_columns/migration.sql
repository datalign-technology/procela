-- Consistency (GA audit §D): ProcessVersion.changedAt and
-- SuggestionDismissal.dismissedAt were String columns holding ISO-8601
-- values while every other model uses DateTime. Normalize to
-- timestamp(3). Existing values are new Date().toISOString() output,
-- which casts cleanly. The repos already round-trip ISO strings at the
-- app layer (Date -> toISOString on read, new Date() on write), so no
-- app-visible type change.
ALTER TABLE "process_versions"
  ALTER COLUMN "changedAt" TYPE TIMESTAMP(3) USING "changedAt"::timestamp(3);

ALTER TABLE "suggestion_dismissals"
  ALTER COLUMN "dismissedAt" TYPE TIMESTAMP(3) USING "dismissedAt"::timestamp(3);
