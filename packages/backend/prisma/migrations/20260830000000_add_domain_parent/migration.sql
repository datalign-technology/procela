-- Sub-domain nesting: an optional self-referential parent on a data domain.
-- A domain with a parentDomainId is a sub-domain; nesting is one level deep
-- (enforced in the application layer). onDelete SET NULL re-homes children to
-- top-level if their parent is deleted.
ALTER TABLE "data_domains" ADD COLUMN "parentDomainId" UUID;

ALTER TABLE "data_domains"
  ADD CONSTRAINT "data_domains_parentDomainId_fkey"
  FOREIGN KEY ("parentDomainId") REFERENCES "data_domains"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "data_domains_parentDomainId_idx" ON "data_domains"("parentDomainId");
