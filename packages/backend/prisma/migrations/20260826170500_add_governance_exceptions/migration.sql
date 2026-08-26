-- Governance Exceptions register: time-boxed waivers with an expiry date.
-- The Council Scorecard counts those past expiry and still ACTIVE.
CREATE TABLE "governance_exceptions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "policyId" TEXT,
    "ownerId" UUID,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "governance_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "governance_exceptions_orgId_idx" ON "governance_exceptions"("orgId");
ALTER TABLE "governance_exceptions" ADD CONSTRAINT "governance_exceptions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
