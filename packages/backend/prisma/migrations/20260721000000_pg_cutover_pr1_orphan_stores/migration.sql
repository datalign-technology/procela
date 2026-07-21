-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "scim_groups" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalId" TEXT,
    "members" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scim_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raci_overrides" (
    "nodeId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "raci_overrides_pkey" PRIMARY KEY ("nodeId","personId")
);

-- CreateTable
CREATE TABLE "dbt_asset_mappings" (
    "orgId" TEXT NOT NULL,
    "dbtUniqueId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "dbt_asset_mappings_pkey" PRIMARY KEY ("orgId","dbtUniqueId")
);

-- CreateTable
CREATE TABLE "dbt_test_mappings" (
    "orgId" TEXT NOT NULL,
    "dbtUniqueId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,

    CONSTRAINT "dbt_test_mappings_pkey" PRIMARY KEY ("orgId","dbtUniqueId")
);

-- CreateIndex
CREATE INDEX "dbt_asset_mappings_orgId_idx" ON "dbt_asset_mappings"("orgId");

-- CreateIndex
CREATE INDEX "dbt_test_mappings_orgId_idx" ON "dbt_test_mappings"("orgId");

