-- Layer-2 assigned-scoping needs a per-record ownership anchor on tags
-- (they previously had none), so a CONTRIBUTOR can remove only tags they
-- created. Nullable: tags created without an authenticated author (e.g.
-- imports) carry no creator.
ALTER TABLE "tags" ADD COLUMN "createdBy" UUID;
