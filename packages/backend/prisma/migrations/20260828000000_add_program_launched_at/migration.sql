-- Actual go-live timestamp for a governance program. Set automatically the
-- first time the program transitions to ACTIVE and preserved thereafter
-- (pause/resume/reopen never overwrite it). Nullable — a program that has
-- never launched has no launchedAt.
ALTER TABLE "governance_programs" ADD COLUMN "launchedAt" TIMESTAMP(3);
