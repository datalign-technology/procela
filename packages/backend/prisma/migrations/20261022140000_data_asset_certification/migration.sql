-- Data-asset certification workflow (reviewed promotion to Gold). All columns
-- nullable or defaulted so existing rows migrate without a backfill.
ALTER TABLE "data_assets" ADD COLUMN "certificationStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "data_assets" ADD COLUMN "certificationRequestedById" TEXT;
ALTER TABLE "data_assets" ADD COLUMN "certificationRequestedAt" TIMESTAMP(3);
ALTER TABLE "data_assets" ADD COLUMN "certificationReviewedById" TEXT;
ALTER TABLE "data_assets" ADD COLUMN "certificationReviewedAt" TIMESTAMP(3);
ALTER TABLE "data_assets" ADD COLUMN "certifiedUntil" TIMESTAMP(3);
ALTER TABLE "data_assets" ADD COLUMN "certificationNote" TEXT;
