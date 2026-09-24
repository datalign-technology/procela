-- Link a procedure (SOP) to the governance document it implements
-- (GovernancePolicy: charter / framework / standard / policy). Soft reference —
-- nullable, no FK constraint — so deleting the document leaves the SOP intact
-- and the link simply resolves to nothing.
ALTER TABLE "sops" ADD COLUMN "governancePolicyId" UUID;
