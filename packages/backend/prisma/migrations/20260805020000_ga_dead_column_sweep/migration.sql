-- GA tightening — dead-column sweep (audit §A). Pure subtraction: these
-- columns were never round-tripped by any repo mapper, read by any route,
-- or surfaced to users. See docs/GA_TIGHTENING_AUDIT.md.

-- 1. Organization.identityProviderConfig — declared only on the frontend
--    type; nothing reads it.
ALTER TABLE "organizations" DROP COLUMN "identityProviderConfig";

-- 2. System.stewardId — legacy single-steward slot, superseded by the
--    system_custodians M2M. Drop the FK column (the "SystemSteward"
--    relation goes with it).
ALTER TABLE "systems" DROP COLUMN "stewardId";

-- 3. DataAsset.rejectedSensitivityTags — shadow of sensitivityTags,
--    never populated by the mappers.
ALTER TABLE "data_assets" DROP COLUMN "rejectedSensitivityTags";

-- (Connection.systemId — audit §A#4 — is deliberately NOT in this sweep.
--  Unlike the others it is an active legacy field with a running JSON-mode
--  backfill and a toPublic strip, so retiring it is a behavior change that
--  ships as its own follow-up, not part of this pure-subtraction migration.)

-- 5. Person.department — in the row type but never round-tripped; every
--    real "department" is org-hierarchy, not this field.
ALTER TABLE "people" DROP COLUMN "department";

-- 6. Person.externalId — never round-tripped (SCIM externalId lives on
--    scim_groups). Drop the column and its orphan index.
DROP INDEX IF EXISTS "people_externalId_idx";
ALTER TABLE "people" DROP COLUMN "externalId";

-- 7. PersonSkill.level — the join createMany omits it; nothing reads it.
ALTER TABLE "person_skills" DROP COLUMN "level";

-- 8. Skill.damaRoleId — repo ignores it on read and write; no route reads
--    Skill.damaRole. Drop the FK column (the damaRole relation + the
--    reverse DamaRole.skills go with it).
ALTER TABLE "skills" DROP COLUMN "damaRoleId";
