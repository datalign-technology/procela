-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('COMPANY', 'DIVISION', 'DEPARTMENT', 'TEAM', 'UNIT');

-- CreateEnum
CREATE TYPE "StatusMode" AS ENUM ('SIMPLE', 'REVIEW', 'ADVANCED');

-- CreateEnum
CREATE TYPE "NodeLevel" AS ENUM ('VALUE_STREAM', 'DOMAIN', 'CAPABILITY', 'PROCESS', 'SUBPROCESS', 'ACTIVITY', 'TASK', 'EXECUTION');

-- CreateEnum
CREATE TYPE "NodeDomain" AS ENUM ('OPERATIONAL', 'GOVERNANCE');

-- CreateEnum
CREATE TYPE "CriticalityTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3', 'TIER_4');

-- CreateEnum
CREATE TYPE "GovernanceTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'WARNING', 'ACTION');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'COMPANY',
    "industry" TEXT,
    "description" TEXT,
    "headCount" INTEGER NOT NULL DEFAULT 0,
    "statusMode" "StatusMode" NOT NULL DEFAULT 'SIMPLE',
    "tenantSlug" TEXT,
    "brandDisplayName" TEXT,
    "brandGlyph" TEXT,
    "ssoButtonLabel" TEXT,
    "brandPrimaryColor" TEXT,
    "identityProviderConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT,
    "externalId" TEXT,
    "title" TEXT,
    "jobRole" TEXT,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "orgRoles" JSONB,
    "passwordHash" TEXT,
    "passwordUpdatedAt" TIMESTAMP(3),
    "passwordMustChange" BOOLEAN,
    "failedLoginCount" INTEGER,
    "failedLoginFirstAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "mfaSecret" TEXT,
    "mfaEnrolled" BOOLEAN,
    "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webauthnCredentials" JSONB,
    "accessibleOrgIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_orgs" (
    "personId" UUID NOT NULL,
    "orgId" UUID NOT NULL,

    CONSTRAINT "person_orgs_pkey" PRIMARY KEY ("personId","orgId")
);

-- CreateTable
CREATE TABLE "process_nodes" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "level" "NodeLevel" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orgId" UUID NOT NULL,
    "ownerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "activityId" UUID,
    "responsibleRole" TEXT,
    "responsiblePersonId" UUID,
    "purpose" TEXT,
    "businessOutcome" TEXT,
    "stakeholders" TEXT,
    "inputsOutputs" TEXT,
    "complianceTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statusJustification" TEXT,
    "frequency" TEXT,
    "riskLevel" TEXT,
    "automationLevel" TEXT,
    "estimatedDuration" TEXT,
    "criticalityTier" "CriticalityTier",
    "rtoHours" INTEGER,
    "successMeasure" TEXT,
    "slaTarget" TEXT,
    "domain" "NodeDomain" NOT NULL DEFAULT 'OPERATIONAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedBy" UUID,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_node_orgs" (
    "processNodeId" UUID NOT NULL,
    "orgId" UUID NOT NULL,

    CONSTRAINT "process_node_orgs_pkey" PRIMARY KEY ("processNodeId","orgId")
);

-- CreateTable
CREATE TABLE "process_node_controls" (
    "processNodeId" UUID NOT NULL,
    "controlId" UUID NOT NULL,

    CONSTRAINT "process_node_controls_pkey" PRIMARY KEY ("processNodeId","controlId")
);

-- CreateTable
CREATE TABLE "process_node_skills" (
    "processNodeId" UUID NOT NULL,
    "skillId" UUID NOT NULL,

    CONSTRAINT "process_node_skills_pkey" PRIMARY KEY ("processNodeId","skillId")
);

-- CreateTable
CREATE TABLE "process_node_systems" (
    "processNodeId" UUID NOT NULL,
    "systemId" UUID NOT NULL,

    CONSTRAINT "process_node_systems_pkey" PRIMARY KEY ("processNodeId","systemId")
);

