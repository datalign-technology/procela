-- Saved versions of the Council Scorecard (parent org + reporting period).
-- derived = machine-computed snapshot; overrides = sparse CDO/DGL edits;
-- narrative = the two prose sections.
CREATE TABLE "council_scorecards" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdBy" TEXT,
    "derived" JSONB NOT NULL DEFAULT '{}',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "narrative" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "council_scorecards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "council_scorecards_orgId_idx" ON "council_scorecards"("orgId");
