-- Enhanced value-stream record fields + cross-cutting governance-lifecycle
-- dates (all nullable, free-text — matching the existing nextReviewDate).
ALTER TABLE "process_nodes" ADD COLUMN "customerType" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "valueProposition" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "executiveSponsor" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "businessCapabilities" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "endState" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "effectiveDate" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "lastReviewedDate" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "reviewCadence" TEXT;
