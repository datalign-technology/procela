-- Enhanced activity-level fields (Process Catalog record spec, slice 4/4).
-- All nullable so existing rows migrate cleanly without a backfill.
ALTER TABLE "process_nodes" ADD COLUMN "accountableRole" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "authorityLevel" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "activityType" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "entryCondition" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "completionCriteria" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "waitBeforeNext" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "workInstructions" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "exceptions" TEXT;
-- Data-element usage table (business data touched by the activity, with CRUD).
ALTER TABLE "process_nodes" ADD COLUMN "dataElements" JSONB;
