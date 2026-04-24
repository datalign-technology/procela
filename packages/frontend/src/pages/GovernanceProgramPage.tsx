import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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

const PHASE_CHECK_LINKS: Record<string, string> = {
  'Scope defined': '#foundation',
  'Guiding principles established': '#foundation',
  'Operating model selected': '#foundation',
  'Data domains defined': '/data-domains',
  'Governance Council established': '/governance',
  'Governance Committee established': '/governance',
  'Initial roles assigned': '#roles',
  'Data stewards identified': '#roles',
  'Stewardship teams formed': '/governance',
  'Domain ownership assigned': '/data-domains',
  'Core processes defined': '/processes',
  'Policies activated': '/governance-policies',
  'Program launched': '#launch',
};

function PhaseCard({
  phaseNum,
  phase,
  isCurrent,
  onSectionOpen,
}: {
  phaseNum: 1 | 2 | 3 | 4;
  phase: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
  isCurrent: boolean;
  onSectionOpen?: (hash: string) => void;
}) {
  const navigate = useNavigate();
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {phase.checks.map((check, idx) => {
          const link = PHASE_CHECK_LINKS[check.label];
          return (
            <div
              key={idx}
              onClick={link ? () => {
                if (link.startsWith('#')) {
                  onSectionOpen?.(link.slice(1));
                } else {
                  navigate(link);
                }
              } : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                padding: '5px 8px', borderRadius: 4,
                cursor: link ? 'pointer' : 'default',
                transition: 'background-color 0.12s',
              }}
              onMouseEnter={(e) => { if (link) e.currentTarget.style.backgroundColor = 'var(--color-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
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
                flex: 1,
                color: check.done ? 'var(--color-text)' : 'var(--color-text-muted)',
              }}>
                {check.label}
              </span>
              {link && (
                <span style={{ fontSize: 11, color: 'var(--color-primary)', flexShrink: 0, opacity: 0.7 }}>
                  &rarr;
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollapsibleSection({
  phaseLabel,
  phaseColor,
  title,
  subtitle,
  open,
  onToggle,
  children,
  sectionRef,
}: {
  phaseLabel: string;
  phaseColor: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  sectionRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={sectionRef}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${open ? phaseColor + '40' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        marginBottom: 12,
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          cursor: 'pointer',
          borderBottom: open ? '1px solid var(--color-border)' : 'none',
          transition: 'background-color 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 12 }}>{open ? '▼' : '▶'}</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: phaseColor + '18', color: phaseColor,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {phaseLabel}
          </span>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h3>
          {subtitle && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{subtitle}</span>
          )}
        </div>
      </div>
      {open && (
        <div style={{ padding: 20 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function GovernanceProgramPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const location = useLocation();

  const [program, setProgram] = useState<Program | null>(null);
  const [status, setStatus] = useState<PhaseStatus | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'scope' | 'principles'>('scope');

  // Collapsible sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const foundationRef = useRef<HTMLDivElement>(null);
  const rolesRef = useRef<HTMLDivElement>(null);
  const launchRef = useRef<HTMLDivElement>(null);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openAndScrollTo = (sectionId: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: true }));
    const refMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
      foundation: foundationRef,
      roles: rolesRef,
      launch: launchRef,
    };
    const ref = refMap[sectionId];
    setTimeout(() => {
      ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  useEffect(() => {
    const hash = location.hash?.slice(1);
    if (hash && ['foundation', 'roles', 'launch'].includes(hash)) {
      openAndScrollTo(hash);
    }
  }, [location.hash]);

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
    if (openSections.roles && !rolesLoaded) {
      fetchRolesData();
    }
  }, [openSections.roles, rolesLoaded, fetchRolesData]);

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
                    onSectionOpen={openAndScrollTo}
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

          {/* ── Collapsible work sections ── */}

          {/* Phase 1: Foundation — Scope, Principles & Dates */}
          {program && (
            <CollapsibleSection
              phaseLabel="Phase 1"
              phaseColor={PHASE_COLORS[1]}
              title="Scope, Principles & Dates"
              open={!!openSections.foundation}
              onToggle={() => toggleSection('foundation')}
              sectionRef={foundationRef}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <HelpPopover id="gov-program-foundation" title="Phase 1: Foundation">
                  Document what is in/out of scope for your governance program, the guiding
                  principles that will shape decisions, and the operating model (who decides what).
                  This is the bedrock of everything that follows.
                </HelpPopover>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
                {(['scope', 'principles'] as const).map((t) => (
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

              {/* Program dates */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-secondary)' }}>Program Dates</h4>
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

              {/* Save bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button
                  style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </CollapsibleSection>
          )}

          {/* Phase 2: Assign Governance Roles */}
          <CollapsibleSection
            phaseLabel="Phase 2"
            phaseColor={PHASE_COLORS[2]}
            title="Assign Governance Roles"
            subtitle={roleAssignments.length > 0
              ? `${new Set(roleAssignments.map((r) => r.roleType)).size} of ${ROLE_GUIDE.length} roles assigned`
              : 'No roles assigned yet'}
            open={!!openSections.roles}
            onToggle={() => toggleSection('roles')}
            sectionRef={rolesRef}
          >
            {(() => {
              const totalRoles = ROLE_GUIDE.length;
              const essentialRoles = ROLE_GUIDE.filter((r) => r.priority === 'ESSENTIAL');
              const filledRoleTypes = new Set(roleAssignments.map((a) => a.roleType));
              const filledCount = ROLE_GUIDE.filter((r) => filledRoleTypes.has(r.roleType)).length;
              const essentialFilled = essentialRoles.filter((r) => filledRoleTypes.has(r.roleType)).length;

              return (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{filledCount} of {totalRoles} roles assigned</span>
                      <span style={{ fontSize: 12, color: essentialFilled === essentialRoles.length ? '#16a34a' : '#dc2626' }}>
                        {essentialFilled} of {essentialRoles.length} essential roles filled
                      </span>
                    </div>
                    <ProgressBar value={(filledCount / totalRoles) * 100} />
                  </div>
                  {ROLE_GUIDE.map((role) => {
                    const assignees = roleAssignments.filter((a) => a.roleType === role.roleType);
                    const pc = PRIORITY_COLORS[role.priority];
                    return (
                      <div key={role.roleType} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                        borderLeft: `4px solid ${pc.border}`, borderRadius: 'var(--radius-md)', marginBottom: 8,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{role.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: pc.bg, color: pc.text, textTransform: 'uppercase' }}>{role.priority}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{role.purpose}</div>
                          {assignees.length > 0 ? (
                            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {assignees.map((a) => (
                                <span key={a.id} style={{ fontSize: 11, padding: '2px 8px', background: '#d1f0eb', color: '#0f4f46', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {a.personName}
                                  <button onClick={() => handleRemoveRole(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0f4f46', fontSize: 12, padding: 0, lineHeight: 1 }}>&times;</button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>Not assigned</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                          <select
                            style={{ ...selectStyle, width: 'auto', minWidth: 160, fontSize: 12 }}
                            value={roleSelections[role.roleType] || ''}
                            onChange={(e) => setRoleSelections((prev) => ({ ...prev, [role.roleType]: e.target.value }))}
                          >
                            <option value="">Select person...</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <button
                            style={{ ...btnPrimary, padding: '4px 12px', fontSize: 12, opacity: !roleSelections[role.roleType] || assigningRole ? 0.6 : 1 }}
                            disabled={!roleSelections[role.roleType] || !!assigningRole}
                            onClick={() => handleAssignRole(role.roleType)}
                          >
                            Assign
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </CollapsibleSection>

          {/* Phase 4: Program Launch */}
          {program && (
            <CollapsibleSection
              phaseLabel="Phase 4"
              phaseColor={PHASE_COLORS[4]}
              title="Program Launch"
              subtitle={program.status === 'ACTIVE' ? 'Launched' : 'Not yet launched'}
              open={!!openSections.launch}
              onToggle={() => toggleSection('launch')}
              sectionRef={launchRef}
            >
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                When all foundation, structural, and people requirements are in place, launch the program to move it into active operations.
                Launching sets the program status to Active and signals readiness for day-to-day governance.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13 }}>
                  Current status: <strong>{program.status === 'ACTIVE' ? 'Active' : program.status === 'PAUSED' ? 'Paused' : program.status === 'COMPLETED' ? 'Completed' : 'Planning'}</strong>
                </span>
                {program.status !== 'ACTIVE' && (
                  <button
                    style={{ ...btnPrimary, fontSize: 13 }}
                    onClick={async () => {
                      if (!activeOrgId) { addToast('error', 'Select an organization first.'); return; }
                      try {
                        const res = await apiClient.put<{ success: boolean; data: Program }>(`/governance-program/${program.id}`, { status: 'ACTIVE' });
                        if (res.data) { setProgram(res.data); hydrateFromProgram(res.data); }
                        addToast('success', 'Program launched!');
                        fetchAll();
                      } catch { addToast('error', 'Failed to launch program'); }
                    }}
                  >
                    Launch Program
                  </button>
                )}
                {program.status === 'ACTIVE' && (
                  <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>&#10003; Program is live</span>
                )}
              </div>
            </CollapsibleSection>
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
