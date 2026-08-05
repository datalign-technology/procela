-- Retire Connection.systemId (GA audit §A#4). The legacy single-system
-- link is superseded by the connection_system_links join table. The
-- column is no longer written (create/update persist links, not this
-- column) or emitted (toPublic strips it) — only read by a one-time
-- backfill. Seed any not-yet-linked (connection, system) pair from the
-- legacy column first, THEN drop it. The FK constraint drops with it.
INSERT INTO "connection_system_links" ("id", "orgId", "connectionId", "systemId", "createdAt")
SELECT gen_random_uuid(), c."orgId", c."id", c."systemId", NOW()
FROM "connections" c
WHERE c."systemId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "connection_system_links" l
    WHERE l."connectionId" = c."id" AND l."systemId" = c."systemId"
  );

ALTER TABLE "connections" DROP COLUMN "systemId";
