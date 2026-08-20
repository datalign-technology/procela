-- CreateTable
CREATE TABLE "stats_snapshots" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "capturedAt" TEXT NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "avgHealth" DOUBLE PRECISION NOT NULL,
    "gaps" INTEGER NOT NULL,
    "dataAssets" INTEGER NOT NULL,
    "mappings" INTEGER NOT NULL,

    CONSTRAINT "stats_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stats_snapshots_orgId_idx" ON "stats_snapshots"("orgId");
