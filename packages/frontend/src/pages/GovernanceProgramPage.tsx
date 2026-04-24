import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import HelpPopover from '../components/HelpPopover';
import PageTabNav, { GOVERNANCE_TABS } from '../components/PageTabNav';

interface Program {
  id: string;
  orgId: string;
  name: string;
  scope: {
    inScope: string;
    outOfScope: string;
    boundaries: string;
    constraints: string;
  };
  principles: {
    vision: string;
    principles: string[];
    decisionRights: string;
    operatingModel: 'CENTRALIZED' | 'FEDERATED' | 'HYBRID' | '';
  };
  targetStartDate: string | null;
  targetLaunchDate: string | null;
  status: 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
}

interface PhaseCheck { label: string; done: boolean }
interface PhaseStatus {
  currentPhase: 1 | 2 | 3 | 4;
  phases: {
    phase1: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
    phase2: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
    phase3: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
    phase4: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
  };
  overallProgress: number;
}

interface Recommendation {
  phase: number;
  action: string;
  link: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ── DAMA Role Definitions ──

interface DamaRoleAssignment {
  id: string;
  personId: string;
  personName: string;
  roleType: string;
  scopeType: string;
  scopeId: string;
  since: string;
  createdAt: string;
}

interface Person {
  id: string;
  name: string;
}

type RolePriority = 'ESSENTIAL' | 'RECOMMENDED' | 'OPTIONAL';

interface RoleGuideEntry {
  roleType: string;
  label: string;
  purpose: string;
  priority: RolePriority;
}

const ROLE_GUIDE: RoleGuideEntry[] = [
  { roleType: 'CDO', label: 'Chief Data Officer', purpose: 'Sets strategy, owns outcomes, secures resources, and represents data governance at the executive level.', priority: 'ESSENTIAL' },
  { roleType: 'DATA_GOVERNANCE_LEAD', label: 'Data Governance Lead', purpose: 'Runs the governance program day to day — drives execution, measures progress, coaches stewards.', priority: 'ESSENTIAL' },
  { roleType: 'DATA_OWNER', label: 'Data Owner', purpose: 'Accountable for a data domain — sets direction, approves changes, and owns outcomes.', priority: 'ESSENTIAL' },
  { roleType: 'BUSINESS_DATA_STEWARD', label: 'Business Data Steward', purpose: 'Day-to-day management of data quality, definitions, and issue resolution within a domain.', priority: 'ESSENTIAL' },
  { roleType: 'TECHNICAL_DATA_STEWARD', label: 'Technical Data Steward', purpose: 'Technical implementation of governance — lineage, infrastructure, automation, and system-level quality.', priority: 'RECOMMENDED' },
  { roleType: 'DATA_QUALITY_ANALYST', label: 'Data Quality Analyst', purpose: 'Measures, reports, and drives improvements in data quality across domains.', priority: 'RECOMMENDED' },
  { roleType: 'DATA_ARCHITECT', label: 'Data Architect', purpose: 'Ensures data architecture aligns with governance principles and supports long-term scalability.', priority: 'RECOMMENDED' },
  { roleType: 'DATA_CUSTODIAN', label: 'Data Custodian', purpose: 'Manages the physical storage, security, and access controls for data systems.', priority: 'OPTIONAL' },
  { roleType: 'DATA_ENGINEER', label: 'Data Engineer', purpose: 'Builds and maintains data pipelines, transformations, and integration infrastructure.', priority: 'OPTIONAL' },
  { roleType: 'DATABASE_ADMINISTRATOR', label: 'Database Administrator', purpose: 'Manages database performance, backups, security, and availability.', priority: 'OPTIONAL' },
];

const PRIORITY_COLORS: Record<RolePriority, { border: string; bg: string; text: string }> = {
  ESSENTIAL: { border: '#22c55e', bg: '#d1fae5', text: '#065f46' },
  RECOMMENDED: { border: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  OPTIONAL: { border: '#64748b', bg: '#f1f5f9', text: '#64748b' },
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 80,
  fontFamily: 'inherit',
  resize: 'vertical',
};

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const PHASE_COLORS: Record<number, string> = {
  1: '#3b82f6',
  2: '#8b5cf6',
  3: '#22c55e',
  4: '#f97316',
};

const PHASE_TITLES: Record<number, string> = {
  1: 'Foundation Definition',
  2: 'Structural Design',
  3: 'People & Processes',
  4: 'Operationalization',
};

function ProgressBar({ value, color }: { value: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div style={{
      width: '100%',
      height: 8,
      background: '#e5e7eb',
      borderRadius: 999,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${clamped}%`,
        height: '100%',
        background: color || 'var(--color-primary)',
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}

function PhaseCard({
  phaseNum,
  phase,
  isCurrent,
}: {
  phaseNum: 1 | 2 | 3 | 4;
  phase: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
  isCurrent: boolean;
}) {
  const color = PHASE_COLORS[phaseNum];
  const isCompleted = phase.completed;
  const statusLabel = isCompleted ? 'Complete' : phase.progress > 0 ? 'In Progress' : 'Not Started';
  const statusColor = isCompleted ? '#22c55e' : isCurrent ? color : '#9ca3af';

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: isCurrent ? `2px solid ${color}` : '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 16,
      boxShadow: isCurrent ? `0 0 0 4px ${color}15` : 'var(--shadow-sm)',
      opacity: !isCurrent && !isCompleted && phase.progress === 0 ? 0.75 : 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: isCompleted ? '#22c55e' : color,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {isCompleted ? '✓' : phaseNum}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Phase {phaseNum}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
            {phase.name || PHASE_TITLES[phaseNum]}
          </div>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: statusColor }}>{statusLabel}</span>
          <span>{phase.progress}%</span>
        </div>
        <ProgressBar value={phase.progress} color={isCompleted ? '#22c55e' : color} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {phase.checks.map((check, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%',
              background: check.done ? '#22c55e' : 'transparent',
              border: check.done ? 'none' : '1.5px solid #d1d5db',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, flexShrink: 0,
            }}>
              {check.done ? '✓' : ''}
            </span>
            <span style={{
              color: check.done ? 'var(--color-text)' : 'var(--color-text-muted)',
              textDecoration: check.done ? 'none' : 'none',
            }}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GovernanceProgramPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();

  const [program, setProgram] = useState<Program | null>(null);
  const [status, setStatus] = useState<PhaseStatus | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'scope' | 'principles' | 'roles'>('scope');

  // Editable form state
  const [inScope, setInScope] = useState('');
  const [outOfScope, setOutOfScope] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [constraints, setConstraints] = useState('');
  const [vision, setVision] = useState('');
  const [principles, setPrinciples] = useState<string[]>([]);
  const [newPrinciple, setNewPrinciple] = useState('');
  const [decisionRights, setDecisionRights] = useState('');
  const [operatingModel, setOperatingModel] = useState<Program['principles']['operatingModel']>('');
  const [targetStartDate, setTargetStartDate] = useState('');
  const [targetLaunchDate, setTargetLaunchDate] = useState('');

  // ── Roles tab state ──
  const [roleAssignments, setRoleAssignments] = useState<DamaRoleAssignment[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  const hydrateFromProgram = (p: Program) => {
    setInScope(p.scope?.inScope || '');
    setOutOfScope(p.scope?.outOfScope || '');
    setBoundaries(p.scope?.boundaries || '');
    setConstraints(p.scope?.constraints || '');
    setVision(p.principles?.vision || '');
    setPrinciples(Array.isArray(p.principles?.principles) ? p.principles.principles : []);
    setDecisionRights(p.principles?.decisionRights || '');
    setOperatingModel(p.principles?.operatingModel || '');
    setTargetStartDate(p.targetStartDate ? p.targetStartDate.slice(0, 10) : '');
    setTargetLaunchDate(p.targetLaunchDate ? p.targetLaunchDate.slice(0, 10) : '');
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const progRes = await apiClient.get<{ success: boolean; data: Program }>(`/governance-program${query}`);
      const p = progRes.data;
      setProgram(p);
      if (p) {
        hydrateFromProgram(p);
        try {
          const [statusRes, recsRes] = await Promise.all([
            apiClient.get<{ success: boolean; data: PhaseStatus }>(`/governance-program/${p.id}/status`),
            apiClient.get<{ success: boolean; data: Recommendation[] }>(`/governance-program/${p.id}/recommendations`),
          ]);
          setStatus(statusRes.data || null);
          setRecs(recsRes.data || []);
        } catch { /* status/recs may not be available yet */ }
      }
    } catch {
      // API may not be running
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!program) return;
    setSaving(true);
    try {
      const payload = {
        scope: { inScope, outOfScope, boundaries, constraints },
        principles: { vision, principles, decisionRights, operatingModel },
        targetStartDate: targetStartDate || null,
        targetLaunchDate: targetLaunchDate || null,
      };
      const res = await apiClient.put<{ success: boolean; data: Program }>(`/governance-program/${program.id}`, payload);
      if (res.data) {
        setProgram(res.data);
        hydrateFromProgram(res.data);
      }
      addToast('success', 'Governance program saved');
      // Refresh status and recommendations
      try {
        const [statusRes, recsRes] = await Promise.all([
          apiClient.get<{ success: boolean; data: PhaseStatus }>(`/governance-program/${program.id}/status`),
          apiClient.get<{ success: boolean; data: Recommendation[] }>(`/governance-program/${program.id}/recommendations`),
        ]);
        setStatus(statusRes.data || null);
        setRecs(recsRes.data || []);
      } catch { /* */ }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save program';
      addToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const addPrinciple = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    const trimmed = newPrinciple.trim();
    if (!trimmed) return;
    const updated = [...principles, trimmed];
    setPrinciples(updated);
    setNewPrinciple('');
    if (program) {
      apiClient.put(`/governance-program/${program.id}`, {
        principles: { vision, principles: updated, decisionRights, operatingModel },
      }).then(() => {
        addToast('success', 'Principle added');
        fetchAll();
      }).catch(() => addToast('error', 'Failed to add principle'));
    }
  };

  const removePrinciple = (index: number) => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    const updated = principles.filter((_, i) => i !== index);
    setPrinciples(updated);
    if (program) {
      apiClient.put(`/governance-program/${program.id}`, {
        principles: { vision, principles: updated, decisionRights, operatingModel },
      }).then(() => {
        addToast('success', 'Principle removed');
        fetchAll();
      }).catch(() => addToast('error', 'Failed to remove principle'));
    }
  };

  // ── Roles tab data fetching ──
  const fetchRolesData = useCallback(async () => {
    if (!activeOrgId) return;
    try {
      const [rolesRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[] }>(`/dama-roles?orgId=${activeOrgId}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setRoleAssignments(Array.isArray(rolesRes.data) ? rolesRes.data : []);
      setPeople(Array.isArray(peopleRes.data) ? peopleRes.data : []);
    } catch {
      // API may not be available
    } finally {
      setRolesLoaded(true);
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (activeTab === 'roles' && !rolesLoaded) {
      fetchRolesData();
    }
  }, [activeTab, rolesLoaded, fetchRolesData]);

  // Reset rolesLoaded when org changes so data is re-fetched
  useEffect(() => {
    setRolesLoaded(false);
  }, [activeOrgId]);

  const handleAssignRole = async (roleType: string) => {
    const personId = roleSelections[roleType];
    if (!personId || !activeOrgId) return;
    setAssigningRole(roleType);
    try {
      await apiClient.post('/dama-roles', {
        personId,
        roleType,
        scopeType: 'ORG',
        scopeId: activeOrgId,
      });
      addToast('success', 'Role assigned');
      setRoleSelections((prev) => ({ ...prev, [roleType]: '' }));
      // Refresh assignments
      const rolesRes = await apiClient.get<{ success: boolean; data: DamaRoleAssignment[] }>(`/dama-roles?orgId=${activeOrgId}`);
      setRoleAssignments(Array.isArray(rolesRes.data) ? rolesRes.data : []);
      // Also refresh phase status since role assignment may affect progress
      if (program) {
        try {
          const [statusRes, recsRes] = await Promise.all([
            apiClient.get<{ success: boolean; data: PhaseStatus }>(`/governance-program/${program.id}/status`),
            apiClient.get<{ success: boolean; data: Recommendation[] }>(`/governance-program/${program.id}/recommendations`),
          ]);
          setStatus(statusRes.data || null);
          setRecs(recsRes.data || []);
        } catch { /* */ }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to assign role';
      addToast('error', msg);
    } finally {
      setAssigningRole(null);
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    try {
      await apiClient.delete(`/dama-roles/${roleId}`);
      addToast('success', 'Role assignment removed');
      setRoleAssignments((prev) => prev.filter((r) => r.id !== roleId));
      // Refresh phase status
      if (program) {
        try {
          const [statusRes, recsRes] = await Promise.all([
            apiClient.get<{ success: boolean; data: PhaseStatus }>(`/governance-program/${program.id}/status`),
            apiClient.get<{ success: boolean; data: Recommendation[] }>(`/governance-program/${program.id}/recommendations`),
          ]);
          setStatus(statusRes.data || null);
          setRecs(recsRes.data || []);
        } catch { /* */ }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to remove role';
      addToast('error', msg);
    }
  };

  const priorityColor = (p: Recommendation['priority']): { bg: string; color: string } => {
    if (p === 'HIGH') return { bg: '#fef2f2', color: '#b91c1c' };
    if (p === 'MEDIUM') return { bg: '#fffbeb', color: '#b45309' };
    return { bg: '#f0f9ff', color: '#0369a1' };
  };

  return (
    <div>
      <PageTabNav tabs={GOVERNANCE_TABS} />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Program</h1>
          <HelpPopover id="gov-program-intro" title="Data Governance Program Setup">
            Procela follows a DAMA-aligned, 4-phase framework for standing up a governance program:
            (1) Foundation Definition — scope, principles, operating model; (2) Structural Design —
            domains, roles, and committees; (3) People & Processes — RACI, policies, and stewardship;
            (4) Operationalization — monitoring, metrics, and continuous improvement. Progress on
            each phase is tracked automatically as you complete the underlying work. Organizations
            move through these phases at their own pace.
          </HelpPopover>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          A phased approach to building your data governance program
        </p>
        {status && (
          <div style={{ marginTop: 14, maxWidth: 600 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Overall Progress
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                {status.overallProgress}%
              </span>
            </div>
            <ProgressBar value={status.overallProgress} />
          </div>
        )}
      </div>

      {loading && (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center',
          color: 'var(--color-text-muted)', fontSize: 13,
        }}>
          Loading governance program...
        </div>
      )}

      {!loading && (
        <>
          {/* Phase cards */}
          {status && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}>
              {([1, 2, 3, 4] as const).map((n) => {
                const key = `phase${n}` as 'phase1' | 'phase2' | 'phase3' | 'phase4';
                return (
                  <PhaseCard
                    key={n}
                    phaseNum={n}
                    phase={status.phases[key]}
                    isCurrent={status.currentPhase === n}
                  />
                );
              })}
            </div>
          )}

          {/* Next actions */}
          {recs.length > 0 && (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20,
              boxShadow: 'var(--shadow-sm)',
            }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Next Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recs.map((r, idx) => {
                  const pc = priorityColor(r.priority);
                  return (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg)',
                    }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                        background: pc.bg, color: pc.color,
                        flexShrink: 0,
                      }}>
                        {r.priority}
                      </span>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        fontSize: 10, fontWeight: 600,
                        background: PHASE_COLORS[r.phase] + '20',
                        color: PHASE_COLORS[r.phase],
                        flexShrink: 0,
                      }}>
                        Phase {r.phase}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>
                        {r.action}
                      </span>
                      {r.link && (
                        <Link to={r.link} style={{
                          fontSize: 12, fontWeight: 500,
                          color: 'var(--color-primary)', textDecoration: 'none',
                          flexShrink: 0,
                        }}>
                          Go &rarr;
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Scope & Principles editor */}
          {program && (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20,
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Foundation: Scope & Principles</h3>
                <HelpPopover id="gov-program-foundation" title="Phase 1: Foundation">
                  Document what is in/out of scope for your governance program, the guiding
                  principles that will shape decisions, and the operating model (who decides what).
                  This is the bedrock of everything that follows.
                </HelpPopover>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
                {(['scope', 'principles', 'roles'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    style={{
                      padding: '8px 16px', fontSize: 13,
                      fontWeight: activeTab === t ? 600 : 500,
                      background: 'transparent', border: 'none',
                      borderBottom: activeTab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                      color: activeTab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      marginBottom: -1, cursor: 'pointer', textTransform: 'capitalize',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {activeTab === 'scope' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>In Scope</label>
                    <textarea
                      style={textareaStyle}
                      value={inScope}
                      onChange={(e) => setInScope(e.target.value)}
                      placeholder="What data, systems, and processes are governed by this program?"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Out of Scope</label>
                    <textarea
                      style={textareaStyle}
                      value={outOfScope}
                      onChange={(e) => setOutOfScope(e.target.value)}
                      placeholder="What is explicitly excluded from this program?"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Boundaries</label>
                    <textarea
                      style={textareaStyle}
                      value={boundaries}
                      onChange={(e) => setBoundaries(e.target.value)}
                      placeholder="Organizational, geographic, or functional boundaries for this program"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Constraints</label>
                    <textarea
                      style={textareaStyle}
                      value={constraints}
                      onChange={(e) => setConstraints(e.target.value)}
                      placeholder="Budget, timeline, regulatory, or resource constraints to respect"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'principles' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Vision</label>
                    <textarea
                      style={textareaStyle}
                      value={vision}
                      onChange={(e) => setVision(e.target.value)}
                      placeholder="What does success look like for your data governance program?"
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Guiding Principles</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                      {principles.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          No principles defined yet. Add your first principle below.
                        </div>
                      )}
                      {principles.map((p, idx) => (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 10px',
                          background: 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 4,
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 20 }}>
                            {idx + 1}.
                          </span>
                          <span style={{ flex: 1, fontSize: 13 }}>{p}</span>
                          <button
                            type="button"
                            onClick={() => removePrinciple(idx)}
                            aria-label="Remove principle"
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              fontSize: 14, color: 'var(--color-text-muted)', padding: 2,
                            }}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        style={inputStyle}
                        value={newPrinciple}
                        onChange={(e) => setNewPrinciple(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrinciple(); } }}
                        placeholder="e.g. Data is a shared asset; treat it like one"
                      />
                      <button type="button" style={btnSecondary} onClick={addPrinciple}>
                        Add
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Decision Rights</label>
                    <textarea
                      style={textareaStyle}
                      value={decisionRights}
                      onChange={(e) => setDecisionRights(e.target.value)}
                      placeholder="Who decides what? Strategic, tactical, and operational decision authority"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Operating Model</label>
                    <select
                      style={selectStyle}
                      value={operatingModel}
                      onChange={(e) => setOperatingModel(e.target.value as Program['principles']['operatingModel'])}
                    >
                      <option value="">-- Select --</option>
                      <option value="CENTRALIZED">Centralized</option>
                      <option value="FEDERATED">Federated</option>
                      <option value="HYBRID">Hybrid</option>
                    </select>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                      Centralized = one central team governs. Federated = domains govern themselves within enterprise guardrails. Hybrid = shared responsibility.
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'roles' && (() => {
                const totalRoles = ROLE_GUIDE.length;
                const essentialRoles = ROLE_GUIDE.filter((r) => r.priority === 'ESSENTIAL');
                const assignedRoleTypes = new Set(roleAssignments.map((a) => a.roleType));
                const assignedCount = ROLE_GUIDE.filter((r) => assignedRoleTypes.has(r.roleType)).length;
                const essentialFilled = essentialRoles.filter((r) => assignedRoleTypes.has(r.roleType)).length;

                return (
                  <div>
                    {/* Progress summary */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '10px 14px', marginBottom: 14,
                      background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)', fontSize: 13,
                    }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                        {assignedCount} of {totalRoles} roles assigned
                      </span>
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        {essentialFilled} of {essentialRoles.length} essential roles filled
                      </span>
                    </div>

                    {/* Role cards */}
                    {ROLE_GUIDE.map((role) => {
                      const pc = PRIORITY_COLORS[role.priority];
                      const assignees = roleAssignments.filter((a) => a.roleType === role.roleType);
                      const selectedPerson = roleSelections[role.roleType] || '';
                      const isAssigning = assigningRole === role.roleType;

                      return (
                        <div
                          key={role.roleType}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)', marginBottom: 8,
                            borderLeft: `4px solid ${pc.border}`,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 14, fontWeight: 600 }}>{role.label}</span>
                              <span style={{
                                display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                                background: pc.bg, color: pc.text,
                              }}>
                                {role.priority}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                              {role.purpose}
                            </div>
                            {assignees.length > 0 ? (
                              <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {assignees.map((a) => (
                                  <span
                                    key={a.id}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 4,
                                      fontSize: 11, padding: '2px 8px',
                                      background: '#d1f0eb', color: '#0f4f46', borderRadius: 12,
                                    }}
                                  >
                                    {a.personName}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveRole(a.id)}
                                      aria-label={`Remove ${a.personName}`}
                                      style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        fontSize: 13, color: '#0f4f46', padding: 0, lineHeight: 1,
                                        marginLeft: 2,
                                      }}
                                    >
                                      &times;
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>Not assigned</div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                            <select
                              style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
                              value={selectedPerson}
                              onChange={(e) =>
                                setRoleSelections((prev) => ({ ...prev, [role.roleType]: e.target.value }))
                              }
                            >
                              <option value="">Select person...</option>
                              {people.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              style={{
                                ...btnPrimary,
                                padding: '6px 14px',
                                opacity: !selectedPerson || isAssigning ? 0.5 : 1,
                                cursor: !selectedPerson || isAssigning ? 'not-allowed' : 'pointer',
                              }}
                              disabled={!selectedPerson || isAssigning}
                              onClick={() => handleAssignRole(role.roleType)}
                            >
                              {isAssigning ? 'Assigning...' : 'Assign'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Program dates */}
          {program && (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20,
              boxShadow: 'var(--shadow-sm)',
            }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Program Dates</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Start Date</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={targetStartDate}
                    onChange={(e) => setTargetStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Launch Date</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={targetLaunchDate}
                    onChange={(e) => setTargetLaunchDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Save bar */}
          {program && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}

          {!program && !loading && (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center',
              color: 'var(--color-text-muted)', fontSize: 13,
            }}>
              No governance program found for this organization.
            </div>
          )}
        </>
      )}
    </div>
  );
}
