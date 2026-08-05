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
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: UserRole;
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

export type RolePriority = 'ESSENTIAL' | 'RECOMMENDED' | 'OPTIONAL';

export interface GovernanceRoleDef {
  roleType: string;
  label: string;
  purpose: string;
  priority: RolePriority;
  required: boolean;
  multiAssign: boolean;
  requiredSkillIds: string[];
}

export const GOVERNANCE_ROLES: GovernanceRoleDef[] = [
  { roleType: 'CDO', label: 'Chief Data Officer', purpose: 'Sets strategy, owns outcomes, secures resources, and represents data governance at the executive level.', priority: 'ESSENTIAL', required: true, multiAssign: false, requiredSkillIds: [] },
  { roleType: 'DATA_GOVERNANCE_LEAD', label: 'Data Governance Lead', purpose: 'Runs the governance program day to day — drives execution, measures progress, and coaches stewards.', priority: 'ESSENTIAL', required: true, multiAssign: false, requiredSkillIds: [] },
  { roleType: 'DATA_OWNER', label: 'Data Owner', purpose: 'Accountable for a data domain — sets direction, approves changes, and owns outcomes.', priority: 'ESSENTIAL', required: true, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'BUSINESS_DATA_STEWARD', label: 'Business Data Steward', purpose: 'Day-to-day management of data quality, definitions, and issue resolution within a domain.', priority: 'ESSENTIAL', required: true, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'TECHNICAL_DATA_STEWARD', label: 'Technical Data Steward', purpose: 'Technical implementation of governance — lineage, infrastructure, automation, and system-level quality.', priority: 'RECOMMENDED', required: false, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'DATA_QUALITY_ANALYST', label: 'Data Quality Analyst', purpose: 'Measures, reports, and drives improvements in data quality across domains.', priority: 'RECOMMENDED', required: false, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'DATA_ARCHITECT', label: 'Data Architect', purpose: 'Ensures data architecture aligns with governance principles and supports long-term scalability.', priority: 'RECOMMENDED', required: false, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'DATA_CUSTODIAN', label: 'Data Custodian', purpose: 'Manages the physical storage, security, and access controls for data systems.', priority: 'OPTIONAL', required: false, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'DATA_ENGINEER', label: 'Data Engineer', purpose: 'Builds and maintains data pipelines, transformations, and integration infrastructure.', priority: 'OPTIONAL', required: false, multiAssign: true, requiredSkillIds: [] },
  { roleType: 'DATABASE_ADMINISTRATOR', label: 'Database Administrator', purpose: 'Manages database performance, backups, security, and availability.', priority: 'OPTIONAL', required: false, multiAssign: true, requiredSkillIds: [] },
];

// Governance roles that carry executive accountability, business
// judgement, or signing authority — these cannot be held by an AI
// agent because a regulator / auditor asking "who's accountable for
// this?" must land on a human name. The Person/Agent toggles across
// the app (DAMA Roles assign form, Governance Groups expected-role
// panel, Governance Program role list) consult this set to disable
// the agent option, and the backend POST /dama-roles enforces the
// same rule so a stray API call can't bypass the UI.
//
// Technical / monitoring roles (Technical Steward, DQ Analyst,
// Architect, Engineer, DBA, Custodian) stay agent-eligible — those
// are execution roles, not accountability-bearing ones.
export const PEOPLE_ONLY_ROLE_TYPES = new Set<string>([
  'CDO',
  'DATA_GOVERNANCE_LEAD',
  'DATA_OWNER',
  'BUSINESS_DATA_STEWARD',
]);

export const PEOPLE_ONLY_REASON = 'Agents can’t hold accountability roles — only a person can hold this role so an auditor asking “who’s accountable?” lands on a human name.';

export interface GovernanceGroupDef {
  groupType: string;
  label: string;
  description: string;
  color: string;
  link: string;
  roleTypes: string[];
}

export const GOVERNANCE_GROUP_ROLES: GovernanceGroupDef[] = [
  {
    groupType: 'COUNCIL',
    label: 'Data Governance Council',
    description: 'Strategic oversight — sets direction, resolves escalations, and sponsors the program.',
    color: '#7c3aed',
    link: '/governance',
    roleTypes: ['CDO', 'DATA_GOVERNANCE_LEAD'],
  },
  {
    groupType: 'COMMITTEE',
    label: 'Data Governance Committee',
    description: 'Tactical coordination — prioritizes initiatives, reviews policies, and aligns domains.',
    color: '#2563eb',
    link: '/governance',
    roleTypes: ['DATA_OWNER', 'DATA_ARCHITECT'],
  },
  {
    groupType: 'STEWARDSHIP_TEAM',
    label: 'Domain Stewardship Teams',
    description: 'Operational execution — manages data quality, definitions, and day-to-day governance within each domain.',
    color: '#059669',
    link: '/governance',
    roleTypes: ['BUSINESS_DATA_STEWARD', 'TECHNICAL_DATA_STEWARD', 'DATA_QUALITY_ANALYST'],
  },
  {
    groupType: 'OFFICE',
    label: 'Data Governance Office',
    description: 'Program management — coordinates governance activities, maintains standards, and supports stewards.',
    color: '#6d28d9',
    link: '/governance',
    roleTypes: ['DATA_GOVERNANCE_LEAD', 'DATA_ARCHITECT'],
  },
  {
    groupType: 'OPERATIONS',
    label: 'Technical Operations',
    description: 'Infrastructure support — storage, pipelines, security, and system administration.',
    color: '#64748b',
    link: '/governance',
    roleTypes: ['DATA_CUSTODIAN', 'DATA_ENGINEER', 'DATABASE_ADMINISTRATOR'],
  },
];

export const PRIORITY_COLORS: Record<RolePriority, { border: string; bg: string; text: string }> = {
  ESSENTIAL: { border: '#22c55e', bg: '#d1fae5', text: '#065f46' },
  RECOMMENDED: { border: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  OPTIONAL: { border: '#64748b', bg: '#f1f5f9', text: '#64748b' },
};
