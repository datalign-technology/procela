-- Report folders: organize reports and drive their audience. A report in a
-- `shared` folder (the system "Public" folder, or a user folder toggled
-- shared) is org-visible; anything else is private to its owner. The system
-- Public folder is ensured per org at runtime, not seeded here.
CREATE TABLE "report_folders" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'user',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_folders_orgId_idx" ON "report_folders"("orgId");

-- Organizing folder for a report. NULL = uncategorized ("My Reports"),
-- private to its owner.
ALTER TABLE "reports" ADD COLUMN "folderId" UUID;

CREATE INDEX "reports_folderId_idx" ON "reports"("folderId");
