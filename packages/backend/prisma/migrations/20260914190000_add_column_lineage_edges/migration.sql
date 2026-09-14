-- Column-level lineage edges: one source column → one target column, derived
-- from SQL query history (source='sql'), a dbt manifest ('dbt'), or drawn by
-- hand ('manual'). The asset-level companion is asset_lineage_edges; this table
-- carries the finer column grain. sourceRef is a stable provenance key the
-- reconciler prunes by, scoped to source so producers never clobber each other.
CREATE TABLE "column_lineage_edges" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "sourceColumnId" UUID NOT NULL,
    "targetColumnId" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "lastSeenAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "column_lineage_edges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "column_lineage_edges_orgId_idx" ON "column_lineage_edges"("orgId");
CREATE INDEX "column_lineage_edges_orgId_sourceRef_idx" ON "column_lineage_edges"("orgId", "sourceRef");
