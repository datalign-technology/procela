-- Agent-push execution for data syncs.
-- executionMode: DIRECT (backend pulls) | AGENT (on-prem connector pushes).
-- connectorId: which connector runs an AGENT sync (soft reference to connectors.id).
ALTER TABLE "sync_connections" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "sync_connections" ADD COLUMN "connectorId" UUID;

CREATE INDEX "sync_connections_connectorId_idx" ON "sync_connections" ("connectorId");
