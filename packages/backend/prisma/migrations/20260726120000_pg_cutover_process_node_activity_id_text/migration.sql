-- process_nodes.activityId holds human-readable ids (e.g. "VS-0001"), not
-- UUIDs. It was mistyped as uuid, which made every process-node insert fail on
-- Postgres. Widen it to text. Existing uuid values cast cleanly to text.
ALTER TABLE "process_nodes" ALTER COLUMN "activityId" TYPE TEXT USING "activityId"::TEXT;
