import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { clickable, activateOnKeyStop } from '../lib/a11y';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Spinner from '../components/Spinner';
import SectionLabel from '../components/SectionLabel';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import HelpPopover from '../components/HelpPopover';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePermissions } from '../hooks/usePermissions';
import { GOVERNANCE_ROLES, GOVERNANCE_GROUP_ROLES, PEOPLE_ONLY_ROLE_TYPES, PEOPLE_ONLY_REASON } from '../types';
import type { RolePriority } from '../types';
import StatusBadge, { type StatusBadgeVariant } from '../components/StatusBadge';
import Button from '../components/Button';

// ESSENTIAL reads as success, RECOMMENDED as info, OPTIONAL as neutral —
// same mapping the RoleDetailDrawer uses so priority chips look identical
// wherever they appear.
const PRIORITY_TO_VARIANT: Record<RolePriority, StatusBadgeVariant> = {
  ESSENTIAL: 'success',
  RECOMMENDED: 'info',
  OPTIONAL: 'neutral',
};
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';

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
  personId: string | null;
  agentId: string | null;
  personName: string | null;
  agentName: string | null;
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

interface Agent {
  id: string;
  name: string;
  agentType: string;
  status: string;
  skillIds: string[];
}

const ROLE_GUIDE = GOVERNANCE_ROLES;
const ROLE_GROUPS = GOVERNANCE_GROUP_ROLES.filter((g) => g.groupType !== 'OFFICE');

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

const PHASE_CHECK_HINTS: Record<string, string> = {
  'Governance leadership roles established': 'CDO, Data Governance Lead',
  'Data owners assigned': 'Assign Data Owners to each domain',
  'Data stewards identified': 'Business or Technical Data Steward',
};

const PHASE_CHECK_LINKS: Record<string, string> = {
  'Scope defined': '#1:scope',
  'Guiding principles established': '#1:principles',
  'Operating model selected': '#1:principles',
  'Data domains defined': '/data-domains',
  'Governance Council established': '/governance',
  'Governance Committee established': '/governance',
  'Governance leadership roles established': '#2:leadership',
  'Data owners assigned': '#2',
  'Data stewards identified': '#2',
  'Stewardship teams formed': '/governance',
  'Domain ownership assigned': '/data-domains',
  'Core processes defined': '/processes',
  'Policies activated': '/governance-policies',
  'Program launched': '#4',
};

