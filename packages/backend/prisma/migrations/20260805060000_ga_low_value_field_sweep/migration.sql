-- GA tightening — low-value field sweep (audit §C). Pure subtraction:
-- each of these columns round-tripped through its repo but had no UI
-- surface and no functional effect — no route read it for logic, no
-- screen displayed it. See docs/GA_TIGHTENING_AUDIT.md §C.
--
-- Fields with a live consumer (Agent.skillIds) and the audit-scaffolding
-- createdBy columns (mandated by the data model, pending real auth
-- attribution) are deliberately NOT in this sweep.

-- 1. FlowRelationship.condition — accepted by the create API but never
--    rendered; `label` covers the visible annotation.
ALTER TABLE "flow_relationships" DROP COLUMN "condition";

-- 2. GovernanceTask.resolution — written on completion, shown on no screen.
ALTER TABLE "governance_tasks" DROP COLUMN "resolution";

-- 3. GovernancePolicy.lastReviewDate — captured by the API; the UI shows
--    only nextReviewDate.
ALTER TABLE "governance_policies" DROP COLUMN "lastReviewDate";

-- 4. GovernanceControl.linkedDomainId / linkedSystemId — stored, never
--    shown or filtered.
ALTER TABLE "governance_controls" DROP COLUMN "linkedDomainId";
ALTER TABLE "governance_controls" DROP COLUMN "linkedSystemId";

-- 5. GlossaryTerm.relatedTerms — round-tripped but no form field or
--    display; always seeded [].
ALTER TABLE "glossary_terms" DROP COLUMN "relatedTerms";

-- 6. Sop.lastReviewedAt — accepted by the API but no form input or display.
ALTER TABLE "sops" DROP COLUMN "lastReviewedAt";

-- 7. SavedView.isShared — defaulted true, no UI toggle and no list-filter
--    enforcement; sharing is never exercised in v1.
ALTER TABLE "saved_views" DROP COLUMN "isShared";
