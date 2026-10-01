-- Per-tenant governance policy: when true, a process-catalog node cannot be
-- moved to APPROVED or ACTIVE until all of its "required before activation"
-- fields are filled. Default false preserves the shipped advisory behaviour.
ALTER TABLE "organizations" ADD COLUMN "requireFieldsForActivation" BOOLEAN NOT NULL DEFAULT false;
