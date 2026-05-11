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

export function getRoleDef(roleType: string): GovernanceRoleDef | null {
  return GOVERNANCE_ROLES.find((r) => r.roleType === roleType) ?? null;
}

export function getRoleReference(roleType: string): RoleReference | null {
  return REFERENCE[roleType] ?? null;
}

/** Reverse-lookup: which governance groups expect this role? Derived from
 *  GOVERNANCE_GROUP_ROLES so we never get out of sync with the source. */
export function groupsExpectingRole(roleType: string): GovernanceGroupDef[] {
  return GOVERNANCE_GROUP_ROLES.filter((g) => g.roleTypes.includes(roleType));
}
