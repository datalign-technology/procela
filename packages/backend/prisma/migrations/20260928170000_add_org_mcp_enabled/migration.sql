-- Per-tenant MCP enablement flag on the organization. Nullable on purpose:
-- NULL = not set → inherit from an ancestor (the resolver walks up the org
-- tree), which a NOT NULL default would break by stopping the walk at every
-- row. true / false = an explicit opt-in / opt-out.
ALTER TABLE "organizations" ADD COLUMN "mcpEnabled" BOOLEAN;
