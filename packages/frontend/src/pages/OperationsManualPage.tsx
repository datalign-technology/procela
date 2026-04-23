import { useState } from 'react';
import PageTabNav, { OPERATE_TABS } from '../components/PageTabNav';

interface RoleManual {
  roleType: string;
  label: string;
  purpose: string;
  daily: string[];
  weekly: string[];
  monthly: string[];
  quarterly: string[];
  escalation: string[];
}

const ROLE_MANUALS: RoleManual[] = [
  {
    roleType: 'CDO',
    label: 'Chief Data Officer',
    purpose: 'Set strategy, own outcomes, secure resources, and represent data governance at the executive level.',
    daily: [
      'Review critical data quality alerts and high-severity incidents',
      'Scan open escalations in your queue',
    ],
    weekly: [
      'Meet with Data Governance Lead to review program health',
      'Review pending policy decisions and approvals',
      'Track progress against quarterly governance OKRs',
    ],
    monthly: [
      'Chair Data Governance Council meeting',
      'Report program metrics to executive leadership',
      'Review maturity dashboard and identify investment priorities',
      'Approve policy exceptions that meet escalation criteria',
    ],
    quarterly: [
      'Present governance scorecard to the board or executive committee',
      'Review and ratify governance strategy and roadmap',
      'Approve annual policy updates',
      'Sponsor cross-functional governance initiatives',
    ],
    escalation: [
      'Unresolved policy violations with regulatory implications → CEO and legal counsel',
      'Governance funding or resourcing gaps → CFO and executive committee',
      'Board-level concerns (regulator, audit, major incident) → Board risk committee',
    ],
  },
  {
    roleType: 'DATA_GOVERNANCE_LEAD',
    label: 'Data Governance Lead',
    purpose: 'Run the governance program day to day — drive execution, measure progress, coach stewards.',
    daily: [
      'Triage new governance issues and assign owners',
      'Monitor steward activity and task completion',
      'Respond to steward questions and unblock work',
    ],
    weekly: [
      'Review stewardship team metrics',
      'Facilitate committee pre-reads and agendas',
      'Check policy review pipeline for upcoming reviews',
      'Update governance dashboard',
    ],
    monthly: [
      'Chair Data Governance Committee meeting',
      'Publish monthly governance report to the Council',
      'Coach underperforming stewardship teams',
      'Review program risks and mitigation plans',
    ],
    quarterly: [
      'Lead quarterly governance maturity review',
      'Refresh the governance roadmap with the CDO',
      'Evaluate steward performance and recognize contributors',
      'Plan the next quarter\'s governance initiatives',
    ],
    escalation: [
      'Policy violations or repeated quality failures → CDO',
      'Cross-domain decisions that can\'t be resolved → Governance Committee',
      'Resource or prioritization conflicts → CDO and affected business leads',
    ],
  },
  {
    roleType: 'DATA_OWNER',
    label: 'Data Owner',
    purpose: 'Accountable for a data domain — set direction, approve changes, and own outcomes.',
    daily: [
      'Review critical quality alerts for your domain',
      'Approve urgent data access or usage requests',
    ],
    weekly: [
      'Sync with your Data Stewards on open issues',
      'Review domain health metrics',
      'Prioritize incoming governance requests',
    ],
    monthly: [
      'Attend the Governance Committee',
      'Review domain policies and their effectiveness',
      'Approve or deny policy exceptions within your domain',
      'Report domain metrics: quality, coverage, issues resolved',
    ],
    quarterly: [
      'Validate domain scope and boundaries',
      'Review steward assignments and propose changes',
      'Update domain roadmap and initiatives',
      'Present domain status to the Council',
    ],
    escalation: [
      'Cross-domain conflicts → Governance Committee',
      'Material domain risk → Governance Lead and CDO',
      'Regulatory concerns → Compliance and CDO',
    ],
  },
  {
    roleType: 'BUSINESS_DATA_STEWARD',
    label: 'Business Data Steward',
    purpose: 'Day-to-day management of data quality, definitions, and issue resolution within your domain.',
    daily: [
      'Review data quality alerts for your assets',
      'Respond to questions from data consumers',
      'Progress open governance tasks',
    ],
    weekly: [
      'Attend stewardship team sync',
      'Review business glossary updates and approve new terms',
      'Close resolved issues and document outcomes',
      'Coordinate with Technical Stewards on remediation',
    ],
    monthly: [
      'Report domain quality trends to the Data Owner',
      'Validate metadata completeness and accuracy',
      'Review data asset classifications',
      'Update SOP documentation based on lessons learned',
    ],
    quarterly: [
      'Lead a quarterly data quality deep-dive for your domain',
      'Review and update data retention practices',
      'Participate in maturity assessment for your domain',
      'Propose new quality rules or controls',
    ],
    escalation: [
      'Quality issues that cross domains → Governance Committee',
      'Policy exceptions needed → Data Owner',
      'Resource constraints blocking remediation → Governance Lead',
    ],
  },
  {
    roleType: 'TECHNICAL_DATA_STEWARD',
    label: 'Technical Data Steward',
    purpose: 'Technical implementation of governance — lineage, infrastructure, automation, and system-level quality.',
    daily: [
      'Monitor automated quality checks and pipelines',
      'Triage technical incidents affecting data availability',
      'Support business stewards with technical questions',
    ],
    weekly: [
      'Review data lineage updates and verify accuracy',
      'Audit access logs and flag anomalies',
      'Collaborate with Data Engineers on remediation',
      'Review system-level metrics (latency, uptime, error rates)',
    ],
    monthly: [
      'Report technical posture to the Data Owner',
      'Review infrastructure roadmap impact on governance',
      'Validate classification tags and data masking rules',
      'Update technical documentation',
    ],
    quarterly: [
      'Review data architecture alignment with governance policies',
      'Participate in security and privacy audits',
      'Plan technical debt reduction initiatives',
      'Evaluate new tools or automation opportunities',
    ],
    escalation: [
      'Infrastructure failures affecting governance → CDO and infrastructure lead',
      'Security or privacy concerns → CISO and privacy officer',
      'Tooling gaps blocking the program → Governance Lead',
    ],
  },
  {
    roleType: 'DATA_QUALITY_ANALYST',
    label: 'Data Quality Analyst',
    purpose: 'Measure, report, and drive improvements in data quality across domains.',
    daily: [
      'Review overnight quality rule results',
      'Investigate quality incidents and document root causes',
    ],
    weekly: [
      'Publish weekly quality dashboard',
      'Coordinate remediation with stewards',
      'Refine quality rules based on false positives',
    ],
    monthly: [
      'Present monthly quality report to the Committee',
      'Audit critical data assets for quality drift',
      'Propose new quality rules based on trends',
    ],
    quarterly: [
      'Benchmark quality against industry standards',
      'Review and refresh quality KPIs',
      'Conduct deep-dive analysis on chronic quality issues',
    ],
    escalation: [
      'Systemic quality failures → Governance Committee',
      'Regulatory-impacting quality issues → CDO and Compliance',
    ],
  },
  {
    roleType: 'DATA_ARCHITECT',
    label: 'Data Architect',
    purpose: 'Ensure data architecture aligns with governance principles and supports long-term scalability.',
    daily: [
      'Review architecture review board submissions',
      'Answer technical questions from stewards and engineers',
    ],
    weekly: [
      'Attend architecture review board',
      'Review lineage and integration changes',
      'Validate new data model designs',
    ],
    monthly: [
      'Report architecture alignment metrics',
      'Review and update reference architectures',
      'Assess impact of new technology adoption on governance',
    ],
    quarterly: [
      'Present architecture roadmap to the Committee',
      'Review and refresh data standards',
      'Lead cross-team architecture alignment sessions',
    ],
    escalation: [
      'Architecture decisions affecting multiple domains → Governance Committee',
      'Misalignment with governance principles → CDO',
    ],
  },
];

