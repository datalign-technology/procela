-- Layer-2 assigned-scoping needs a per-record ownership anchor on
-- operations_manuals (it previously had none). Nullable: seeded standard
-- manuals are org-wide reference content with no owner. Mirrors the
-- ownerPersonId column already on sops and glossary_terms.
ALTER TABLE "operations_manuals" ADD COLUMN "ownerPersonId" UUID;
