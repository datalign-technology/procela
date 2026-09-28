-- Retire the governance-program lifecycle. The program no longer has a
-- launch/pause/complete lifecycle or a phase tracker — a program is simply
-- live once its Foundation is defined — so the status flag and the launched
-- timestamp are dropped.
ALTER TABLE "governance_programs" DROP COLUMN IF EXISTS "status";
ALTER TABLE "governance_programs" DROP COLUMN IF EXISTS "launchedAt";
