// ──────────────────────────────────────────────────────────────────────────
// Role reference content for the RoleDetailDrawer.
//
// `GOVERNANCE_ROLES` in types/index.ts already covers the basics (label,
// one-line purpose, priority, required, multiAssign). This module layers
// on the longer-form reference content the drawer needs:
//
//   - responsibilities: bullet list of what the role actually does day-to-day
//   - typicalDecisions: DAMA-aligned decisions this role usually owns or
//     contributes to, with a RACI letter for each
//   - groupsExpectingRole(): reverse-lookup of which governance groups
//     expect this role, derived from GOVERNANCE_GROUP_ROLES so it can't
//     drift from the source of truth
//
// All content is template/reference - not "what this org's setup says".
// The drawer combines this static reference with dynamic data (current
// assignees in this org) at render time.
// ──────────────────────────────────────────────────────────────────────────

import {
  GOVERNANCE_ROLES,
  GOVERNANCE_GROUP_ROLES,
  GovernanceRoleDef,
  GovernanceGroupDef,
} from '../types';

export type Raci = 'R' | 'A' | 'C' | 'I';

export const RACI_LABEL: Record<Raci, string> = {
  R: 'Responsible',
  A: 'Accountable',
  C: 'Consulted',
  I: 'Informed',
};

export const RACI_DESCRIPTION: Record<Raci, string> = {
  R: 'Does the work',
  A: 'Owns the decision and answers for the outcome',
  C: 'Input is sought before deciding',
  I: 'Kept informed after the decision',
};

export const RACI_COLOR: Record<Raci, { bg: string; text: string }> = {
  R: { bg: '#dbeafe', text: '#1e40af' },
  A: { bg: '#d1fae5', text: '#065f46' },
  C: { bg: '#fef3c7', text: '#92400e' },
  I: { bg: '#f1f5f9', text: '#475569' },
};

export interface TypicalDecision {
  decision: string;
  raci: Raci;
}

export interface RoleReference {
  /** Longer-form intro paragraph, used after the one-line purpose. */
  summary: string;
  /** Day-to-day responsibilities. Aim for 4-6 bullets. */
  responsibilities: string[];
  /** Decisions this role typically owns or contributes to. */
  typicalDecisions: TypicalDecision[];
  /** Skill names the role typically needs. Matched at render time
   *  against the org's seeded skill catalog (/skills) - names are stable
   *  across orgs but IDs are not, so names are the join key. Unmatched
   *  names are still rendered, marked as "Not in your catalog yet". */
  requiredSkills: string[];
}

