-- Per-tenant ROI value model for the Council Scorecard (ROI Phase 2):
-- { currency, riskCostPerItem, resolutionValuePerIssue, ownershipValuePerEntity }.
-- NULL = no model set; the scorecard stays leading-indicators only and prompts
-- the tenant to configure their own dollar assumptions in application code.
ALTER TABLE "organizations" ADD COLUMN "roiModel" JSONB;
