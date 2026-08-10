-- Store the connector-reported row count on the data asset. The on-prem
-- connector already ships `rowCount` on every /connectors/report scan
-- (engine statistics — n_live_tup / partition stats / TABLE_ROWS /
-- num_rows), but the ingest handler parsed and dropped it. Give it a home.
-- BIGINT so billion-row fact tables don't overflow a 32-bit INT. Nullable:
-- null until a connector reports one (manually-created assets stay null).
ALTER TABLE "data_assets" ADD COLUMN "rowCount" BIGINT;
