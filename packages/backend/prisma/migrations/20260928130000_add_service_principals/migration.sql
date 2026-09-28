-- Service-principal grants: revocable, org-scoped, non-human identities an
-- external MCP agent authenticates as. The bearer is a long-lived JWT whose
-- `sub` is the row id; revocation sets `revokedAt` (the row is kept for audit).
-- The plaintext token is never stored — only `tokenPrefix` for display.
CREATE TABLE "service_principals" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdBy" TEXT,
    "tokenPrefix" TEXT,
    "lastUsedAt" TEXT,
    "revokedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_principals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_principals_orgId_idx" ON "service_principals"("orgId");
