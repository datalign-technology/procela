-- Per-tenant Council Scorecard thresholds ({ coverage, classification,
-- openIssues, exceptions, openIssuesDays }). NULL falls back to the shipped
-- defaults (80 / 70 / 0 / 0 / 30) in application code.
ALTER TABLE "organizations" ADD COLUMN "scorecardTargets" JSONB;