-- CreateTable
CREATE TABLE "systems" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemType" TEXT,
    "businessCriticality" TEXT,
    "vendor" TEXT,
    "integrationPoints" TEXT,
    "integrations" JSONB,
    "connectivity" TEXT,
    "ownerPersonId" UUID,
    "deputyOwnerId" UUID,
    "stewardId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_custodians" (
    "systemId" UUID NOT NULL,
    "personId" UUID NOT NULL,

    CONSTRAINT "system_custodians_pkey" PRIMARY KEY ("systemId","personId")
);

-- CreateTable
CREATE TABLE "data_domains" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" UUID,
    "scopeDefinition" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_domain_stewards" (
    "dataDomainId" UUID NOT NULL,
    "personId" UUID NOT NULL,

    CONSTRAINT "data_domain_stewards_pkey" PRIMARY KEY ("dataDomainId","personId")
);

-- CreateTable
CREATE TABLE "data_assets" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemId" UUID,
    "ownerPersonId" UUID,
    "dataDomainId" UUID,
    "governanceTier" "GovernanceTier" NOT NULL DEFAULT 'BRONZE',
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "healthScoreAt" TIMESTAMP(3),
    "sensitivityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejectedSensitivityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataClassification" TEXT,
    "dataType" TEXT,
    "refreshFrequency" TEXT,
    "origin" TEXT,
    "retentionDuration" JSONB,
    "retentionReason" TEXT,
    "lastSyncedByConnectorId" UUID,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_asset_stewards" (
    "dataAssetId" UUID NOT NULL,
    "personId" UUID NOT NULL,

    CONSTRAINT "data_asset_stewards_pkey" PRIMARY KEY ("dataAssetId","personId")
);

