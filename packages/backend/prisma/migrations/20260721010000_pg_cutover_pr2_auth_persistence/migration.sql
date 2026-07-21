-- CreateTable
CREATE TABLE "refresh_tokens" (
    "jti" TEXT NOT NULL,
    "personId" TEXT,
    "oidcProviderId" TEXT,
    "oidcIdToken" TEXT,
    "samlNameID" TEXT,
    "samlSessionIndex" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TEXT,
    "lastUsedAt" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "oidc_providers" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "allowedEmailDomains" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oidc_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refresh_tokens_personId_idx" ON "refresh_tokens"("personId");

