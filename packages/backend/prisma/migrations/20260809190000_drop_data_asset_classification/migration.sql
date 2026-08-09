-- Attribute sweep — drop DataAsset.dataClassification. The single-level
-- classification (PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED) overlapped the
-- richer sensitivityTags axis, which already carries the broad
-- confidentiality level (CONFIDENTIAL / PUBLIC) alongside the regulatory
-- categories (PII/PHI/PCI/FINANCIAL/CREDENTIAL). sensitivityTags is now the
-- sole sensitivity axis; the SILVER-tier eligibility signal keys off it.
ALTER TABLE "data_assets" DROP COLUMN "dataClassification";