const REFERENCE: Record<string, RoleReference> = {
  CDO: {
    summary: 'The executive sponsor and ultimate accountable owner of the data governance program. Sets the direction the rest of the program executes against.',
    responsibilities: [
      'Define the data strategy and align it with business priorities',
      'Secure funding, headcount, and executive air-cover for the program',
      'Chair the Data Governance Council and own escalations from it',
      'Represent the data function to the board, regulators, and external partners',
      'Hold domain owners accountable for outcomes, not just activity',
    ],
    typicalDecisions: [
      { decision: 'Data strategy and multi-year roadmap', raci: 'A' },
      { decision: 'Governance program funding and headcount', raci: 'A' },
      { decision: 'Cross-domain escalations and conflicts', raci: 'A' },
      { decision: 'Enterprise data policies', raci: 'A' },
      { decision: 'Regulatory and audit response', raci: 'C' },
    ],
    requiredSkills: ['Stakeholder Management', 'Executive Reporting', 'Compliance Monitoring'],
  },
  DATA_GOVERNANCE_LEAD: {
    summary: 'Runs the governance program day to day. Translates the CDO\'s strategy into a working operating model that stewards and owners actually use.',
    responsibilities: [
      'Operate the governance calendar — meetings, reviews, decision logs',
      'Maintain the policy and standards library and shepherd new policies through review',
      'Coach data owners and stewards and unblock them when they\'re stuck',
      'Measure and report on governance KPIs (coverage, quality, risk)',
      'Drive continuous improvement based on what\'s working and what isn\'t',
    ],
    typicalDecisions: [
      { decision: 'Governance operating model and cadence', raci: 'A' },
      { decision: 'Policy authoring and review process', raci: 'R' },
      { decision: 'Data quality measurement framework', raci: 'A' },
      { decision: 'New governance tooling and platforms', raci: 'R' },
      { decision: 'Data strategy', raci: 'C' },
    ],
    requiredSkills: ['Policy Development', 'Stakeholder Management', 'Change Management', 'Standards Enforcement', 'Issue Resolution'],
  },
  DATA_OWNER: {
    summary: 'Accountable for a specific data domain - the business of customer data, finance data, employee data, etc. The single throat to choke when something goes wrong in their domain.',
    responsibilities: [
      'Set direction and priorities for the data in their domain',
      'Approve changes to definitions, classifications, and access policies',
      'Sign off on data quality thresholds and accept the risk when they\'re missed',
      'Resolve definitional disputes within the domain',
      'Sponsor the stewards who do the day-to-day work in the domain',
    ],
    typicalDecisions: [
      { decision: 'Domain-level data definitions and business rules', raci: 'A' },
      { decision: 'Domain data quality thresholds and SLAs', raci: 'A' },
      { decision: 'Data classification within the domain', raci: 'A' },
      { decision: 'Access requests to domain data', raci: 'A' },
      { decision: 'Cross-domain integrations', raci: 'C' },
    ],
    requiredSkills: ['Stakeholder Management', 'Business Translation', 'Issue Resolution', 'Compliance Monitoring'],
  },
  BUSINESS_DATA_STEWARD: {
    summary: 'The domain expert who manages data definitions and quality from a business perspective. The person who knows what the data is supposed to mean.',
    responsibilities: [
      'Define and maintain business terms and definitions in the glossary',
      'Triage and resolve data quality issues within the domain',
      'Translate business requirements into data requirements',
      'Review proposed changes that affect domain data',
      'Be the day-to-day contact for questions about the domain\'s data',
    ],
    typicalDecisions: [
      { decision: 'Business term definitions and synonyms', raci: 'R' },
      { decision: 'Data quality issue prioritization within domain', raci: 'R' },
      { decision: 'Domain-level data definitions and business rules', raci: 'R' },
      { decision: 'Reference data values and code lists', raci: 'A' },
      { decision: 'Changes to upstream sources', raci: 'C' },
    ],
    requiredSkills: ['Data Cataloging', 'Business Translation', 'Issue Resolution', 'Documentation', 'Metadata Management'],
  },
  TECHNICAL_DATA_STEWARD: {
    summary: 'The technical counterpart to the business steward. Translates business definitions into the actual systems, pipelines, and quality checks that produce trustworthy data.',
    responsibilities: [
      'Map business terms to physical columns and tables',
      'Implement data quality checks and lineage capture',
      'Investigate technical root causes of quality issues',
      'Coordinate with engineers on schema changes and migrations',
      'Maintain the technical metadata that supports the catalog',
    ],
    typicalDecisions: [
      { decision: 'Data quality check implementation and tooling', raci: 'R' },
      { decision: 'Lineage capture approach and coverage', raci: 'A' },
      { decision: 'Technical metadata standards', raci: 'R' },
      { decision: 'Schema change approval for governed assets', raci: 'C' },
      { decision: 'Business term definitions', raci: 'C' },
    ],
    requiredSkills: ['Lineage Mapping', 'Schema Validation', 'Metadata Management', 'Standards Enforcement', 'Tag Management'],
  },
  DATA_QUALITY_ANALYST: {
    summary: 'Measures data quality, reports trends, and drives the improvement work. The voice of "is this getting better or worse?"',
    responsibilities: [
      'Design and run data quality rules and dimensions (accuracy, completeness, timeliness, etc.)',
      'Produce DQ scorecards for domains and critical assets',
      'Root-cause quality regressions and recommend fixes',
      'Coordinate remediation work with stewards and engineers',
      'Track issue closure and prevent regressions',
    ],
    typicalDecisions: [
      { decision: 'Data quality rule design and weights', raci: 'R' },
      { decision: 'DQ scorecard structure and cadence', raci: 'R' },
      { decision: 'Quality remediation prioritization', raci: 'C' },
      { decision: 'Domain DQ thresholds and SLAs', raci: 'C' },
      { decision: 'Quality measurement framework', raci: 'C' },
    ],
    requiredSkills: ['Data Profiling', 'Anomaly Detection', 'Quality Monitoring', 'Rule Authoring', 'Data Cleansing'],
  },
  DATA_ARCHITECT: {
    summary: 'Sets the technical direction for how data is structured, integrated, and modeled across the enterprise. Makes sure today\'s decisions don\'t become tomorrow\'s technical debt.',
    responsibilities: [
      'Define and maintain enterprise data architecture and reference models',
      'Review and approve major data integration designs',
      'Steward canonical models for shared concepts (customer, product, etc.)',
      'Advise on platform and tooling choices',
      'Keep the architecture realistic - prefer pragmatic over perfect',
    ],
    typicalDecisions: [
      { decision: 'Enterprise data architecture and reference models', raci: 'A' },
      { decision: 'Canonical data models for shared concepts', raci: 'A' },
      { decision: 'Major integration design approvals', raci: 'A' },
      { decision: 'Data platform and tooling selection', raci: 'C' },
      { decision: 'Cross-domain data definitions', raci: 'C' },
    ],
    requiredSkills: ['Data Modeling', 'Integration Design', 'Cloud Architecture', 'Performance Tuning', 'API Management'],
  },
  DATA_CUSTODIAN: {
    summary: 'Manages the physical storage, security, and operational care of the systems that hold data. Custody is about safekeeping, not ownership.',
    responsibilities: [
      'Operate the storage and database systems data lives in',
      'Implement access controls and encryption per policy',
      'Run backups, restores, and disaster recovery procedures',
      'Monitor system health and respond to incidents',
      'Apply security patches and infrastructure upgrades',
    ],
    typicalDecisions: [
      { decision: 'Backup and recovery procedures', raci: 'R' },
      { decision: 'Access control implementation', raci: 'R' },
      { decision: 'Storage and infrastructure choices', raci: 'C' },
      { decision: 'Encryption standards', raci: 'C' },
      { decision: 'Data classification', raci: 'I' },
    ],
    requiredSkills: ['Access Control', 'Encryption Management', 'Audit Trail Management', 'Data Classification'],
  },
  DATA_ENGINEER: {
    summary: 'Builds and operates the pipelines, transformations, and integrations that move and shape data across systems.',
    responsibilities: [
      'Build and maintain ETL/ELT pipelines for governed assets',
      'Implement business rules and transformations defined by stewards',
      'Operate the data platform and the pipelines running on it',
      'Instrument pipelines for quality checks and lineage capture',
      'Resolve pipeline failures and data freshness issues',
    ],
    typicalDecisions: [
      { decision: 'Pipeline design and orchestration patterns', raci: 'R' },
      { decision: 'Transformation logic implementation', raci: 'R' },
      { decision: 'Pipeline failure response and rerun policy', raci: 'A' },
      { decision: 'Schema changes in pipeline-owned tables', raci: 'C' },
      { decision: 'Data platform tooling', raci: 'C' },
    ],
    requiredSkills: ['ETL Development', 'API Integration', 'Real-time Streaming', 'Performance Tuning', 'Data Replication'],
  },
  DATABASE_ADMINISTRATOR: {
    summary: 'Keeps the databases healthy, performant, and available. Focused on the engine, not on what\'s inside the tables.',
    responsibilities: [
      'Tune database performance and capacity',
      'Manage backups, replication, and high-availability setup',
      'Apply database patches and version upgrades',
      'Implement and audit database-level security',
      'Support engineers and analysts with query and schema guidance',
    ],
    typicalDecisions: [
      { decision: 'Database performance tuning and indexing', raci: 'A' },
      { decision: 'Backup, replication, and HA configuration', raci: 'A' },
      { decision: 'Database version upgrades and patches', raci: 'R' },
      { decision: 'Database-level security policies', raci: 'R' },
      { decision: 'Schema design', raci: 'C' },
    ],
    requiredSkills: ['Performance Tuning', 'Access Control', 'Audit Trail Management', 'Encryption Management'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Entity-attached roles
// ═══════════════════════════════════════════════════════════════════════════
//
// Procela also has roles that aren't DAMA-style enterprise roles - they're
// foreign-key fields on Systems / Data Assets / Data Domains: System Owner,
// Deputy Owner, System Custodian, Asset Owner, Asset Steward, Domain Owner,
// Domain Steward. Until now these had no central definition - users saw
// "Custodian" next to "Data Custodian" and reasonably assumed they worked
// the same, but only the DAMA ones opened the Role Detail drawer.
//
// Add the same level of definition (purpose, responsibilities, typical
// decisions, required skills) to each entity-attached role so the drawer
// can render them identically. The data model doesn't change - a System's
// owner is still a foreign key on the System - only the catalog does.
//
// Categories are kept separate so the drawer can:
//   - skip groupsExpectingRole() for entity-attached roles
//   - query the right source for "Currently held by" (per-entity scan
//     instead of /dama-roles)
//   - render a "scope" hint ("Scoped per system" vs "Enterprise") that
//     helps users understand that two people can both hold System Owner
//     for different systems without it being a RACI violation.

export type RoleCategory = 'governance' | 'entity';
export type RoleScope = 'enterprise' | 'system' | 'dataAsset' | 'dataDomain';

export interface EntityRoleDef {
  roleType: string;
  label: string;
  /** Hosting entity. Drives the "Currently held by" data source. */
  scope: Exclude<RoleScope, 'enterprise'>;
}

export const ENTITY_ROLES: EntityRoleDef[] = [
  { roleType: 'SYSTEM_OWNER',           label: 'System Owner',         scope: 'system' },
  { roleType: 'SYSTEM_DEPUTY_OWNER',    label: 'Deputy System Owner',  scope: 'system' },
  { roleType: 'SYSTEM_CUSTODIAN',       label: 'System Custodian',     scope: 'system' },
  { roleType: 'DATA_ASSET_OWNER',       label: 'Data Asset Owner',     scope: 'dataAsset' },
  { roleType: 'DATA_ASSET_STEWARD',     label: 'Data Asset Steward',   scope: 'dataAsset' },
  { roleType: 'DATA_DOMAIN_OWNER',      label: 'Data Domain Owner',    scope: 'dataDomain' },
  { roleType: 'DATA_DOMAIN_STEWARD',    label: 'Data Domain Steward',  scope: 'dataDomain' },
];

const ENTITY_REFERENCE: Record<string, RoleReference> = {
  SYSTEM_OWNER: {
    summary: 'The business owner of a single system - the person who funds it, prioritises changes to it, and answers for its health. Different from a Data Owner: System Owner answers for the application; Data Owner answers for what\'s inside.',
    responsibilities: [
      'Own the system\'s roadmap and approve major changes',
      'Sign off on availability and uptime expectations with the business',
      'Approve who gets access at the system level',
      'Sponsor remediation when the system is unreliable or insecure',
      'Decide when the system is retired or replaced',
    ],
    typicalDecisions: [
      { decision: 'Major system upgrades or replacements', raci: 'A' },
      { decision: 'System-level access policy', raci: 'A' },
      { decision: 'Uptime / SLA commitments', raci: 'A' },
      { decision: 'Budget for the system and its operations', raci: 'A' },
      { decision: 'Day-to-day operational priorities', raci: 'C' },
    ],
    requiredSkills: ['Stakeholder Management', 'Issue Resolution', 'Standards Enforcement'],
  },
  SYSTEM_DEPUTY_OWNER: {
    summary: 'Backup decision-maker for a system. Covers when the owner is unavailable; the same authority on the same scope.',
    responsibilities: [
      'Make owner-equivalent decisions when the owner is unavailable',
      'Stay close enough to the system to answer the same questions the owner would',
      'Maintain context for continuity if ownership transitions',
    ],
    typicalDecisions: [
      { decision: 'Same decisions as System Owner when acting in their stead', raci: 'A' },
      { decision: 'Day-to-day operational priorities', raci: 'C' },
    ],
    requiredSkills: ['Stakeholder Management', 'Issue Resolution'],
  },
  SYSTEM_CUSTODIAN: {
    summary: 'The technical caretaker of a system. The "ops" of the system: keeps it running, handles incidents, applies patches, manages access. Distinct from the DAMA Data Custodian role, which is enterprise-wide and covers data storage broadly.',
    responsibilities: [
      'Operate the system day-to-day; respond to incidents and outages',
      'Apply security patches and version upgrades on the agreed cadence',
      'Implement access provisioning as approved by the system owner',
      'Run backups and validate restores',
      'Monitor performance and capacity',
    ],
    typicalDecisions: [
      { decision: 'Day-to-day operational changes', raci: 'R' },
      { decision: 'Patch / upgrade scheduling', raci: 'A' },
      { decision: 'Incident response actions', raci: 'A' },
      { decision: 'Access provisioning (per owner policy)', raci: 'R' },
      { decision: 'Major architecture changes', raci: 'C' },
    ],
    requiredSkills: ['Access Control', 'Performance Tuning', 'Audit Trail Management', 'Encryption Management'],
  },
  DATA_ASSET_OWNER: {
    summary: 'Accountable for a specific data asset. Owns its definition, quality, and classification at the asset level (a single table, file, or feed). Sits underneath the broader Domain Owner.',
    responsibilities: [
      'Approve the asset\'s definition, classification, and retention',
      'Sign off on data quality thresholds for this asset',
      'Decide who gets access to this asset',
      'Sponsor remediation when quality drops below threshold',
      'Coordinate with the Domain Owner on cross-asset issues',
    ],
    typicalDecisions: [
      { decision: 'Asset definition and classification', raci: 'A' },
      { decision: 'Asset quality thresholds', raci: 'A' },
      { decision: 'Access requests to this asset', raci: 'A' },
      { decision: 'Schema changes', raci: 'A' },
      { decision: 'Cross-domain data sharing', raci: 'C' },
    ],
    requiredSkills: ['Business Translation', 'Stakeholder Management', 'Issue Resolution'],
  },
  DATA_ASSET_STEWARD: {
    summary: 'Day-to-day operational management for a data asset. Handles definitions, quality investigations, and questions about this specific asset.',
    responsibilities: [
      'Maintain the asset\'s metadata in the catalog',
      'Triage and route data quality issues',
      'Answer questions about this specific asset',
      'Coordinate fixes with engineering when something breaks',
      'Keep the column / business-term mapping current',
    ],
    typicalDecisions: [
      { decision: 'Day-to-day quality issue prioritization', raci: 'R' },
      { decision: 'Metadata changes', raci: 'R' },
      { decision: 'Routine access requests', raci: 'R' },
      { decision: 'Major redefinition of the asset', raci: 'C' },
    ],
    requiredSkills: ['Data Cataloging', 'Documentation', 'Business Translation', 'Issue Resolution'],
  },
  DATA_DOMAIN_OWNER: {
    summary: 'Cross-asset owner of a logical domain (e.g. Customer Data, Finance Data). Sets direction for all assets in the domain. The person to escalate to when several assets in the same domain disagree.',
    responsibilities: [
      'Set direction and quality bar for the entire domain',
      'Resolve definitional disputes across assets in the domain',
      'Approve which assets belong in the domain',
      'Sponsor the stewards working in the domain',
      'Coordinate with other Domain Owners on cross-domain integrations',
    ],
    typicalDecisions: [
      { decision: 'Domain-wide definitions and business rules', raci: 'A' },
      { decision: 'Domain quality thresholds', raci: 'A' },
      { decision: 'Which assets belong in the domain', raci: 'A' },
      { decision: 'Cross-domain integrations', raci: 'C' },
    ],
    requiredSkills: ['Stakeholder Management', 'Business Translation', 'Issue Resolution', 'Compliance Monitoring'],
  },
  DATA_DOMAIN_STEWARD: {
    summary: 'Day-to-day management within a domain. Coordinates the stewards of the assets in the domain and handles cross-asset issues.',
    responsibilities: [
      'Coordinate the asset-level stewards in the domain',
      'Maintain the domain\'s catalog of business terms',
      'Triage cross-asset quality issues',
      'Surface gaps in the domain\'s coverage to the Domain Owner',
    ],
    typicalDecisions: [
      { decision: 'Cross-asset issue prioritization', raci: 'R' },
      { decision: 'Business glossary additions for the domain', raci: 'R' },
      { decision: 'Stewardship coordination', raci: 'R' },
      { decision: 'Major domain restructuring', raci: 'C' },
    ],
    requiredSkills: ['Data Cataloging', 'Business Translation', 'Issue Resolution', 'Stakeholder Management', 'Documentation'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Unified getters
// ═══════════════════════════════════════════════════════════════════════════
//
// The drawer and any other consumer should use these instead of reaching
// for GOVERNANCE_ROLES / ENTITY_ROLES directly - they handle both
// categories transparently.

export function getRoleDef(roleType: string): GovernanceRoleDef | EntityRoleDef | null {
  const dama = GOVERNANCE_ROLES.find((r) => r.roleType === roleType);
  if (dama) return dama;
  return ENTITY_ROLES.find((r) => r.roleType === roleType) ?? null;
}

export function getRoleReference(roleType: string): RoleReference | null {
  return REFERENCE[roleType] ?? ENTITY_REFERENCE[roleType] ?? null;
}

export function getRoleCategory(roleType: string): RoleCategory | null {
  if (GOVERNANCE_ROLES.some((r) => r.roleType === roleType)) return 'governance';
  if (ENTITY_ROLES.some((r) => r.roleType === roleType)) return 'entity';
  return null;
}

export function getRoleScope(roleType: string): RoleScope {
  const entity = ENTITY_ROLES.find((r) => r.roleType === roleType);
  if (entity) return entity.scope;
  return 'enterprise';
}

/** Reverse-lookup: which governance groups expect this role? Returns an
 *  empty array for entity-attached roles (governance groups don't expect
 *  System Owners). */
export function groupsExpectingRole(roleType: string): GovernanceGroupDef[] {
  return GOVERNANCE_GROUP_ROLES.filter((g) => g.roleTypes.includes(roleType));
}
