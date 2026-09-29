-- Promote the activity↔system join (process_node_systems) to carry a
-- reference into the system of record: the identifier that uniquely locates
-- the activity inside that system (e.g. an OMS incident-type code, a SAP
-- transaction code, an Airflow DAG id), an optional label for what the id is,
-- and an optional deep link. All nullable — a link without a reference stays
-- the common case, so existing rows need no backfill.
ALTER TABLE "process_node_systems" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "process_node_systems" ADD COLUMN "refLabel" TEXT;
ALTER TABLE "process_node_systems" ADD COLUMN "refUrl" TEXT;
