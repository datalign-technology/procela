-- CreateTable
CREATE TABLE "scheduler_leases" (
    "id" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("id")
);
