-- Business Capability: the grouping level ABOVE Data Domain, completing the
-- canonical taxonomy Business Capability -> Data Domain -> Sub-Domain -> Entity.
-- A capability gathers related data domains under one accountable owner.

-- CreateTable
CREATE TABLE "business_capabilities" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" UUID,
    "code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_capabilities_orgId_idx" ON "business_capabilities"("orgId");

-- AddForeignKey
ALTER TABLE "business_capabilities"
  ADD CONSTRAINT "business_capabilities_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_capabilities"
  ADD CONSTRAINT "business_capabilities_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "people"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: link data domains to their (optional) business capability.
-- onDelete SET NULL re-homes domains to no-capability if the capability is removed.
ALTER TABLE "data_domains" ADD COLUMN "businessCapabilityId" UUID;

ALTER TABLE "data_domains"
  ADD CONSTRAINT "data_domains_businessCapabilityId_fkey"
  FOREIGN KEY ("businessCapabilityId") REFERENCES "business_capabilities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "data_domains_businessCapabilityId_idx" ON "data_domains"("businessCapabilityId");
