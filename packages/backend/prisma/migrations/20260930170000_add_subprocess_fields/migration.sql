-- Enhanced sub-process record fields (all nullable).
ALTER TABLE "process_nodes" ADD COLUMN "entryCriteria" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "exitCriteria" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "performingOrg" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "handoffs" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "hasVariants" BOOLEAN;
