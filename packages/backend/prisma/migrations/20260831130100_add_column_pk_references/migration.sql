-- Primary-key flag + foreign-key reference on a data-asset column.
ALTER TABLE "data_asset_columns" ADD COLUMN "isPrimaryKey" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "data_asset_columns" ADD COLUMN "keyReferences" TEXT;
