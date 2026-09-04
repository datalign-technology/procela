-- Activity BCM/operational attributes: Recovery Point Objective (pairs with
-- rtoHours), the initiating trigger, and processing volume/throughput.
ALTER TABLE "process_nodes"
  ADD COLUMN "rpoHours" INTEGER,
  ADD COLUMN "trigger" TEXT,
  ADD COLUMN "volume" TEXT;