-- CreateTable
CREATE TABLE "data_asset_bindings" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "dataAssetId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "sourceAsset" TEXT NOT NULL,
    "sourceColumn" TEXT,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_asset_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mappings" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "processStepId" UUID NOT NULL,
    "dataAssetId" UUID,
    "policyId" UUID,
    "attachmentId" UUID,
    "linkType" TEXT,
    "notes" TEXT,
    "aiSuggested" BOOLEAN NOT NULL DEFAULT false,
    "userOverridden" BOOLEAN NOT NULL DEFAULT false,
    "criticality" TEXT,
    "dataFormat" TEXT,
    "sla" TEXT,
    "qualityRequirement" TEXT,
    "fulfillsExpected" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "damaRoleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_skills" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "level" TEXT,

    CONSTRAINT "person_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dama_roles" (
    "id" UUID NOT NULL,
    "personId" UUID,
    "agentId" UUID,
    "agentName" TEXT,
    "roleType" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" UUID NOT NULL,
    "since" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dama_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash" TEXT,
    "entryHash" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID,
    "type" "NotificationType" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_tasks" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "automationMode" TEXT NOT NULL DEFAULT 'HUMAN',
    "assigneeId" UUID,
    "dueDate" TIMESTAMP(3),
    "linkedObjectType" TEXT,
    "linkedObjectId" TEXT,
    "resolution" TEXT,
    "createdBy" UUID,
    "completedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_issues" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "issueType" TEXT NOT NULL DEFAULT 'METADATA',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "domainId" UUID,
    "dataAssetId" UUID,
    "systemId" UUID,
    "reportedBy" UUID,
    "assignedTo" UUID,
    "resolutionSummary" TEXT,
    "closedAt" TIMESTAMP(3),
    "linkedRuleId" TEXT,
    "linkedAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_policies" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'POLICY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ownerAssignmentId" UUID,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "reviewFrequency" TEXT NOT NULL DEFAULT 'ANNUAL',
    "lastReviewDate" TEXT,
    "nextReviewDate" TEXT,
    "effectiveDate" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_controls" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "policyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "controlType" TEXT NOT NULL DEFAULT 'DETECTIVE',
    "automationMode" TEXT NOT NULL DEFAULT 'HUMAN',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ownerAssignmentId" UUID,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "linkedDomainId" UUID,
    "linkedSystemId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_groups" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "charter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "members" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "parentId" UUID,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_relationships" (
    "id" UUID NOT NULL,
    "fromNodeId" UUID NOT NULL,
    "toNodeId" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SEQUENCE',
    "condition" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT,
    "filePath" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "url" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "pageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT true,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'org',
    "definition" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_reports" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sops" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "applicableRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggerEvent" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "ownerPersonId" UUID,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL DEFAULT '',
    "context" TEXT NOT NULL DEFAULT '',
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domainId" UUID,
    "ownerPersonId" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "exampleValues" TEXT NOT NULL DEFAULT '',
    "businessRules" TEXT NOT NULL DEFAULT '',
    "sourceOfTruth" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations_manuals" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "roleType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "daily" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weekly" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthly" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quarterly" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customContent" TEXT NOT NULL DEFAULT '',
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_manuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "dayOfMonth" INTEGER,
    "dayOfWeek" INTEGER,
    "timeOfDay" TEXT NOT NULL DEFAULT '',
    "durationMinutes" INTEGER NOT NULL DEFAULT 0,
    "attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agendaTemplate" TEXT NOT NULL DEFAULT '',
    "nextOccurrence" TEXT,
    "lastOccurrence" TEXT,
    "autoCreateTasks" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_programs" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "principles" JSONB NOT NULL DEFAULT '{}',
    "targetStartDate" TEXT,
    "targetLaunchDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_rights" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL DEFAULT '',
    "decider" TEXT,
    "deciderType" TEXT NOT NULL DEFAULT 'PERSON',
    "recommends" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "informed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalationPath" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_rights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "systemId" UUID,
    "name" TEXT NOT NULL,
    "connectionType" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'UNTESTED',
    "lastTestedAt" TEXT,
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_system_links" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "systemId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_system_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT,
    "pairingCode" TEXT,
    "pairingCodeExpiresAt" TEXT,
    "systemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastHeartbeatAt" TEXT,
    "agentVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_events" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "ts" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "connector_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_asset_columns" (
    "id" UUID NOT NULL,
    "dataAssetId" UUID NOT NULL,
    "columnName" TEXT NOT NULL,
    "dataType" TEXT,
    "description" TEXT,
    "sourceConnectionId" UUID,
    "sourceAsset" TEXT,
    "sourceColumn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_asset_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_lineage_links" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "sourceSystemId" UUID NOT NULL,
    "targetSystemId" UUID NOT NULL,
    "dataAssetId" UUID,
    "description" TEXT NOT NULL DEFAULT '',
    "flowType" TEXT NOT NULL DEFAULT 'ETL',
    "frequency" TEXT NOT NULL DEFAULT 'ON_DEMAND',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_lineage_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_lineage_edges" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "sourceAssetId" UUID NOT NULL,
    "targetAssetId" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "lastSeenAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_lineage_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_rules" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "dataAssetId" UUID NOT NULL,
    "columnId" UUID,
    "columnName" TEXT,
    "dimension" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NOT_MEASURED',
    "lastMeasured" TEXT,
    "ruleType" TEXT,
    "parameters" JSONB,
    "lastRun" JSONB,
    "templateId" TEXT,
    "scheduleFrequency" TEXT,
    "nextRunAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_quality_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dbt_cloud_connections" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lastRunAt" TEXT,
    "lastStatus" TEXT NOT NULL DEFAULT 'NEVER',
    "lastError" TEXT,
    "lastSummary" JSONB,
    "pollFrequency" TEXT NOT NULL DEFAULT 'NEVER',
    "nextPollAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dbt_cloud_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_connections" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "connectionId" UUID,
    "config" JSONB NOT NULL DEFAULT '{}',
    "fieldMapping" JSONB NOT NULL DEFAULT '{}',
    "matchKey" TEXT NOT NULL,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maturity_snapshots" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "timestamp" TEXT NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dimensions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "maturity_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gap_snapshots" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "takenAt" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "gap_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_versions" (
    "id" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "changedBy" TEXT,
    "changedAt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "process_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_dismissals" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "dismissedBy" TEXT,
    "dismissedAt" TEXT NOT NULL,

    CONSTRAINT "suggestion_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "orgIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL,
    "agentType" TEXT NOT NULL DEFAULT 'AI',
    "description" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerPersonId" TEXT,
    "skillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_schedules" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "agentName" TEXT NOT NULL,
    "activityId" UUID NOT NULL,
    "activityName" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startAt" TEXT NOT NULL,
    "nextRunAt" TEXT NOT NULL,
    "lastRunAt" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "agentName" TEXT NOT NULL,
    "activityId" UUID NOT NULL,
    "activityName" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TEXT NOT NULL,
    "completedAt" TEXT,
    "output" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "durationMs" INTEGER,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TEXT,
    "promotedDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tenantSlug_key" ON "organizations"("tenantSlug");

-- CreateIndex
CREATE INDEX "organizations_parentId_idx" ON "organizations"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "people_email_key" ON "people"("email");

-- CreateIndex
CREATE INDEX "people_externalId_idx" ON "people"("externalId");

-- CreateIndex
CREATE INDEX "person_orgs_orgId_idx" ON "person_orgs"("orgId");

-- CreateIndex
CREATE INDEX "process_nodes_orgId_idx" ON "process_nodes"("orgId");

-- CreateIndex
CREATE INDEX "process_nodes_orgId_parentId_idx" ON "process_nodes"("orgId", "parentId");

-- CreateIndex
CREATE INDEX "process_nodes_orgId_level_idx" ON "process_nodes"("orgId", "level");

-- CreateIndex
CREATE INDEX "process_node_orgs_orgId_idx" ON "process_node_orgs"("orgId");

-- CreateIndex
CREATE INDEX "process_node_controls_controlId_idx" ON "process_node_controls"("controlId");

-- CreateIndex
CREATE INDEX "process_node_skills_skillId_idx" ON "process_node_skills"("skillId");

-- CreateIndex
CREATE INDEX "process_node_systems_systemId_idx" ON "process_node_systems"("systemId");

-- CreateIndex
CREATE INDEX "systems_orgId_idx" ON "systems"("orgId");

-- CreateIndex
CREATE INDEX "systems_orgId_systemType_idx" ON "systems"("orgId", "systemType");

-- CreateIndex
CREATE INDEX "system_custodians_personId_idx" ON "system_custodians"("personId");

-- CreateIndex
CREATE INDEX "data_domains_orgId_idx" ON "data_domains"("orgId");

-- CreateIndex
CREATE INDEX "data_domain_stewards_personId_idx" ON "data_domain_stewards"("personId");

-- CreateIndex
CREATE INDEX "data_assets_orgId_idx" ON "data_assets"("orgId");

-- CreateIndex
CREATE INDEX "data_assets_orgId_systemId_idx" ON "data_assets"("orgId", "systemId");

-- CreateIndex
CREATE INDEX "data_assets_orgId_dataDomainId_idx" ON "data_assets"("orgId", "dataDomainId");

-- CreateIndex
CREATE INDEX "data_assets_orgId_governanceTier_idx" ON "data_assets"("orgId", "governanceTier");

-- CreateIndex
CREATE INDEX "data_asset_stewards_personId_idx" ON "data_asset_stewards"("personId");

-- CreateIndex
CREATE INDEX "data_asset_bindings_orgId_idx" ON "data_asset_bindings"("orgId");

-- CreateIndex
CREATE INDEX "data_asset_bindings_orgId_dataAssetId_idx" ON "data_asset_bindings"("orgId", "dataAssetId");

-- CreateIndex
CREATE INDEX "data_asset_bindings_connectionId_idx" ON "data_asset_bindings"("connectionId");

-- CreateIndex
CREATE INDEX "mappings_orgId_idx" ON "mappings"("orgId");

-- CreateIndex
CREATE INDEX "mappings_orgId_processStepId_idx" ON "mappings"("orgId", "processStepId");

-- CreateIndex
CREATE INDEX "mappings_orgId_dataAssetId_idx" ON "mappings"("orgId", "dataAssetId");

-- CreateIndex
CREATE INDEX "mappings_orgId_policyId_idx" ON "mappings"("orgId", "policyId");

-- CreateIndex
CREATE INDEX "skills_orgId_idx" ON "skills"("orgId");

-- CreateIndex
CREATE INDEX "skills_orgId_category_idx" ON "skills"("orgId", "category");

-- CreateIndex
CREATE INDEX "person_skills_skillId_idx" ON "person_skills"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "person_skills_personId_skillId_key" ON "person_skills"("personId", "skillId");

-- CreateIndex
CREATE INDEX "dama_roles_personId_idx" ON "dama_roles"("personId");

-- CreateIndex
CREATE INDEX "dama_roles_scopeType_scopeId_idx" ON "dama_roles"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_idx" ON "audit_logs"("orgId");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_entityType_entityId_idx" ON "audit_logs"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_timestamp_idx" ON "audit_logs"("orgId", "timestamp");

-- CreateIndex
CREATE INDEX "notifications_orgId_idx" ON "notifications"("orgId");

-- CreateIndex
CREATE INDEX "notifications_orgId_userId_read_idx" ON "notifications"("orgId", "userId", "read");

-- CreateIndex
CREATE INDEX "governance_tasks_orgId_idx" ON "governance_tasks"("orgId");

-- CreateIndex
CREATE INDEX "governance_tasks_orgId_status_idx" ON "governance_tasks"("orgId", "status");

-- CreateIndex
CREATE INDEX "governance_tasks_orgId_assigneeId_idx" ON "governance_tasks"("orgId", "assigneeId");

-- CreateIndex
CREATE INDEX "governance_issues_orgId_idx" ON "governance_issues"("orgId");

-- CreateIndex
CREATE INDEX "governance_issues_orgId_status_idx" ON "governance_issues"("orgId", "status");

-- CreateIndex
CREATE INDEX "governance_policies_orgId_idx" ON "governance_policies"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "governance_policies_orgId_code_key" ON "governance_policies"("orgId", "code");

-- CreateIndex
CREATE INDEX "governance_controls_orgId_idx" ON "governance_controls"("orgId");

-- CreateIndex
CREATE INDEX "governance_controls_orgId_policyId_idx" ON "governance_controls"("orgId", "policyId");

-- CreateIndex
CREATE INDEX "governance_groups_orgId_idx" ON "governance_groups"("orgId");

-- CreateIndex
CREATE INDEX "governance_groups_parentId_idx" ON "governance_groups"("parentId");

-- CreateIndex
CREATE INDEX "comments_orgId_idx" ON "comments"("orgId");

-- CreateIndex
CREATE INDEX "comments_orgId_entityType_entityId_idx" ON "comments"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "flow_relationships_fromNodeId_idx" ON "flow_relationships"("fromNodeId");

-- CreateIndex
CREATE INDEX "flow_relationships_toNodeId_idx" ON "flow_relationships"("toNodeId");

-- CreateIndex
CREATE INDEX "attachments_orgId_idx" ON "attachments"("orgId");

-- CreateIndex
CREATE INDEX "attachments_orgId_entityType_entityId_idx" ON "attachments"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "tags_orgId_idx" ON "tags"("orgId");

-- CreateIndex
CREATE INDEX "tags_orgId_entityType_entityId_idx" ON "tags"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "tags_orgId_tag_idx" ON "tags"("orgId", "tag");

-- CreateIndex
CREATE INDEX "saved_views_orgId_idx" ON "saved_views"("orgId");

-- CreateIndex
CREATE INDEX "saved_views_orgId_pageKey_idx" ON "saved_views"("orgId", "pageKey");

-- CreateIndex
CREATE INDEX "reports_orgId_idx" ON "reports"("orgId");

-- CreateIndex
CREATE INDEX "analysis_reports_orgId_idx" ON "analysis_reports"("orgId");

-- CreateIndex
CREATE INDEX "sops_orgId_idx" ON "sops"("orgId");

-- CreateIndex
CREATE INDEX "sops_orgId_code_idx" ON "sops"("orgId", "code");

-- CreateIndex
CREATE INDEX "glossary_terms_orgId_idx" ON "glossary_terms"("orgId");

-- CreateIndex
CREATE INDEX "glossary_terms_orgId_category_idx" ON "glossary_terms"("orgId", "category");

-- CreateIndex
CREATE INDEX "operations_manuals_orgId_idx" ON "operations_manuals"("orgId");

-- CreateIndex
CREATE INDEX "operations_manuals_orgId_roleType_idx" ON "operations_manuals"("orgId", "roleType");

-- CreateIndex
CREATE INDEX "calendar_events_orgId_idx" ON "calendar_events"("orgId");

-- CreateIndex
CREATE INDEX "governance_programs_orgId_idx" ON "governance_programs"("orgId");

-- CreateIndex
CREATE INDEX "decision_rights_orgId_idx" ON "decision_rights"("orgId");

-- CreateIndex
CREATE INDEX "connections_orgId_idx" ON "connections"("orgId");

-- CreateIndex
CREATE INDEX "connection_system_links_orgId_idx" ON "connection_system_links"("orgId");

-- CreateIndex
CREATE INDEX "connection_system_links_connectionId_idx" ON "connection_system_links"("connectionId");

-- CreateIndex
CREATE INDEX "connection_system_links_systemId_idx" ON "connection_system_links"("systemId");

-- CreateIndex
CREATE INDEX "connectors_orgId_idx" ON "connectors"("orgId");

-- CreateIndex
CREATE INDEX "connector_events_orgId_idx" ON "connector_events"("orgId");

-- CreateIndex
CREATE INDEX "connector_events_connectorId_idx" ON "connector_events"("connectorId");

-- CreateIndex
CREATE INDEX "data_asset_columns_dataAssetId_idx" ON "data_asset_columns"("dataAssetId");

-- CreateIndex
CREATE INDEX "data_lineage_links_orgId_idx" ON "data_lineage_links"("orgId");

-- CreateIndex
CREATE INDEX "asset_lineage_edges_orgId_idx" ON "asset_lineage_edges"("orgId");

-- CreateIndex
CREATE INDEX "asset_lineage_edges_orgId_sourceRef_idx" ON "asset_lineage_edges"("orgId", "sourceRef");

-- CreateIndex
CREATE INDEX "data_quality_rules_orgId_idx" ON "data_quality_rules"("orgId");

-- CreateIndex
CREATE INDEX "data_quality_rules_orgId_dataAssetId_idx" ON "data_quality_rules"("orgId", "dataAssetId");

-- CreateIndex
CREATE INDEX "dbt_cloud_connections_orgId_idx" ON "dbt_cloud_connections"("orgId");

-- CreateIndex
CREATE INDEX "sync_connections_orgId_idx" ON "sync_connections"("orgId");

-- CreateIndex
CREATE INDEX "maturity_snapshots_orgId_idx" ON "maturity_snapshots"("orgId");

-- CreateIndex
CREATE INDEX "gap_snapshots_orgId_idx" ON "gap_snapshots"("orgId");

-- CreateIndex
CREATE INDEX "process_versions_nodeId_idx" ON "process_versions"("nodeId");

-- CreateIndex
CREATE INDEX "suggestion_dismissals_orgId_idx" ON "suggestion_dismissals"("orgId");

-- CreateIndex
CREATE INDEX "suggestion_dismissals_nodeId_kind_idx" ON "suggestion_dismissals"("nodeId", "kind");

-- CreateIndex
CREATE INDEX "agents_ownerPersonId_idx" ON "agents"("ownerPersonId");

-- CreateIndex
CREATE INDEX "agent_schedules_orgId_idx" ON "agent_schedules"("orgId");

-- CreateIndex
CREATE INDEX "agent_schedules_agentId_idx" ON "agent_schedules"("agentId");

-- CreateIndex
CREATE INDEX "agent_executions_orgId_idx" ON "agent_executions"("orgId");

-- CreateIndex
CREATE INDEX "agent_executions_agentId_idx" ON "agent_executions"("agentId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_orgs" ADD CONSTRAINT "person_orgs_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_orgs" ADD CONSTRAINT "person_orgs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_nodes" ADD CONSTRAINT "process_nodes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_nodes" ADD CONSTRAINT "process_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_nodes" ADD CONSTRAINT "process_nodes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_nodes" ADD CONSTRAINT "process_nodes_responsiblePersonId_fkey" FOREIGN KEY ("responsiblePersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_orgs" ADD CONSTRAINT "process_node_orgs_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_orgs" ADD CONSTRAINT "process_node_orgs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_controls" ADD CONSTRAINT "process_node_controls_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_controls" ADD CONSTRAINT "process_node_controls_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "governance_controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_skills" ADD CONSTRAINT "process_node_skills_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_skills" ADD CONSTRAINT "process_node_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_systems" ADD CONSTRAINT "process_node_systems_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_node_systems" ADD CONSTRAINT "process_node_systems_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "systems" ADD CONSTRAINT "systems_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "systems" ADD CONSTRAINT "systems_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "systems" ADD CONSTRAINT "systems_stewardId_fkey" FOREIGN KEY ("stewardId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "systems" ADD CONSTRAINT "systems_deputyOwnerId_fkey" FOREIGN KEY ("deputyOwnerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_custodians" ADD CONSTRAINT "system_custodians_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_custodians" ADD CONSTRAINT "system_custodians_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_domains" ADD CONSTRAINT "data_domains_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_domains" ADD CONSTRAINT "data_domains_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_domain_stewards" ADD CONSTRAINT "data_domain_stewards_dataDomainId_fkey" FOREIGN KEY ("dataDomainId") REFERENCES "data_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_domain_stewards" ADD CONSTRAINT "data_domain_stewards_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_dataDomainId_fkey" FOREIGN KEY ("dataDomainId") REFERENCES "data_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_asset_stewards" ADD CONSTRAINT "data_asset_stewards_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_asset_stewards" ADD CONSTRAINT "data_asset_stewards_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_asset_bindings" ADD CONSTRAINT "data_asset_bindings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_asset_bindings" ADD CONSTRAINT "data_asset_bindings_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_processStepId_fkey" FOREIGN KEY ("processStepId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "governance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_damaRoleId_fkey" FOREIGN KEY ("damaRoleId") REFERENCES "dama_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dama_roles" ADD CONSTRAINT "dama_roles_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_tasks" ADD CONSTRAINT "governance_tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_tasks" ADD CONSTRAINT "governance_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_issues" ADD CONSTRAINT "governance_issues_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_issues" ADD CONSTRAINT "governance_issues_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_policies" ADD CONSTRAINT "governance_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_controls" ADD CONSTRAINT "governance_controls_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_groups" ADD CONSTRAINT "governance_groups_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_groups" ADD CONSTRAINT "governance_groups_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "governance_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_relationships" ADD CONSTRAINT "flow_relationships_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_relationships" ADD CONSTRAINT "flow_relationships_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "process_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

