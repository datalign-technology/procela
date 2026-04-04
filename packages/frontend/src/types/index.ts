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
  | 'PROCESS_OWNER'
  | 'DATA_STEWARD'
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