interface SectionDef {
  key: keyof Pick<RoleManual, 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'escalation'>;
  name: string;
  accentColor: string;
  description: string;
}

const SECTIONS: SectionDef[] = [
  { key: 'daily', name: 'Daily activities', accentColor: '#22c55e', description: 'Ongoing, every-day responsibilities' },
  { key: 'weekly', name: 'Weekly activities', accentColor: '#3b82f6', description: 'Recurring work to track momentum and unblock teams' },
  { key: 'monthly', name: 'Monthly activities', accentColor: '#8b5cf6', description: 'Reviews, reporting, and committee-level engagement' },
  { key: 'quarterly', name: 'Quarterly activities', accentColor: '#f59e0b', description: 'Strategic reviews and roadmap planning' },
  { key: 'escalation', name: 'Escalation paths', accentColor: '#dc2626', description: 'When to escalate and to whom' },
];

export default function OperationsManualPage() {
  const [selectedRole, setSelectedRole] = useState<string>('CDO');

  const role = ROLE_MANUALS.find((r) => r.roleType === selectedRole) || ROLE_MANUALS[0];

  return (
    <div>
      <PageTabNav tabs={OPERATE_TABS} />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Operations Manual</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          Role-specific guidance for running your governance program.
        </p>
      </div>

      {/* Role selector tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {ROLE_MANUALS.map((r) => {
          const isActive = r.roleType === selectedRole;
          return (
            <button
              key={r.roleType}
              onClick={() => setSelectedRole(r.roleType)}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
                color: isActive ? '#fff' : 'var(--color-text)',
                border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {/* Selected role manual */}
      <div>
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          marginBottom: 16,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 4,
          }}>
            Role Manual
          </div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{role.label}</h2>
          <p style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            marginTop: 8,
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}>
            {role.purpose}
          </p>
        </div>

        {SECTIONS.map((section) => {
          const items = role[section.key];
          return (
            <div
              key={section.key}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderLeft: `4px solid ${section.accentColor}`,
                borderRadius: 'var(--radius-md)',
                padding: 16,
                marginBottom: 12,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: section.accentColor,
                  flexShrink: 0,
                }} />
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{section.name}</h3>
              </div>
              <div style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                marginBottom: 10,
                marginLeft: 18,
              }}>
                {section.description}
              </div>
              {items.length === 0 ? (
                <div style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  fontStyle: 'italic',
                  marginLeft: 18,
                }}>
                  No activities defined for this role.
                </div>
              ) : (
                <ul style={{
                  margin: 0,
                  paddingLeft: 34,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  {items.map((item, idx) => (
                    <li
                      key={idx}
                      style={{
                        fontSize: 13,
                        color: 'var(--color-text)',
                        lineHeight: 1.5,
                      }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
