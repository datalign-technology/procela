-- Enhanced process record fields (all nullable, free-text).
ALTER TABLE "process_nodes" ADD COLUMN "businessRules" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "startPoint" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "endPoint" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "maturityLevel" TEXT;
ALTER TABLE "process_nodes" ADD COLUMN "processDiagramUrl" TEXT;
