-- Structured source-key pointer on activity↔system links: the discovered
-- field in the connected source that uniquely identifies the activity's
-- records (the alternative to the free-text externalRef). All nullable.
ALTER TABLE "process_node_systems" ADD COLUMN "sourceConnectionId" TEXT;
ALTER TABLE "process_node_systems" ADD COLUMN "sourceAsset" TEXT;
ALTER TABLE "process_node_systems" ADD COLUMN "sourceColumn" TEXT;
ALTER TABLE "process_node_systems" ADD COLUMN "isKey" BOOLEAN;
