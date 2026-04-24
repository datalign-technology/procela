// ── Constants ──

export const INDUSTRIES = [
  'Utilities (Electric, Gas, Water)',
  'Defense & Shipbuilding',
  'Healthcare',
  'Manufacturing',
  'Oil & Gas',
  'Financial Services',
  'Transportation & Logistics',
  'State & Local Government',
] as const;

export type Industry = (typeof INDUSTRIES)[number];

// ── Enums ──

export type UserRole =
  | 'SUPER_ADMIN'
  | 'ORG_ADMIN'
  | 'EDITOR'
  | 'CONTRIBUTOR'
  | 'VIEWER';

export type ProcessStatus = 'DRAFT' | 'ACTIVE' | 'UNDER_REVIEW' | 'DEPRECATED';

export type GovernanceTier = 'BRONZE' | 'SILVER' | 'GOLD';

// ── Core entities ──

export interface Organization {
  id: string;
  name: string;
  industry?: string;
  identityProviderConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  orgId: string;
  externalId?: string;
  name: string;
  email: string;
  role: UserRole;
  department?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Process hierarchy ──

export interface ValueStream {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  ownerId?: string;
  status: ProcessStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  processes?: Process[];
}

export interface Process {
  id: string;
  orgId: string;
  valueStreamId: string;
  name: string;
  description?: string;
  ownerId?: string;
  status: ProcessStatus;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  subProcesses?: SubProcess[];
}

export interface SubProcess {
  id: string;
  orgId: string;
  processId: string;
  name: string;
  description?: string;
  ownerId?: string;
  status: ProcessStatus;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  processSteps?: ProcessStep[];
}

export interface ProcessStep {
  id: string;
  orgId: string;
  subProcessId: string;
  name: string;
  description?: string;
  ownerId?: string;
  status: ProcessStatus;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

// ── Systems & Data ──

export interface SystemEntity {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  systemType?: string;
  ownerId?: string;
  stewardId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  dataAssets?: DataAsset[];
}

export interface DataAsset {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  systemId?: string;
  ownerId?: string;
  stewardId?: string;
  governanceTier: GovernanceTier;
  healthScore: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

// ── Mappings ──

export interface ProcessDataLink {
  id: string;
  orgId: string;
  processStepId: string;
  dataAssetId: string;
  linkType?: string;
  notes?: string;
  aiSuggested: boolean;
  userOverridden: boolean;
  createdBy?: string;
  createdAt: string;
}

// ── DAMA Role Labels (single source of truth) ──

export const DAMA_ROLE_TYPES = [
  'CDO', 'DATA_GOVERNANCE_LEAD', 'DATA_OWNER', 'BUSINESS_DATA_STEWARD',
  'TECHNICAL_DATA_STEWARD', 'DATA_QUALITY_ANALYST', 'DATA_CUSTODIAN',
  'DATA_ARCHITECT', 'DATA_ENGINEER', 'DATABASE_ADMINISTRATOR',
] as const;

export type DamaRoleType = (typeof DAMA_ROLE_TYPES)[number];

export const DAMA_ROLE_LABELS: Record<string, string> = {
  CDO: 'Chief Data Officer',
  DATA_GOVERNANCE_LEAD: 'Data Governance Lead',
  DATA_OWNER: 'Data Owner',
  BUSINESS_DATA_STEWARD: 'Business Data Steward',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
  TECHNICAL_DATA_STEWARD: 'Technical Data Steward',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_ENGINEER: 'Data Engineer',
  DATABASE_ADMINISTRATOR: 'Database Administrator',
};

export const DAMA_ROLE_SHORT: Record<string, string> = {
  CDO: 'CDO',
  DATA_GOVERNANCE_LEAD: 'Gov Lead',
  DATA_OWNER: 'Owner',
  BUSINESS_DATA_STEWARD: 'Biz Steward',
  DATA_QUALITY_ANALYST: 'DQ Analyst',
  TECHNICAL_DATA_STEWARD: 'Tech Steward',
  DATA_CUSTODIAN: 'Custodian',
  DATA_ARCHITECT: 'Architect',
  DATA_ENGINEER: 'Engineer',
  DATABASE_ADMINISTRATOR: 'DBA',
};