function PhaseCard({
  phaseNum,
  phase,
  isCurrent,
  expanded,
  onToggle,
  onExpandPhase,
}: {
  phaseNum: 1 | 2 | 3 | 4;
  phase: { name: string; completed: boolean; progress: number; checks: PhaseCheck[] };
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpandPhase: (n: number, tab?: string) => void;
}) {
  const navigate = useNavigate();
  const color = PHASE_COLORS[phaseNum];
  const isCompleted = phase.completed;
  const statusLabel = isCompleted ? 'Complete' : phase.progress > 0 ? 'In Progress' : 'Not Started';
  const statusColor = isCompleted ? '#22c55e' : isCurrent ? color : '#9ca3af';

  return (
    <div
      {...clickable(onToggle, { label: `Toggle Phase ${phaseNum}` })}
      aria-expanded={expanded}
      style={{
        background: 'var(--color-surface)',
        border: expanded ? `2px solid ${color}` : isCurrent ? `2px solid ${color}` : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: expanded ? `0 0 0 4px ${color}40` : isCurrent ? `0 0 0 4px ${color}15` : 'var(--shadow-sm)',
        opacity: !isCurrent && !isCompleted && phase.progress === 0 && !expanded ? 0.75 : 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, border-color 0.2s, transform 0.15s',
        transform: expanded ? 'translateY(-2px)' : 'none',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 16,
          transition: 'background-color 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: isCompleted ? '#22c55e' : color,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, flexShrink: 0,
        }}>
          {isCompleted ? '✓' : phaseNum}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <SectionLabel marginBottom={0} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Phase {phaseNum}</span>
            {isCurrent && !isCompleted && (
              <span style={{ background: color, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 999, letterSpacing: '0.04em' }}>
                YOU ARE HERE
              </span>
            )}
          </SectionLabel>
          <div style={{ fontSize: isCurrent && !isCompleted ? 16 : 14, fontWeight: 700, color: 'var(--color-text)' }}>
            {phase.name || PHASE_TITLES[phaseNum]}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: statusColor }}>{statusLabel}</span>
          <span>{phase.progress}%</span>
        </div>
        <ProgressBar value={phase.progress} color={isCompleted ? '#22c55e' : color} />
      </div>

      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {phase.checks.map((check, idx) => {
          const link = PHASE_CHECK_LINKS[check.label];
          const isHash = link?.startsWith('#');
          const hashParts = isHash ? link.slice(1).split(':') : [];
          const targetPhase = isHash ? parseInt(hashParts[0]) : 0;
          const targetTab = hashParts[1] || undefined;
          const goToCheck = () => {
            if (isHash) {
              onExpandPhase(targetPhase, targetTab);
            } else {
              navigate(link);
            }
          };
          return (
            <div
              key={idx}
              {...(link ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': `Go to ${check.label}`,
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); goToCheck(); },
                onKeyDown: activateOnKeyStop(goToCheck),
              } : {})}
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
              <span style={{ flex: 1 }}>
                <span style={{ color: check.done ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{check.label}</span>
                {PHASE_CHECK_HINTS[check.label] && (
                  <span style={{ display: 'block', fontSize: 9, color: 'var(--color-text-muted)', marginTop: 1 }}>{PHASE_CHECK_HINTS[check.label]}</span>
                )}
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

type ProgramStatus = 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';

// Client mirror of the backend state machine. The backend is
// authoritative — this only decides which buttons to show.
const VALID_TRANSITIONS: Record<ProgramStatus, ProgramStatus[]> = {
  PLANNING: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'COMPLETED'],
  PAUSED: ['ACTIVE', 'COMPLETED'],
  COMPLETED: ['ACTIVE'],
};

const STATUS_ACTION_LABEL: Record<string, string> = {
  'PLANNING>ACTIVE': 'Launch program',
  'PAUSED>ACTIVE': 'Resume program',
  'COMPLETED>ACTIVE': 'Reopen program',
  'ACTIVE>PAUSED': 'Pause program',
  'ACTIVE>COMPLETED': 'Complete program',
  'PAUSED>COMPLETED': 'Complete program',
};

const STATUS_LABEL: Record<string, string> = {
  PLANNING: 'Planning', ACTIVE: 'Active', PAUSED: 'Paused', COMPLETED: 'Completed',
};

interface IncompletePhase { phase: number; name: string; missing: string[] }

export default function GovernanceProgramPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();

  // Governed status-transition dialog state.
  const [statusTarget, setStatusTarget] = useState<ProgramStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [earlyLaunchInfo, setEarlyLaunchInfo] = useState<IncompletePhase[] | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const [program, setProgram] = useState<Program | null>(null);
  const [status, setStatus] = useState<PhaseStatus | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'scope' | 'principles'>('scope');

  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const togglePhase = (n: number) => {
    setExpandedPhase((prev) => (prev === n ? null : n));
    setRoleGroupFilter(null);
  };

  const expandAndScroll = (n: number, tab?: string) => {
    setExpandedPhase(n);
    if (tab && (tab === 'scope' || tab === 'principles')) {
      setActiveTab(tab);
    }
    if (tab === 'leadership') {
      setRoleGroupFilter('COUNCIL');
      setExpandedRoleGroups(new Set(['COUNCIL']));
    } else if (n === 2 && !tab) {
      setRoleGroupFilter(null);
    }
    setTimeout(() => {
      cardRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Editable form state
  const [inScope, setInScope] = useState('');
  const [outOfScope, setOutOfScope] = useState('');
  const [boundaries, setBoundaries] = useState('');
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
  const [agentsList, setAgentsList] = useState<Agent[]>([]);
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const [roleAgentSelections, setRoleAgentSelections] = useState<Record<string, string>>({});
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [expandedRoleGroups, setExpandedRoleGroups] = useState<Set<string>>(() => {
    // Default: only expand groups that have incomplete assignments
    // This is computed lazily on first render, then updated as data loads
    return new Set<string>();
  });
  const [confirmRemoveRoleId, setConfirmRemoveRoleId] = useState<string | null>(null);
  const [roleGroupFilter, setRoleGroupFilter] = useState<string | null>(null);

  const hydrateFromProgram = (p: Program) => {
    setInScope(p.scope?.inScope || '');
    setOutOfScope(p.scope?.outOfScope || '');
    // Boundaries absorbed the former separate Constraints field — fold any
    // existing constraints text in on load so nothing is lost.
    setBoundaries([p.scope?.boundaries, p.scope?.constraints].map((s) => (s || '').trim()).filter(Boolean).join('\n\n'));
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
  useRefreshOnFocus(fetchAll);

  // Governed status change. The backend enforces role, valid
  // transitions, the Phase-1 hard prerequisite, and the early-launch
  // soft gate; the client handles its responses:
  //   400 blockingPhase   → hard-blocked, show what's missing
  //   409 requiresConfirm → open the early-launch confirm, then retry
  //                         with force: true
  const changeStatus = async (to: ProgramStatus, opts: { force?: boolean; reason?: string } = {}) => {
    if (!program) return;
    setStatusBusy(true);
    try {
      const res = await apiClient.put<{ success: boolean; data: Program }>(
        `/governance-program/${program.id}`,
        { status: to, ...(opts.force ? { force: true } : {}), ...(opts.reason ? { reason: opts.reason } : {}) },
      );
      if (res.data) { setProgram(res.data); hydrateFromProgram(res.data); }
      addToast('success', `Program ${STATUS_LABEL[to].toLowerCase()}.`);
      setStatusTarget(null);
      setStatusReason('');
      setEarlyLaunchInfo(null);
      fetchAll();
    } catch (e: any) {
      const body = (e && typeof e === 'object' && 'body' in e ? e.body : null) || {};
      if (body?.requiresConfirmation && Array.isArray(body.incompletePhases)) {
        // Soft gate — surface exactly what's incomplete and let the
        // admin confirm an early launch.
        setEarlyLaunchInfo(body.incompletePhases);
        setStatusTarget(to);
      } else if (body?.blockingPhase) {
        addToast('error', `${body.error} Missing: ${(body.missing || []).join(', ')}`);
        setStatusTarget(null);
      } else {
        addToast('error', body?.error || e?.message || 'Status change failed');
        setStatusTarget(null);
      }
    } finally {
      setStatusBusy(false);
    }
  };

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!program) return;
    setSaving(true);
    try {
      const payload = {
        // constraints merged into boundaries; write it empty so the two
        // can't drift back apart.
        scope: { inScope, outOfScope, boundaries, constraints: '' },
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
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e?.response?.data?.error || errorMessage(err, 'Failed to save program');
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
      const [rolesRes, peopleRes, agentsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[] }>(`/dama-roles?orgId=${activeOrgId}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: Agent[] }>(`/agents?orgId=${activeOrgId}`),
      ]);
      setRoleAssignments(Array.isArray(rolesRes.data) ? rolesRes.data : []);
      setPeople(Array.isArray(peopleRes.data) ? peopleRes.data : []);
      setAgentsList(Array.isArray(agentsRes.data) ? agentsRes.data.filter((a) => a.status === 'ACTIVE') : []);
    } catch {
      // API may not be available
    } finally {
      setRolesLoaded(true);
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (expandedPhase === 2 && !rolesLoaded) {
      fetchRolesData();
    }
  }, [expandedPhase, rolesLoaded, fetchRolesData]);

  // Reset rolesLoaded when org changes so data is re-fetched
  useEffect(() => {
    setRolesLoaded(false);
  }, [activeOrgId]);

  const handleAssignRole = async (roleType: string, assignType: 'person' | 'agent' = 'person') => {
    const candidateId = assignType === 'person' ? roleSelections[roleType] : roleAgentSelections[roleType];
    if (!candidateId || !activeOrgId) return;
    setAssigningRole(roleType);
    try {
      const payload: Record<string, string> = {
        roleType,
        scopeType: 'ORG',
        scopeId: activeOrgId,
      };
      if (assignType === 'person') payload.personId = candidateId;
      else payload.agentId = candidateId;

      await apiClient.post('/dama-roles', payload);
      addToast('success', `Role assigned to ${assignType}`);
      if (assignType === 'person') setRoleSelections((prev) => ({ ...prev, [roleType]: '' }));
      else setRoleAgentSelections((prev) => ({ ...prev, [roleType]: '' }));
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
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e?.response?.data?.error || errorMessage(err, 'Failed to assign role');
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
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e?.response?.data?.error || errorMessage(err, 'Failed to remove role');
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

      {/* Header */}
      <PageHeader
        title="Governance Program"
        subtitle="Launch and run your data governance program in phases — foundation, structure, ownership, and operations."
        meta={status ? (
          <div style={{ maxWidth: 600, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <SectionLabel marginBottom={0}>
                Overall Progress
              </SectionLabel>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                {status.overallProgress}%
              </span>
            </div>
            <ProgressBar value={status.overallProgress} />
          </div>
        ) : undefined}
      >
        <HelpPopover id="gov-program-intro" title="Data Governance Program Setup">
          Procela follows a DAMA-aligned, 4-phase framework for standing up a governance program:
          (1) Foundation Definition — scope, principles, operating model; (2) Structural Design —
          domains, roles, and committees; (3) People & Processes — RACI, policies, and stewardship;
          (4) Operationalization — monitoring, metrics, and continuous improvement. Progress on
          each phase is tracked automatically as you complete the underlying work. Organizations
          move through these phases at their own pace.
        </HelpPopover>
      </PageHeader>

      {loading && (
        <Card padding={24} shadow="none">
          <Spinner center label="Loading…" />
        </Card>
      )}

      {!loading && (
        <>
          {/* Next actions — above phase cards */}
          {recs.length > 0 && (
            <Card padding={20} marginBottom={20}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Next Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recs.map((r, idx) => {
                  const pc = priorityColor(r.priority);
                  const isSamePage = r.link === '/governance-program';
                  const actionTab = /principle|operating model/i.test(r.action) ? 'principles' : /scope/i.test(r.action) ? 'scope' : undefined;
                  const handleGoClick = () => {
                    if (isSamePage) {
                      expandAndScroll(r.phase, actionTab);
                    } else {
                      navigate(r.link);
                    }
                  };
                  return (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg)',
                    }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', background: pc.bg, color: pc.color, flexShrink: 0 }}>{r.priority}</span>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: PHASE_COLORS[r.phase] + '20', color: PHASE_COLORS[r.phase], flexShrink: 0 }}>Phase {r.phase}</span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{r.action}</span>
                      {r.link && (
                        <button onClick={handleGoClick} style={{ background: 'none', border: 'none', fontSize: 12, fontWeight: 500, color: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0, padding: 0 }}>Go &rarr;</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Phase cards — fixed 4-column grid with arrow connectors */}
          {status && (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 0,
                marginBottom: 0,
                alignItems: 'stretch',
              }}>
                {([1, 2, 3, 4] as const).map((n, idx) => {
                  const key = `phase${n}` as 'phase1' | 'phase2' | 'phase3' | 'phase4';
                  const isExpanded = expandedPhase === n;
                  return (
                    <div key={n} style={{ display: 'flex', alignItems: 'stretch' }}>
                      <div style={{ flex: 1, display: 'flex' }}>
                        <div style={{ flex: 1 }}>
                          <PhaseCard
                            phaseNum={n}
                            phase={status.phases[key]}
                            isCurrent={status.currentPhase === n}
                            expanded={isExpanded}
                            onToggle={() => togglePhase(n)}
                            onExpandPhase={expandAndScroll}
                          />
                        </div>
                      </div>
                      {idx < 3 && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 32,
                          flexShrink: 0,
                          color: 'var(--color-text-muted)',
                          fontSize: 18,
                          fontWeight: 700,
                          opacity: 0.5,
                        }}>
                          &rarr;
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Expanded phase detail panel — below all cards */}
          {expandedPhase !== null && status && (
            <div
              ref={(el) => { cardRefs.current[expandedPhase] = el; }}
              style={{
                marginTop: 16,
                marginBottom: 20,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderTop: `3px solid ${PHASE_COLORS[expandedPhase]}`,
                borderRadius: 'var(--radius-md)',
                padding: 24,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: PHASE_COLORS[expandedPhase],
                    color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700,
                  }}>
                    {expandedPhase}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
                    Phase {expandedPhase}: {PHASE_TITLES[expandedPhase]}
                  </h3>
                </div>
                <button
                  onClick={() => setExpandedPhase(null)}
                  style={{
                    background: 'none', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    fontSize: 16, color: 'var(--color-text-muted)',
                    width: 32, height: 32,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  aria-label="Close panel"
                >
                  &times;
                </button>
              </div>
              {/* Phase 1 content */}
              {expandedPhase === 1 && program && (
                <div>
                  <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
                    {(['scope', 'principles'] as const).map((t) => (
                      <button key={t} onClick={() => setActiveTab(t)} style={{
                        padding: '8px 16px', fontSize: 13,
                        fontWeight: activeTab === t ? 600 : 500,
                        background: 'transparent', border: 'none',
                        borderBottom: activeTab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                        color: activeTab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        marginBottom: -1, cursor: 'pointer', textTransform: 'capitalize',
                      }}>{t}</button>
                    ))}
                  </div>
                  {activeTab === 'scope' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>In Scope</label><textarea aria-label="In Scope" style={textareaStyle} value={inScope} onChange={(e) => setInScope(e.target.value)} placeholder="What data, systems, and processes are governed by this program?" /></div>
                      <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Out of Scope</label><textarea aria-label="Out of Scope" style={textareaStyle} value={outOfScope} onChange={(e) => setOutOfScope(e.target.value)} placeholder="What is explicitly excluded from this program?" /></div>
                      <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Boundaries &amp; Constraints</label><textarea aria-label="Boundaries & Constraints" style={textareaStyle} value={boundaries} onChange={(e) => setBoundaries(e.target.value)} placeholder="Organizational / geographic / functional boundaries, plus budget, timeline, regulatory or resource constraints to respect" /></div>
                    </div>
                  )}
                  {activeTab === 'principles' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Vision</label><textarea aria-label="Vision" style={textareaStyle} value={vision} onChange={(e) => setVision(e.target.value)} placeholder="What does success look like for your data governance program?" /></div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Guiding Principles</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                          {principles.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No principles defined yet.</div>}
                          {principles.map((p, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 20 }}>{idx + 1}.</span>
                              <span style={{ flex: 1, fontSize: 13 }}>{p}</span>
                              <button type="button" onClick={() => removePrinciple(idx)} aria-label={`Remove principle ${p}`} title="Remove principle" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)', padding: 2 }}><span aria-hidden="true">&times;</span></button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input aria-label="Guiding Principles" style={inputStyle} value={newPrinciple} onChange={(e) => setNewPrinciple(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrinciple(); } }} placeholder="e.g. Data is a shared asset; treat it like one" />
                          <Button variant="secondary" onClick={addPrinciple}>Add</Button>
                        </div>
                      </div>
                      {/* Decision Rights is a structured entity of its own —
                          the free-text box here duplicated it. Point at the
                          dedicated page instead; any stored text is retained. */}
                      <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Decision Rights</label><div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Defined on the <Link to="/decision-rights" style={{ color: 'var(--color-primary)', fontWeight: 500 }}>Decision Rights</Link> page — who decides / recommends / approves for each decision.</div></div>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Operating Model</label>
                        <select aria-label="Operating Model" style={selectStyle} value={operatingModel} onChange={(e) => setOperatingModel(e.target.value as Program['principles']['operatingModel'])}>
                          <option value="">-- Select --</option><option value="CENTRALIZED">Centralized</option><option value="FEDERATED">Federated</option><option value="HYBRID">Hybrid</option>
                        </select>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>Centralized = one central team. Federated = domains self-govern. Hybrid = shared.</div>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-secondary)' }}>Program Dates</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Start Date</label><input type="date" aria-label="Target Start Date" style={inputStyle} value={targetStartDate} onChange={(e) => setTargetStartDate(e.target.value)} /></div>
                      <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Launch Date</label><input type="date" aria-label="Target Launch Date" style={inputStyle} value={targetLaunchDate} onChange={(e) => setTargetLaunchDate(e.target.value)} /></div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <Button variant="primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</Button>
                  </div>
                </div>
              )}
              {/* Phase 2 content */}
              {expandedPhase === 2 && (() => {
                const totalRoles = ROLE_GUIDE.length;
                const leadershipTypes = ['CDO', 'DATA_GOVERNANCE_LEAD'];
                const filledRoleTypes = new Set(roleAssignments.map((a) => a.roleType));
                const filledCount = ROLE_GUIDE.filter((r) => filledRoleTypes.has(r.roleType)).length;
                const leadershipFilled = leadershipTypes.filter((rt) => filledRoleTypes.has(rt)).length;
                const visibleGroups = roleGroupFilter ? ROLE_GROUPS.filter((g) => g.groupType === roleGroupFilter) : ROLE_GROUPS;
                const allGroupTypes = visibleGroups.map((g) => g.groupType);
                const allExpanded = allGroupTypes.every((gt) => expandedRoleGroups.has(gt));
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {roleGroupFilter ? `Leadership roles: CDO, Data Governance Lead` : `${filledCount} of ${totalRoles} roles assigned`}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 12, color: leadershipFilled === leadershipTypes.length ? '#16a34a' : '#dc2626' }}>{leadershipFilled} of {leadershipTypes.length} leadership roles filled</span>
                        {!roleGroupFilter && (
                          <button onClick={() => setExpandedRoleGroups(allExpanded ? new Set() : new Set(allGroupTypes))} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>{allExpanded ? 'Collapse All' : 'Expand All'}</button>
                        )}
                        {roleGroupFilter && (
                          <button onClick={() => { setRoleGroupFilter(null); setExpandedRoleGroups(new Set()); }} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>Show all groups</button>
                        )}
                      </div>
                    </div>
                    {!roleGroupFilter && <div style={{ marginBottom: 16 }}><ProgressBar value={(filledCount / totalRoles) * 100} /></div>}
                    {visibleGroups.map((group) => {
                      const groupRoles = ROLE_GUIDE.filter((r) => group.roleTypes.includes(r.roleType));
                      const groupFilled = groupRoles.filter((r) => filledRoleTypes.has(r.roleType)).length;
                      const isGroupExpanded = expandedRoleGroups.has(group.groupType);
                      return (
                        <div key={group.groupType} style={{ marginBottom: 8 }}>
                          <div {...clickable(() => setExpandedRoleGroups((prev) => { const next = new Set(prev); if (next.has(group.groupType)) next.delete(group.groupType); else next.add(group.groupType); return next; }), { label: `Toggle ${group.label}` })}
                            aria-expanded={isGroupExpanded}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderRadius: 'var(--radius-md)', border: `1px solid ${isGroupExpanded ? group.color + '40' : 'var(--color-border)'}`, background: isGroupExpanded ? group.color + '08' : 'var(--color-surface)', transition: 'background-color 0.12s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = group.color + '0d'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isGroupExpanded ? group.color + '08' : 'var(--color-surface)'; }}>
                            <div style={{ width: 4, height: 24, borderRadius: 2, background: group.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 12 }}>{isGroupExpanded ? '▼' : '▶'}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 14, fontWeight: 700 }}>{group.label}</span>
                                <span style={{ fontSize: 11, color: groupFilled === groupRoles.length ? '#16a34a' : 'var(--color-text-muted)' }}>{groupFilled}/{groupRoles.length} filled</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{group.description}</div>
                              {!isGroupExpanded && groupRoles.length > 0 && (
                                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                                  {groupRoles.map((r) => {
                                    const isFilled = filledRoleTypes.has(r.roleType);
                                    return (
                                      <span key={r.roleType} style={{
                                        fontSize: 10, padding: '1px 6px', borderRadius: 3,
                                        background: isFilled ? '#d1fae5' : '#fef2f2',
                                        color: isFilled ? '#065f46' : '#991b1b',
                                      }}>{r.label}</span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <Link to={group.link} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none', flexShrink: 0 }}>View Group &rarr;</Link>
                          </div>
                          {isGroupExpanded && (
                            <div style={{ marginTop: 6 }}>
                              {groupRoles.map((role) => {
                                const assignees = roleAssignments.filter((a) => a.roleType === role.roleType);
                                const isFilled = !role.multiAssign && assignees.length > 0;
                                return (
                                  <div key={role.roleType} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginLeft: 14, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderLeft: `3px solid ${group.color}`, borderRadius: 'var(--radius-md)', marginBottom: 6 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{role.label}</span>
                                        <StatusBadge variant={PRIORITY_TO_VARIANT[role.priority]}>{role.priority}</StatusBadge>
                                        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: role.multiAssign ? '#f5f3ff' : '#f0f9ff', color: role.multiAssign ? '#6d28d9' : '#0369a1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                          {role.multiAssign ? 'Multiple' : 'Single'}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{role.purpose}</div>
                                      {assignees.length > 0 ? (
                                        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                          {assignees.map((a) => {
                                            const isAgent = !!a.agentId;
                                            const displayName = isAgent ? (a.agentName || 'Agent') : (a.personName || 'Unknown');
                                            return (
                                              <span key={a.id} style={{ fontSize: 11, padding: '2px 8px', background: isAgent ? '#ede9fe' : '#d1f0eb', color: isAgent ? '#5b21b6' : '#0f4f46', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                {isAgent && <span title="AI Agent" style={{ display: 'inline-flex' }}><Bot size={11} strokeWidth={2.4} /></span>}
                                                {displayName}
                                                <button type="button" onClick={() => setConfirmRemoveRoleId(a.id)} aria-label={`Remove ${displayName} from this role`} title="Remove role assignment" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isAgent ? '#5b21b6' : '#0f4f46', fontSize: 12, padding: 0, lineHeight: 1 }}><span aria-hidden="true">&times;</span></button>
                                              </span>
                                            );
                                          })}
                                        </div>
                                      ) : (<div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>Not assigned</div>)}
                                    </div>
                                    {!isFilled ? (
                                      (() => {
                                        // Accountability roles (CDO,
                                        // Governance Lead, Data Owner,
                                        // Business Steward) keep the
                                        // person picker fully usable
                                        // but render the agent slot as
                                        // disabled with the rationale
                                        // in the tooltip — see
                                        // PEOPLE_ONLY_ROLE_TYPES.
                                        const isPeopleOnly = PEOPLE_ONLY_ROLE_TYPES.has(role.roleType);
                                        return (
                                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                                            <select aria-label={`Assign ${role.label} to a person`} style={{ ...selectStyle, width: 'auto', minWidth: 130, fontSize: 12 }} value={roleSelections[role.roleType] || ''} onChange={(e) => { setRoleSelections((prev) => ({ ...prev, [role.roleType]: e.target.value })); if (e.target.value) setRoleAgentSelections((prev) => ({ ...prev, [role.roleType]: '' })); }}><option value="">Person...</option>{people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}</select>
                                            <Button variant="primary" size="sm" disabled={!roleSelections[role.roleType] || !!assigningRole} onClick={() => handleAssignRole(role.roleType, 'person')}>Assign</Button>
                                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>or</span>
                                            <select
                                              aria-label={`Assign ${role.label} to an agent`}
                                              disabled={isPeopleOnly}
                                              aria-disabled={isPeopleOnly}
                                              title={isPeopleOnly ? PEOPLE_ONLY_REASON : undefined}
                                              style={{ ...selectStyle, width: 'auto', minWidth: 130, fontSize: 12, borderColor: isPeopleOnly ? 'var(--color-border)' : '#c4b5fd', background: isPeopleOnly ? 'var(--color-bg)' : undefined, color: isPeopleOnly ? 'var(--color-text-muted)' : undefined, cursor: isPeopleOnly ? 'not-allowed' : undefined }}
                                              value={roleAgentSelections[role.roleType] || ''}
                                              onChange={(e) => { setRoleAgentSelections((prev) => ({ ...prev, [role.roleType]: e.target.value })); if (e.target.value) setRoleSelections((prev) => ({ ...prev, [role.roleType]: '' })); }}
                                            >
                                              <option value="">Agent…</option>
                                              {!isPeopleOnly && agentsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                            </select>
                                            <Button
                                              type="button"
                                              variant="primary"
                                              size="sm"
                                              disabled={isPeopleOnly || !roleAgentSelections[role.roleType] || !!assigningRole}
                                              aria-disabled={isPeopleOnly}
                                              title={isPeopleOnly ? PEOPLE_ONLY_REASON : undefined}
                                              style={{ background: isPeopleOnly ? 'var(--color-bg)' : '#7c3aed', color: isPeopleOnly ? 'var(--color-text-muted)' : undefined, border: isPeopleOnly ? '1px solid var(--color-border)' : undefined }}
                                              onClick={() => handleAssignRole(role.roleType, 'agent')}
                                            >
                                              Assign
                                            </Button>
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      <span style={{ fontSize: 11, color: 'var(--color-success)', flexShrink: 0 }}>✓ Filled</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {/* Phase 3 content */}
              {expandedPhase === 3 && status && (
                <div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                    With the governance structure in place, assign Data Owners to each domain, identify stewards, and form stewardship teams.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {status.phases.phase3.checks.map((check, idx) => {
                      const actionMap: Record<string, { route: string; label: string }> = {
                        'Data owners assigned': { route: '/governance-program', label: 'Assign Roles' },
                        'Data stewards identified': { route: '/governance-program', label: 'Assign Roles' },
                        'Stewardship teams formed': { route: '/governance', label: 'Governance Groups' },
                        'Domain ownership assigned': { route: '/data-domains', label: 'Data Domains' },
                      };
                      const target = actionMap[check.label];
                      return (
                        <div key={idx} {...clickable(() => { if (target?.route === '/governance-program') expandAndScroll(2); else if (target) navigate(target.route); }, { label: target ? target.label : check.label })}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderLeft: `4px solid ${check.done ? '#22c55e' : '#d1d5db'}`, borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'background-color 0.12s' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg)'; }}>
                          <span style={{ width: 20, height: 20, borderRadius: '50%', background: check.done ? '#22c55e' : 'transparent', border: check.done ? 'none' : '2px solid #d1d5db', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{check.done ? '✓' : ''}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: check.done ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{check.label}</span>
                          {target && !check.done && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-primary)', flexShrink: 0 }}>{target.label} &rarr;</span>}
                          {check.done && <span style={{ fontSize: 12, color: 'var(--color-success)', fontWeight: 600 }}>&#10003; Done</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Phase 4 content */}
              {expandedPhase === 4 && program && (
                <div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                    The program lifecycle is governed: only an admin / program owner can change it, transitions follow a fixed path, and every change is written to the audit log. Phase 1 (Foundation) must be complete before the program can go active; launching with later phases incomplete asks for an explicit confirmation.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13 }}>
                      Current status: <strong>{STATUS_LABEL[program.status] || program.status}</strong>
                    </span>
                    {program.status === 'ACTIVE' && (
                      <span style={{ fontSize: 12, color: 'var(--color-success)', fontWeight: 600 }}>&#10003; Program is live</span>
                    )}
                    {(VALID_TRANSITIONS[program.status as ProgramStatus] || []).map((to) => {
                      const key = `${program.status}>${to}`;
                      const label = STATUS_ACTION_LABEL[key] || `Set ${STATUS_LABEL[to]}`;
                      const isPrimary = to === 'ACTIVE';
                      const isDanger = to === 'COMPLETED';
                      return (
                        <Button
                          key={to}
                          variant="primary"
                          disabled={!isAdmin || statusBusy}
                          title={!isAdmin ? 'Only an admin / program owner can change the program status' : undefined}
                          style={{
                            background: !isAdmin ? 'var(--color-border)'
                              : isDanger ? '#b91c1c'
                              : isPrimary ? 'var(--color-primary)'
                              : 'var(--color-bg)',
                            color: !isAdmin ? 'var(--color-text-muted)'
                              : (isPrimary || isDanger) ? '#fff' : 'var(--color-text)',
                            border: isPrimary || isDanger ? 'none' : '1px solid var(--color-border)',
                          }}
                          onClick={() => {
                            if (!activeOrgId) { addToast('error', 'Select an organization first.'); return; }
                            setStatusReason('');
                            setEarlyLaunchInfo(null);
                            // Launch goes straight to the request — the
                            // backend decides if a confirmation is needed
                            // and returns the incomplete list. Pause /
                            // Complete / Reopen always confirm first.
                            if (to === 'ACTIVE' && program.status === 'PLANNING') {
                              changeStatus('ACTIVE');
                            } else {
                              setStatusTarget(to);
                            }
                          }}
                        >
                          {label}
                        </Button>
                      );
                    })}
                    {!isAdmin && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        View only — your role can't change the program lifecycle.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!program && !loading && (
            <Card padding={24} shadow="none" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              No governance program found for this organization.
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmRemoveRoleId !== null}
        title="Remove Role Assignment?"
        message="This will remove this person or agent from this governance role. You can reassign it later."
        confirmLabel="Remove"
        onConfirm={async () => {
          const id = confirmRemoveRoleId;
          setConfirmRemoveRoleId(null);
          if (id) await handleRemoveRole(id);
        }}
        onCancel={() => setConfirmRemoveRoleId(null)}
      />

      {/* Early-launch confirmation — phases 2–4 incomplete. Backend
          returned the list; admin confirms to force it. */}
      <ConfirmDialog
        open={!!earlyLaunchInfo}
        title="Launch with incomplete phases?"
        message="The program isn't fully set up. Launching now marks it active in the scorecard and dashboards with these gaps:"
        confirmLabel="Launch anyway"
        variant="danger"
        onConfirm={() => statusTarget && changeStatus(statusTarget, { force: true, reason: statusReason })}
        onCancel={() => { setEarlyLaunchInfo(null); setStatusTarget(null); setStatusReason(''); }}
      >
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          {(earlyLaunchInfo || []).map((p) => (
            <div key={p.phase} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Phase {p.phase} — {p.name}</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {p.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ))}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8, marginBottom: 4 }}>
            Reason (recorded in the audit log)
          </label>
          <input
            aria-label="Reason (recorded in the audit log)"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder="e.g. running a 30-day pilot ahead of full rollout"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 6, boxSizing: 'border-box' }}
          />
        </div>
      </ConfirmDialog>

      {/* Plain transition confirmation — Pause / Resume / Complete /
          Reopen. (Launch from PLANNING goes direct; the backend gates
          it and may bounce back into the early-launch dialog above.) */}
      <ConfirmDialog
        open={statusTarget !== null && !earlyLaunchInfo}
        title={
          statusTarget === 'COMPLETED' ? 'Complete this program?'
          : statusTarget === 'PAUSED' ? 'Pause this program?'
          : statusTarget === 'ACTIVE' && program?.status === 'COMPLETED' ? 'Reopen this completed program?'
          : statusTarget === 'ACTIVE' ? 'Resume this program?'
          : 'Change program status?'
        }
        message={
          statusTarget === 'COMPLETED' ? 'Completed marks the program as closed out. Reopening later is possible but is an explicit, audited action.'
          : statusTarget === 'PAUSED' ? 'Pausing keeps all configuration but signals the program is not actively operating (e.g. a reorg or budget freeze).'
          : statusTarget === 'ACTIVE' && program?.status === 'COMPLETED' ? 'This moves a closed program back to active. The reopen is recorded in the audit log.'
          : 'This resumes active operations.'
        }
        confirmLabel={statusTarget ? (STATUS_ACTION_LABEL[`${program?.status}>${statusTarget}`] || `Set ${STATUS_LABEL[statusTarget]}`) : 'Confirm'}
        variant={statusTarget === 'COMPLETED' ? 'danger' : 'primary'}
        onConfirm={() => statusTarget && changeStatus(statusTarget, { reason: statusReason })}
        onCancel={() => { setStatusTarget(null); setStatusReason(''); }}
      >
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Reason (optional — recorded in the audit log)
          </label>
          <input
            aria-label="Reason (optional — recorded in the audit log)"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder="Why is the status changing?"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 6, boxSizing: 'border-box' }}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
